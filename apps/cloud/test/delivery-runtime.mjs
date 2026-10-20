import assert from "node:assert/strict";
import { build } from "esbuild";
import { request as httpRequest } from "node:http";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdtempSync, existsSync, writeFileSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare, convertV4MiniflareOptions } from "miniflare";
import { Client } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js";
import { StdioClientTransport } from "../../../node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js";
import { z } from "../../../node_modules/zod/index.js";

// Wrangler's development proxy uses a 2023 compatibility date and does not
// forward disconnect signals. Test the actual Worker runtime without that proxy.
const bundle = await build({ entryPoints: [new URL("./fixtures/delivery-worker.ts", import.meta.url).pathname],
  bundle: true, write: false, format: "esm", platform: "node", target: "es2022", external: ["cloudflare:*"] });
const callbackEvents = [];
const runtime = new Miniflare(convertV4MiniflareOptions({ modules: true, script: bundle.outputFiles[0].text,
  compatibilityDate: "2026-10-01", compatibilityFlags: ["nodejs_compat", "enable_request_signal", "request_signal_passthrough"],
  unsafeDirectSockets: [{ port: 0 }],
  durableObjects: { WORKSPACE_BUS: { className: "WorkspaceBusObject", useSQLite: true } },
  d1Databases: ["AGENT_BUS_CLOUD_DB"],
  outboundService: async request => {
    assert.equal(new URL(request.url).hostname, "example.com");
    const body = await request.text(); const data = JSON.parse(body);
    const signature = createHmac("sha256", Buffer.alloc(32, 42)).update(`${request.headers.get("webhook-id")}.${request.headers.get("webhook-timestamp")}.${body}`).digest("base64");
    assert.equal(request.headers.get("webhook-signature"), "v1," + signature);
    if (data.type === "verification") return Response.json({ challenge: data.challenge });
    callbackEvents.push(data); return new Response(null, { status: 204 });
  },
  r2Buckets: ["CHAT_FILES"], port: 0 }));
