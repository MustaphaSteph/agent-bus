import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
      ["wrangler", "dev", "--local", "--persist-to", persistTo, "--port", String(port)],
      {
        cwd: new URL("..", import.meta.url),
        env: { ...process.env, CI: "1" },
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

    const signup = cloud("signup", "--email", "cli@example.com", "--password", "change-me-please", "--name", "CLI");
    assert(signup.includes("signed up"), "cloud signup did not report success");

    const health = cloud("health");
    assert(health.includes("healthy"), "cloud health did not report a healthy host");
    assert(health.includes("tools:"), "cloud health did not print tool status");

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

    const tokenList = cloud("tokens", "list", "cli-demo");
    assert(tokenList.includes("codex-cli"), "cloud tokens list did not include created token");

    console.log("agent-bus cloud CLI smoke passed");
  } finally {
    await stopWorker(worker);
  }
} finally {
  rmSync(persistTo, { recursive: true, force: true });
  rmSync(agentBusDir, { recursive: true, force: true });
}
