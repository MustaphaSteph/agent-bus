import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function wrangler(args, persistTo) {
  execFileSync(
    "npx",
    ["wrangler", ...args, "--local", "--persist-to", persistTo],
    {
      cwd: new URL("..", import.meta.url),
      env: { ...process.env, CI: "1" },
      stdio: "pipe",
    },
  );
}

function agentBus(args, env) {
  return execFileSync("npx", ["tsx", "src/cli/index.ts", ...args], {
    cwd: new URL("../../..", import.meta.url),
    env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function startWorker(persistTo, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      [
        "wrangler",
        "dev",
        "--local",
        "--persist-to",
        persistTo,
        "--port",
        String(port),
        "--var",
        "AGENT_BUS_CLOUD_AUTH_SECRET:test-agent-bus-cloud-secret",
      ],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, CI: "1", AGENT_BUS_CLOUD_AUTH_SECRET: "test-agent-bus-cloud-secret" },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGINT");
      reject(new Error(`wrangler dev did not become ready:\n${output}`));
    }, 30_000);
    const onData = (chunk) => {
      output += chunk.toString();
      if (!settled && output.includes("Ready on")) {
        settled = true;
        clearTimeout(timeout);
        resolve(child);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`wrangler dev exited before ready (${code}):\n${output}`));
      }
    });
  });
}

function stopWorker(child) {
  return new Promise((resolve) => {
    child.once("exit", () => resolve());
    child.kill("SIGINT");
    setTimeout(resolve, 3_000);
  });
}

async function waitForHttp(url) {
  const deadline = Date.now() + 30_000;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`${response.status} ${await response.text()}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`worker did not answer ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

const persistTo = mkdtempSync(join(tmpdir(), "agent-bus-cloud-cli-test-"));
const agentBusDir = mkdtempSync(join(tmpdir(), "agent-bus-cloud-cli-home-"));
const deployCheckDir = mkdtempSync(join(tmpdir(), "agent-bus-cloud-deploy-check-"));
const port = 18_000 + Math.floor(Math.random() * 10_000);

try {
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0001_init.sql"], persistTo);
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0002_auth.sql"], persistTo);

  const worker = await startWorker(persistTo, port);

  const host = `http://127.0.0.1:${port}`;
  await waitForHttp(`${host}/api/health`);
  const env = {
    ...process.env,
    CI: "1",
    AGENT_BUS_DIR: agentBusDir,
    AGENT_BUS_CLOUD_HOST: host,
  };

  try {
    const cloud = (...args) => agentBus(["cloud", "--host", host, ...args], env);

    writeFileSync(join(deployCheckDir, "wrangler.toml"), [
      'name = "agent-bus-cloud"',
      "",
      "[[d1_databases]]",
      'binding = "AGENT_BUS_CLOUD_DB"',
      'database_name = "agent-bus-cloud"',
      'database_id = "11111111-2222-3333-4444-555555555555"',
      "",
      "[vars]",
      'AGENT_BUS_CLOUD_ENV = "production"',
      "",
    ].join("\n"));
    const deployCheck = cloud("deploy-check", "--dir", deployCheckDir);
    assert(deployCheck.includes("deploy config: ok"), "cloud deploy-check did not accept valid production config");

    const signup = cloud("signup", "--email", "cli@example.com", "--password", "change-me-please", "--name", "CLI");
    assert(signup.includes("signed up"), "cloud signup did not report success");

    const health = cloud("health");
    assert(health.includes("healthy"), "cloud health did not report a healthy host");
    assert(health.includes("d1: ok"), "cloud health did not report D1 status");
    assert(health.includes("tools:"), "cloud health did not print tool status");

    const bootstrap = cloud("bootstrap", "boot-demo", "--name", "Boot Demo", "--token-name", "bootstrap-agent", "--role", "agent");
    assert(bootstrap.includes("created workspace boot-demo"), "cloud bootstrap did not create workspace");
    assert(bootstrap.includes("created token"), "cloud bootstrap did not create a token");
    assert(bootstrap.includes('"agent-bus-cloud"'), "cloud bootstrap did not print MCP config");
    assert(bootstrap.includes("token test: ok"), "cloud bootstrap did not verify the token");

    const created = cloud("workspace", "create", "cli-demo", "--name", "CLI Demo");
    assert(created.includes("created cli-demo"), "cloud workspace create did not report success");

    const workspaces = cloud("workspaces");
    assert(workspaces.includes("cli-demo"), "cloud workspaces did not list created workspace");

    const tokenOutput = cloud("tokens", "create", "cli-demo", "--name", "codex-cli", "--role", "agent");
    const token = tokenOutput.match(/Bearer (ab_cloud_[^"]+)/)?.[1];
    assert(token, "cloud tokens create did not print a bearer token config");
    const mcpConfig = cloud("mcp-config", "cli-demo", "--token", token);
    assert(mcpConfig.includes('"agent-bus-cloud"'), "cloud mcp-config did not print server config");
    assert(mcpConfig.includes(token), "cloud mcp-config did not include the token");

    const tokenTest = cloud("token-test", "cli-demo", "--token", token);
    assert(tokenTest.includes("cli-demo"), "cloud token-test did not reach remote MCP workspace");

    const smoke = cloud("smoke", "cli-demo", "--token", token, "--team", "cli-smoke");
    assert(smoke.includes("cloud smoke: ok"), "cloud smoke did not pass");
    assert(smoke.includes("message: delivered"), "cloud smoke did not deliver a message");
    assert(smoke.includes("task: visible"), "cloud smoke did not verify task visibility");

    const tokenList = cloud("tokens", "list", "cli-demo");
    assert(tokenList.includes("codex-cli"), "cloud tokens list did not include created token");

    const teammateSignup = cloud("signup", "--email", "teammate@example.com", "--password", "change-me-please", "--name", "Team Mate");
    assert(teammateSignup.includes("signed up"), "cloud signup did not create teammate account");

    const ownerLogin = cloud("login", "--email", "cli@example.com", "--password", "change-me-please");
    assert(ownerLogin.includes("logged in"), "cloud login did not restore owner session");

    const addMember = cloud("members", "add", "cli-demo", "--email", "teammate@example.com", "--role", "viewer");
    assert(addMember.includes("member saved teammate@example.com"), "cloud members add did not save teammate");
    const userId = addMember.match(/user_id: (usr_[a-zA-Z0-9]+)/)?.[1];
    assert(userId, "cloud members add did not print user id");

    const membersList = cloud("members", "list", "cli-demo");
    assert(membersList.includes("teammate@example.com"), "cloud members list did not include teammate");
    assert(membersList.includes("viewer"), "cloud members list did not include role");

    const roleUpdate = cloud("members", "role", "cli-demo", userId, "--role", "manager");
    assert(roleUpdate.includes("updated"), "cloud members role did not update teammate");
    const membersAfterRole = cloud("members", "list", "cli-demo");
    assert(membersAfterRole.includes("manager"), "cloud members list did not include updated role");

    const removeMember = cloud("members", "remove", "cli-demo", userId);
    assert(removeMember.includes("removed"), "cloud members remove did not remove teammate");
    const membersAfterRemove = cloud("members", "list", "cli-demo");
    assert(!membersAfterRemove.includes("teammate@example.com"), "cloud members list still included removed teammate");

    console.log("agent-bus cloud CLI smoke passed");
  } finally {
    await stopWorker(worker);
  }
} finally {
  rmSync(persistTo, { recursive: true, force: true });
  rmSync(agentBusDir, { recursive: true, force: true });
  rmSync(deployCheckDir, { recursive: true, force: true });
}