try {
  const database = await runtime.getD1Database("AGENT_BUS_CLOUD_DB");
  await database.exec("CREATE TABLE memberships (workspace_id TEXT, user_id TEXT, role TEXT); INSERT INTO memberships VALUES ('delivery-runtime', 'test', 'owner');");
  const origin = (await runtime.unsafeGetDirectURL()).origin;
  const modern = async (method, params = {}) => {
    const response = await fetch(origin + "/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2026-07-28", "Mcp-Method": method },
      body: JSON.stringify({ jsonrpc: "2.0", id: 900, method, params: { ...params, _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28", "io.modelcontextprotocol/clientInfo": { name: "events-test", version: "1" }, "io.modelcontextprotocol/clientCapabilities": {} } } }) });
    const text = await response.text();
    const data = response.headers.get("content-type")?.includes("event-stream") ? text.split("\n").filter(line => line.startsWith("data: ")).map(line => JSON.parse(line.slice(6))).at(-1) : JSON.parse(text);
    assert.equal(response.status, 200, JSON.stringify(data)); assert(!data.error, JSON.stringify(data)); return data.result;
  };
  assert((await modern("server/discover")).capabilities.events);
  assert.equal((await modern("events/list")).events[0].name, "inbox.message_available");
  assert((await modern("tools/list")).tools.some(tool => tool.name === "inbox"));
  console.log("PASS MCP 2 discovery, typed events/list and existing tools/list through Worker runtime");
  const call = async (tool, input, signal) => {
    const response = await fetch(origin + "/mcp?json=1", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tool, input }), signal });
    assert.equal(response.status, 200);
    return JSON.parse((await response.json()).content[0].text);
  };
  await call("register", { name: "receiver", team: "delivery" });
  const subscription = { name: "inbox.message_available", arguments: { agent: "receiver", team: "never-matches" }, delivery: { mode: "webhook", url: "https://example.com/callback", secret: "whsec_" + Buffer.alloc(32, 42).toString("base64") } };
  const subscribed = await modern("events/subscribe", subscription);
  assert(subscribed.id && subscribed.refreshBefore);
  assert.equal((await modern("events/subscribe", subscription)).id, subscribed.id);
  await modern("events/unsubscribe", subscription);
  console.log("PASS MCP Events subscribe/refresh/unsubscribe and signed callback verification through Worker/D1/DO");
  await call("register", { name: "event-receiver", team: "events" });
  await call("register", { name: "event-sender", team: "events" });
  const eventSubscription = { ...subscription, arguments: { agent: "event-receiver", team: "events" } };
  await modern("events/subscribe", eventSubscription);
  const eventMessage = await call("send", { from: "event-sender", to: "event-receiver", message: "Do not include private content in callback" });
  for (let i = 0; i < 100 && callbackEvents.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(callbackEvents[0]?.data.message_id, eventMessage.id);
  assert(!JSON.stringify(callbackEvents).includes("private content"));
  assert.equal((await call("get_message", { message_id: eventMessage.id })).message.delivered_at, null);
  await modern("events/unsubscribe", eventSubscription);
  console.log("PASS real Durable Object alarm sends signed MCP event without consuming inbox");
  const receiver = async () => (await call("directory", { team: "delivery" })).agents[0];
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  if (process.env.AGENT_BUS_LONG_POLL_TEST === "1") {
    const started = Date.now();
    const pending = fetch(origin + "/mcp?json=1&stream=1", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tool: "inbox", input: { agent: "receiver", wait_s: 110 } }), signal: AbortSignal.timeout(120000) }).then(response => response.json());
    await delay(55000);
    const active = await receiver();
    assert.equal(active.listening, true);
    assert(Date.now() - active.last_seen < 2000, "long poll must refresh presence");
    assert.deepEqual(JSON.parse((await pending).content[0].text).messages, []);
    assert(Date.now() - started >= 109000, "empty inbox returned before the requested timeout");
    assert.equal((await receiver()).listening, false);
    console.log("PASS full 110-second empty poll refreshes presence and clears Listening on timeout");
  }
  for (const standardMcp of [false, true]) {
    const abort = new AbortController();
    const dropped = new Promise(resolve => {
      const body = JSON.stringify(standardMcp ? { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "inbox", arguments: { agent: "receiver", wait_s: 110 } } } : { tool: "inbox", input: { agent: "receiver", wait_s: 110 } });
      const request = httpRequest(origin + (standardMcp ? "/mcp" : "/mcp?json=1&stream=1"), { method: "POST", agent: false,
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(body), accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-03-26" } }, response => { response.resume(); response.on("end", resolve); });
      request.on("error", resolve); request.on("close", resolve);
      abort.signal.addEventListener("abort", () => request.destroy(new Error("disconnect test")), { once: true });
      request.end(body);
    });
    for (let i = 0; i < 30 && !(await receiver()).listening; i++) await delay(100);
    assert.equal((await receiver()).listening, true, "long poll never became live");
    abort.abort(); await dropped;
    for (let i = 0; i < 30 && (await receiver()).listening; i++) await delay(100);
    assert.equal((await receiver()).listening, false, "HTTP disconnect left a phantom listener");
    console.log(`PASS ${standardMcp ? "MCP" : "JSON"} client disconnect clears live presence through Worker and Durable Object`);
  }
  const home = mkdtempSync(join(tmpdir(), "cloud-listener-test-"));
  let child;
  const start = () => {
    child = spawn(process.execPath, [new URL("../../../node_modules/tsx/dist/cli.mjs", import.meta.url).pathname,
      new URL("../../../src/cli/index.ts", import.meta.url).pathname, "cloud", "--host", origin, "listen", "delivery", "--agent", "receiver",
      "--handler", process.execPath, "--handler-arg", new URL("./fixtures/delivery-handler.mjs", import.meta.url).pathname, home],
    { env: { ...process.env, AGENT_BUS_DIR: home, AGENT_BUS_CLOUD_TOKEN: "isolated-test-only" }, stdio: ["ignore", "ignore", "pipe"] });
    child.stderr.resume();
    return new Promise(resolve => child.once("exit", resolve));
  };
  const eventually = async condition => {
    for (let i = 0; i < 100; i++) { if (await condition()) return; await delay(100); }
    assert.fail("listener did not reach expected state");
  };
  try {
    await call("register", { name: "sender", team: "delivery" });
    const sent = await call("send", { from: "sender", to: "receiver", message: "handle before acknowledging" });
    const exit = start();
    await eventually(() => existsSync(join(home, `${sent.id}.started`)));
    assert.equal((await call("get_message", { message_id: sent.id })).message.delivered_at, null);
    assert(!existsSync(join(home, "cloud-listeners", readdirSync(join(home, "cloud-listeners"))[0] || "missing")));
    writeFileSync(join(home, "allow"), "handle now");
    await eventually(async () => (await call("get_message", { message_id: sent.id })).message.delivered_at);
    await eventually(() => readdirSync(join(home, "cloud-listeners")).some(name => name.endsWith(".json")));
    const checkpoint = join(home, "cloud-listeners", readdirSync(join(home, "cloud-listeners")).find(name => name.endsWith(".json")));
    assert.equal(JSON.parse(readFileSync(checkpoint)).cursor, sent.id);
    child.kill("SIGTERM"); await exit;
    await eventually(async () => !(await receiver()).listening);
    const restart = start();
    const next = await call("send", { from: "sender", to: "receiver", message: "after restart" });
    await eventually(() => existsSync(join(home, `${next.id}.handled`)));
    await eventually(() => JSON.parse(readFileSync(checkpoint)).cursor === next.id);
    child.kill("SIGTERM"); await restart;
    console.log("PASS real Cloud CLI process handles before ack, persists cursor and resumes after restart");
  } finally { child?.kill("SIGKILL"); rmSync(home, { recursive: true, force: true }); }

  const channelHome = mkdtempSync(join(tmpdir(), "cloud-channel-test-"));
  const transport = new StdioClientTransport({ command: process.execPath, args: [new URL("../../../dist/cli/index.js", import.meta.url).pathname,
    "cloud", "--host", origin, "claude-channel", "delivery", "--agent", "receiver"], env: { ...process.env, AGENT_BUS_DIR: channelHome, AGENT_BUS_CLOUD_TOKEN: "isolated-test-only" }, stderr: "pipe" });
  const client = new Client({ name: "channel-host-protocol-test", version: "1" });
  let resolveEvent; const event = new Promise(resolve => { resolveEvent = resolve; });
  client.setNotificationHandler(z.object({ method: z.literal("notifications/claude/channel"), params: z.object({ content: z.string(), meta: z.record(z.string()) }) }), notification => resolveEvent(notification.params));
  try {
    await client.connect(transport); transport.stderr?.resume();
    const sent = await call("send", { from: "sender", to: "receiver", message: "channel protocol test" });
    const incoming = await Promise.race([event, delay(15000).then(() => { throw new Error("channel notification timed out"); })]);
    assert.equal(JSON.parse(incoming.content).message_id, sent.id);
    assert.equal((await call("get_message", { message_id: sent.id })).message.delivered_at, null);
    assert((await client.callTool({ name: "channel_complete", arguments: { message_id: sent.id + 999, reply: "wrong" } })).isError);
    assert(!(await client.callTool({ name: "channel_complete", arguments: { message_id: sent.id, reply: "Handled by simulated channel host." } })).isError);
    for (let i = 0; i < 50 && !(await call("get_message", { message_id: sent.id })).message.delivered_at; i++) await delay(100);
    const handled = (await call("get_message", { message_id: sent.id })).message;
    assert(handled.delivered_at && handled.replied_at);
    console.log("PASS Claude channel wire protocol: notification, explicit completion, reply then ack (simulated host, real Worker)");
  } finally { await client.close(); await transport.close(); rmSync(channelHome, { recursive: true, force: true }); }

  if (process.env.AGENT_BUS_LIVE_CLAUDE_TEST === "1") {
    const liveHome = mkdtempSync(join(tmpdir(), "agent-bus-claude-live-"));
    const liveCwd = process.env.AGENT_BUS_LIVE_CLAUDE_CWD || liveHome;
    const sessionId = crypto.randomUUID();
    const config = join(liveHome, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { "agent-bus-wake": { command: process.execPath, alwaysLoad: true,
      args: [new URL("../../../dist/cli/index.js", import.meta.url).pathname, "cloud", "--host", origin, "claude-channel", "delivery", "--agent", "receiver"],
      env: { AGENT_BUS_DIR: liveHome, AGENT_BUS_CLOUD_TOKEN: "isolated-test-only" } } } }), { mode: 0o600 });
    assert(process.stdin.isTTY, "Claude development channels require an interactive terminal and explicit startup consent");
    let child;
    let closed;
    try {
      child = spawn("claude", ["--session-id", sessionId, "--name", `wake-test-${sessionId}`, "--no-chrome", "--permission-mode", "default", "--strict-mcp-config", "--mcp-config", config, "--setting-sources", "", "--tools", "", "--disable-slash-commands",
        "--allowedTools", "mcp__agent-bus-wake__channel_complete", "--dangerously-load-development-channels", "server:agent-bus-wake",
        "--", "Authorized isolated Agent Bus integration test. Reply READY, then wait for channel events. For each test event, call channel_complete with its message_id and the exact reply requested in its content. Do not read files, run commands, or perform other work."], { cwd: liveCwd, stdio: "inherit" });
      closed = new Promise(resolve => child.once("close", resolve));
      child.on("error", error => console.error(error.message));
      console.log("Claude interactive test: accept only this test channel's startup consent; no tool permissions are bypassed.");
      for (let i = 0; i < 120 && !(await receiver()).listening; i++) { assert(child.exitCode === null, "Claude exited before channel initialization"); await delay(500); }
      assert((await receiver()).listening, "Claude did not initialize the channel (preview/policy may block it)");
      for (const attempt of [1, 2]) {
        await delay(15000);
        const expected = `CLAUDE_WAKE_${attempt}_OK`;
        const sent = await call("send", { from: "sender", to: "receiver", message: `Authorized wake test only. Call channel_complete for this message with reply ${expected}. Do nothing else.` });
        const deadline = Date.now() + 120000;
        while (Date.now() < deadline && !(await call("get_message", { message_id: sent.id })).message.delivered_at) await delay(500);
        const handled = (await call("get_message", { message_id: sent.id })).message;
        assert(handled.delivered_at && handled.replied_at, "Real Claude did not handle and complete the channel event");
        const thread = await call("thread", { thread_id: handled.thread_id });
        assert(JSON.stringify(thread).includes(expected));
        console.log(`PASS real Claude interactive session wake ${attempt}: replied, then acknowledged through real Worker`);
      }
    } finally {
      if (child && child.exitCode === null) { child.kill("SIGTERM"); const kill = setTimeout(() => child.kill("SIGKILL"), 5000); await closed; clearTimeout(kill); }
      rmSync(liveHome, { recursive: true, force: true });
    }
  }
} finally { await runtime.dispose(); }
