import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function json(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`expected JSON response, got ${response.status}: ${text}`);
  }
}

async function assertStatus(response, status, label) {
  if (response.status !== status) {
    throw new Error(`${label} failed: ${response.status} ${await response.text()}`);
  }
}

function parseMcpEvent(text) {
  const data = text
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => line.slice("data: ".length))
    .join("\n");
  if (!data) throw new Error(`missing MCP event data: ${text}`);
  return JSON.parse(data);
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

const root = new URL("..", import.meta.url);
const persistTo = mkdtempSync(join(tmpdir(), "agent-bus-cloud-smoke-"));

try {
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0001_init.sql"], persistTo);
  wrangler(["d1", "execute", "agent-bus-cloud", "--file", "migrations/d1/0002_auth.sql"], persistTo);

  const worker = await unstable_dev("src/worker.ts", {
    config: "wrangler.toml",
    local: true,
    persistTo,
    logLevel: "error",
    experimental: { disableExperimentalWarning: true },
  });

  try {
    const signup = await worker.fetch("/api/auth/signup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: "smoke@example.com", password: "change-me-please", name: "Smoke" }),
    });
    await assertStatus(signup, 201, "signup");
    const cookie = signup.headers.get("set-cookie");
    assert(cookie, "signup did not set a session cookie");

    const createWorkspace = await worker.fetch("/api/workspaces", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ slug: "demo", name: "Demo" }),
    });
    await assertStatus(createWorkspace, 201, "workspace create");

    const createToken = await worker.fetch("/api/workspaces/demo/tokens", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ name: "codex", role: "agent" }),
    });
    await assertStatus(createToken, 201, "token create");
    const tokenBody = await json(createToken);
    const token = tokenBody.token?.token;
    assert(typeof token === "string" && token.startsWith("ab_cloud_"), "agent token was not returned");

    async function debugCall(tool, input) {
      const response = await worker.fetch("/mcp/demo?json=1", {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tool, input }),
      });
      await assertStatus(response, 200, tool);
      const body = await json(response);
      return JSON.parse(body.content[0].text);
    }

    async function mcp(body) {
      const response = await worker.fetch("/mcp/demo", {
        method: "POST",
        headers: {
          accept: "application/json, text/event-stream",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      await assertStatus(response, 200, body.method);
      return parseMcpEvent(await response.text());
    }

    const init = await mcp({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0.0.0" } },
    });
    assert(init.result?.serverInfo?.name === "agent-bus-cloud-demo", "MCP initialize did not return the workspace server");
    const tools = await mcp({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    assert(tools.result?.tools?.length >= 65, "MCP tools/list did not expose the agent-bus tool surface");

    async function mcpCall(id, name, args) {
      const event = await mcp({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
      return event.result?.structuredContent?.result ?? JSON.parse(event.result.content[0].text);
    }

    await mcpCall(3, "register", { name: "codex", team: "cloud-smoke", capabilities: ["pm"], replace: true });
    await mcpCall(4, "register", { name: "claude", team: "cloud-smoke", capabilities: ["ui"], replace: true });
    const sent = await mcpCall(5, "send", { from: "codex", to: "claude", message: "hello from cloud smoke" });
    assert(sent.thread_id, "send did not return a thread_id");
    const inbox = await debugCall("inbox", { agent: "claude", team: "cloud-smoke", mark_delivered: false });
    assert(inbox.messages?.length === 1, "inbox did not return the sent message");

    const messages = await worker.fetch("/api/workspaces/demo/messages?team=cloud-smoke", { headers: { cookie } });
    await assertStatus(messages, 200, "messages api");
    const messagesBody = await json(messages);
    assert(messagesBody.result.messages.length >= 1, "messages api returned no chat rows");

    const cockpit = await worker.fetch("/api/workspaces/demo/cockpit?team=cloud-smoke", { headers: { cookie } });
    await assertStatus(cockpit, 200, "cockpit api");
    const cockpitBody = await json(cockpit);
    assert(cockpitBody.result.board.agents.length === 2, "cockpit did not include registered agents");

    console.log("agent-bus cloud smoke passed");
  } finally {
    await worker.stop();
  }
} finally {
  rmSync(persistTo, { recursive: true, force: true });
}
