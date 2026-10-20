import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { z } from "zod";
import { spawn } from "node:child_process";
import { once } from "node:events";

const dir = mkdtempSync(join(tmpdir(), "agent-bus-local-wake-"));
process.env.AGENT_BUS_DIR = dir;
process.env.AGENT_BUS_POLL_MS = "10";
const bus = await import("../src/bus.js");
const { getDb, closeDb } = await import("../src/db.js");
const { listenCloud } = await import("../src/cli/cloud-listen.js");
const { callLocalWake } = await import("../src/cli/wake/local.js");
const { CodexWake } = await import("../src/cli/wake/codex.js");
let count = 0;
async function test(name: string, run: () => Promise<void>) { await run(); console.log("PASS " + name); count++; }
const signal = () => new AbortController().signal;
const poll = (agent: string, extra = {}) => bus.wakeInbox({ agent, wait_s: 0, ...extra }, signal());
const row = (id: number) => getDb().prepare("SELECT * FROM messages WHERE id = ?").get(id) as { status: string; replied_at: number | null; delivered_at: number | null };
async function until(check: () => boolean) { const end = Date.now() + 5000; while (!check()) { assert(Date.now() < end, "timed out"); await delay(10); } }
try {
  for (const name of ["sender", "other", "receiver", "claude-local", "codex-local", "race-local"]) bus.register({ name, capabilities: [], project: "wake-test", team: "test-team" });
  await test("idempotent migration and claimed delivery requires handling before ack", async () => {
    closeDb(); getDb(); closeDb(); getDb();
    const msg = bus.send({ from: "sender", to: "receiver", content: "hello" });
    const delivery = (await poll("receiver")).messages[0]!;
    assert.equal(delivery.id, msg.id); assert.equal(row(msg.id).status, "pending");
    const receipt = { agent: "receiver", message_id: msg.id, claim_token: delivery.claim_token };
    assert.throws(() => bus.wakeAck(receipt), /reply before/);
    assert.throws(() => bus.wakeReply({ ...receipt, agent: "other", message: "wrong" }), /receipt/);
    assert.throws(() => bus.wakeReply({ ...receipt, claim_token: "wrong", message: "wrong" }), /receipt/);
    const reply = bus.wakeReply({ ...receipt, message: "handled" });
    assert.equal(bus.wakeReply({ ...receipt, message: "retry" }).id, reply.id);
    assert.equal(reply.reply_to, msg.id); assert.equal(reply.to_agent, "sender");
    assert.equal(row(msg.id).status, "pending"); assert(row(msg.id).replied_at);
    bus.wakeAck(receipt); bus.wakeAck(receipt);
    assert.equal(row(msg.id).status, "delivered"); assert(row(msg.id).delivered_at);
  });
  await test("expired receipt rejected; old unhandled ID replays past cursor", async () => {
    const msg = bus.send({ from: "sender", to: "receiver", content: "retry me" });
    const old = (await poll("receiver")).messages[0]!;
    getDb().prepare("UPDATE messages SET claim_deadline = ? WHERE id = ?").run(Date.now() - 1, msg.id);
    assert.throws(() => bus.wakeReply({ agent: "receiver", message_id: msg.id, claim_token: old.claim_token, message: "late" }), /expired/);
    const fresh = (await poll("receiver", { since_id: msg.id + 100 })).messages[0]!;
    assert.equal(fresh.id, msg.id); assert.notEqual(fresh.claim_token, old.claim_token);
    assert.throws(() => bus.wakeAck({ agent: "receiver", message_id: msg.id, claim_token: old.claim_token }), /receipt/);
    bus.wakeReply({ agent: "receiver", message_id: msg.id, claim_token: fresh.claim_token, message: "handled" });
    // Crash after reply, before checkpoint/ack: database evidence survives restart.
    getDb().prepare("UPDATE messages SET claim_deadline = ? WHERE id = ?").run(Date.now() - 1, msg.id);
    closeDb();
    const replay = (await poll("receiver")).messages[0]!;
    assert.equal(replay.wake_handled, true);
    bus.wakeAck({ agent: "receiver", message_id: msg.id, claim_token: replay.claim_token });
  });
  await test("ask becomes answered only after completion acknowledgement", async () => {
    const msg = bus.send({ from: "sender", to: "receiver", kind: "ask", content: "question" });
    const delivery = (await poll("receiver")).messages[0]!;
    const receipt = { agent: "receiver", message_id: msg.id, claim_token: delivery.claim_token };
    bus.wakeReply({ ...receipt, message: "answer" }); assert.equal(row(msg.id).status, "pending");
    bus.wakeAck(receipt); assert.equal(row(msg.id).status, "answered");
  });
  await test("scope and pause keep messages queued", async () => {
    const msg = bus.send({ from: "sender", to: "receiver", content: "scoped" });
    assert.equal((await poll("receiver", { team: "other-team" })).messages.length, 0);
    assert.equal((await poll("receiver", { project: "other-project" })).messages.length, 0);
    bus.setPaused("receiver", true);
    assert.equal((await poll("receiver")).paused, true); assert.equal(row(msg.id).status, "pending");
    bus.setPaused("receiver", false);
    const delivery = (await poll("receiver", { team: "test-team" })).messages[0]!;
    const receipt = { agent: "receiver", message_id: msg.id, claim_token: delivery.claim_token };
    bus.wakeReply({ ...receipt, message: "done" }); bus.wakeAck(receipt);
  });
  await test("live poll refreshes presence; cancellation and timeout clear it", async () => {
    const controller = new AbortController();
    const pending = bus.wakeInbox({ agent: "receiver", wait_s: 1 }, controller.signal);
    const agent = () => getDb().prepare("SELECT listening_until, last_seen FROM agents WHERE name = ?").get("receiver") as { listening_until: number | null; last_seen: number };
    const first = agent(); assert(first.listening_until! > Date.now());
    await delay(50); assert(agent().last_seen > first.last_seen);
    controller.abort(); await assert.rejects(pending); assert.equal(agent().listening_until, null);
    await bus.wakeInbox({ agent: "receiver", wait_s: 0.03 }, signal()); assert.equal(agent().listening_until, null);
  });
  await test("shared runner retries SQLite lock, replies before ack, saves cursor after ack", async () => {
    const msg = bus.send({ from: "sender", to: "codex-local", content: "test" });
    const host = new CodexWake({ thread: "test-thread", cwd: dir, sandbox: "read-only", executable: process.execPath,
      args: [new URL("./fixtures/codex-wake.mjs", import.meta.url).pathname, "success"] });
    const controller = new AbortController(); let retries = 0; let calls = 0; let handled = 0; let ackCalls = 0;
    try {
      await host.start();
      await listenCloud({ agent: "codex-local", cursor: 0, signal: controller.signal,
        call: async (tool, input, abort) => {
          if (++calls === 1) throw Object.assign(new Error("database is locked"), { code: "SQLITE_BUSY" });
          const result = await callLocalWake(tool, input, abort);
          if (tool === "ack" && ++ackCalls === 1) throw new Error("lost ack response");
          return result;
        },
        wait: async () => { retries++; },
        handle: async (message, abort) => {
          handled++; assert.equal(row(msg.id).status, "pending");
          const text = await host.handle(message, abort);
          bus.wakeReply({ agent: "codex-local", message_id: message.id, claim_token: message.claim_token, message: text });
        },
        saveCursor: id => { assert.equal(id, msg.id); assert.equal(row(id).status, "delivered"); controller.abort(); },
      });
      assert.equal(handled, 1); assert.equal(retries, 2);
    } finally { await host.close(); }
  });
  await test("separate processes cannot claim the same local wake message", async () => {
    const msg = bus.send({ from: "sender", to: "race-local", content: "claim once" });
    const run = async () => {
      const child = spawn(process.execPath, [resolve("test/fixtures/local-wake-process.mjs"), "claim"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
      let output = ""; let error = "";
      child.stdout.on("data", chunk => { output += chunk; }); child.stderr.on("data", chunk => { error += chunk; });
      const [code] = await once(child, "close"); assert.equal(code, 0, error);
      return JSON.parse(output) as { messages: { id: number }[] };
    };
    const results = await Promise.all([run(), run()]);
    assert.deepEqual(results.flatMap(result => result.messages.map(message => message.id)), [msg.id]);
  });
  await test("real SQLite write contention backs off then resumes", async () => {
    const msg = bus.send({ from: "sender", to: "receiver", content: "after lock" });
    const child = spawn(process.execPath, [resolve("test/fixtures/local-wake-process.mjs"), "lock"], { env: process.env, stdio: ["ignore", "ignore", "pipe", "ipc"] });
    child.stderr?.resume();
    const closed = once(child, "close");
    const controller = new AbortController(); let retries = 0;
    try {
      await once(child, "message");
      getDb().pragma("busy_timeout = 10");
      await listenCloud({ agent: "receiver", cursor: 0, signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]), call: callLocalWake,
        wait: async () => { retries++; const released = once(child, "message"); child.send("release"); await released; },
        handle: async message => { bus.wakeReply({ agent: "receiver", message_id: message.id, claim_token: message.claim_token, message: "handled after lock" }); },
        saveCursor: id => { assert.equal(id, msg.id); controller.abort(); },
      });
      assert.equal(retries, 1); assert.equal(row(msg.id).status, "delivered");
    } finally { getDb().pragma("busy_timeout = 5000"); if (child.exitCode === null) child.kill(); await closed; }
  });
  await test("real local Claude stdio bridge receives two events; notification alone never acks", async () => {
    const events: number[] = [];
    const client = new Client({ name: "wake-test", version: "1" });
    client.setNotificationHandler(z.object({ method: z.literal("notifications/claude/channel"), params: z.object({ content: z.string() }) }), async notice => {
      events.push((JSON.parse(notice.params.content) as { message_id: number }).message_id);
    });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve("dist/cli/index.js"), "claude-channel", "--agent", "claude-local"],
      env: { PATH: process.env.PATH!, HOME: dir, AGENT_BUS_DIR: dir, AGENT_BUS_POLL_MS: "10" }, stderr: "pipe" });
    transport.stderr?.resume();
    try {
      await client.connect(transport);
      for (let i = 0; i < 2; i++) {
        const msg = bus.send({ from: "sender", to: "claude-local", content: `cycle ${i}` });
        await until(() => events.includes(msg.id)); assert.equal(row(msg.id).status, "pending");
        const bad = await client.callTool({ name: "channel_complete", arguments: { message_id: msg.id + 100, reply: "wrong" } });
        assert.equal(bad.isError, true); assert.equal(row(msg.id).status, "pending");
        const good = await client.callTool({ name: "channel_complete", arguments: { message_id: msg.id, reply: "Handled locally" } });
        assert(!good.isError); await until(() => row(msg.id).status === "delivered");
      }
      const pending = bus.send({ from: "sender", to: "claude-local", content: "disconnect without handling" });
      await until(() => events.includes(pending.id));
      await client.close(); assert.equal(row(pending.id).status, "pending");
    } finally { await client.close(); }
    await until(() => (getDb().prepare("SELECT listening_until FROM agents WHERE name = ?").get("claude-local") as { listening_until: number | null }).listening_until === null);
  });
} finally { closeDb(); rmSync(dir, { recursive: true, force: true }); }
console.log(`${count} local native wake scenarios passed`);
