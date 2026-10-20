import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { WorkspaceBusObject } from "../src/durable-objects/workspace-bus";
import { WORKSPACE_SCHEMA_SQL } from "../src/durable-objects/schema";
import { validateWebhookUrl } from "../src/durable-objects/webhooks";
import { scheduleDeliveryAlarm } from "../src/durable-objects/delivery-alarm";
import type { Env, WorkspaceContext } from "../src/shared/types";

const db = new Database(":memory:");
const sql = { exec(query: string, ...values: unknown[]) {
  if (query === WORKSPACE_SCHEMA_SQL) { db.exec(query); return { toArray: () => [] }; }
  const statement = db.prepare(query);
  const result = statement.reader ? statement.all(...values) : (statement.run(...values), []);
  return { toArray: () => result };
} };
let alarm: number | null = null;
const storage = { sql, transactionSync: (fn: () => unknown) => db.transaction(fn)(),
  getAlarm: async () => alarm, setAlarm: async (at: number) => { alarm = at; } } as unknown as DurableObjectStorage;
const state = { storage } as DurableObjectState;
const env = { CHAT_FILES: { delete: async () => {} } } as unknown as Env;
let bus = new WorkspaceBusObject(state, env);
const owner: WorkspaceContext = { id: "delivery-test", slug: "delivery", role: "owner", principal: { kind: "user", id: "owner", role: "owner" } };
async function call(op: string, input: Record<string, unknown> = {}, context = owner, signal?: AbortSignal): Promise<any> {
  const response = await bus.fetch(new Request("https://workspace.test/rpc", {
    method: "POST", body: JSON.stringify({ op, input, context }), signal,
  }));
  const body = await response.json() as any;
  if (!body.ok) throw new Error(body.error.message);
  return body.result;
}
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const receive = (input: Record<string, unknown> = {}) => call("inbox", { agent: "receiver", ...input });
const send = (message = "hello", extra = {}) => call("send", { from: "sender", to: "receiver", message, ...extra });
const ack = (message: any, extra = {}) => call("ack", { agent: "receiver", message_id: message.id, claim_token: message.claim_token, ...extra });
const messageRow = (id: number) => db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as any;
const originalFetch = globalThis.fetch;
let assertions = 0;
async function test(name: string, run: () => Promise<void>) {
  await run(); assertions++; console.log(`PASS ${name}`);
}

try {
  await call("register", { name: "sender", team: "delivery", project: "project" });
  await call("register", { name: "receiver", team: "delivery", project: "project" });
  await test("disconnect clears only its own live poll; inspection never advertises listening", async () => {
    const a = new AbortController(); const b = new AbortController();
    const first = assert.rejects(call("inbox", { agent: "receiver", wait_s: 10 }, owner, a.signal));
    const second = assert.rejects(call("inbox", { agent: "receiver", wait_s: 10 }, owner, b.signal));
    await delay(30);
    a.abort(); await first;
    const view = () => call("human_chat_view", { team: "delivery", project: "project" });
    assert.equal((await view()).members.find((m: any) => m.name === "receiver").presence, "listening");
    b.abort(); await second;
    assert.equal((await view()).members.find((m: any) => m.name === "receiver").presence, "last_checked");
    const preview = call("inbox_previews", { agent: "receiver", wait_s: 0.1 });
    await delay(20);
    assert.equal((await view()).members.find((m: any) => m.name === "receiver").presence, "last_checked");
    await preview;
    db.prepare("UPDATE agents SET listening_until = ? WHERE name = 'receiver'").run(Date.now() + 110000);
    bus = new WorkspaceBusObject(state, env);
    assert.equal((await view()).members.find((m: any) => m.name === "receiver").presence, "last_checked");
  });
  await test("long poll refreshes presence, survives overlapping preview and returns delayed message", async () => {
    db.prepare("UPDATE agents SET last_seen = 0 WHERE name = 'receiver'").run();
    const started = Date.now();
    const waiting = receive({ wait_s: 2 });
    await delay(350);
    await call("inbox_previews", { agent: "receiver" });
    const agent = db.prepare("SELECT last_seen, listening_until FROM agents WHERE name = 'receiver'").get() as any;
    assert(agent.last_seen >= started && agent.listening_until > Date.now());
    await send("delayed");
    const result = await waiting;
    assert.equal(result.messages[0].content, "delayed");
    assert.equal(result.messages[0].status, "pending");
    assert(result.messages[0].claim_token);
    assert.equal((db.prepare("SELECT listening_until FROM agents WHERE name = 'receiver'").get() as any).listening_until, null);
    await ack(result.messages[0]);
  });
  await test("empty timeout is bounded; invalid waits and automatic consumption are rejected", async () => {
    const at = Date.now();
    assert.deepEqual((await receive({ wait_s: 0.3 })).messages, []);
    assert(Date.now() - at >= 250 && Date.now() - at < 1500);
    for (const input of [{ wait_s: 111 }, { wait_s: -1 }, { claim_s: 0 }, { since_id: -1 }, { mark_delivered: true }]) {
      await assert.rejects(receive(input));
    }
  });
  await test("ack is explicit, idempotent and rejects wrong recipient, missing and expired receipts", async () => {
    await send();
    const result = await receive();
    const message = result.messages[0];
    assert.equal(messageRow(message.id).delivered_at, null);
    await assert.rejects(ack(message, { agent: "sender" }));
    await assert.rejects(ack(message, { claim_token: undefined }));
    await assert.rejects(ack(message, { message_id: 999999 }));
    db.prepare("UPDATE messages SET claim_deadline = 0 WHERE id = ?").run(message.id);
    await assert.rejects(ack(message));
    bus = new WorkspaceBusObject(state, env); // Persistent lease survives instance replacement.
    const replay = await receive({ since_id: result.next_cursor });
    assert.equal(replay.messages[0].id, message.id);
    assert.notEqual(replay.messages[0].claim_token, message.claim_token);
    await assert.rejects(ack(message));
    await ack(replay.messages[0]); await ack(replay.messages[0]);
    assert.equal(messageRow(message.id).status, "delivered");
    assert.deepEqual((await receive({ since_id: replay.next_cursor })).messages, []);
  });
  await test("cursor never skips unhandled lower-priority or previously filtered messages", async () => {
    await send("low"); await send("urgent");
    db.prepare("UPDATE messages SET priority = 'urgent' WHERE content = 'urgent'").run();
    const first = await receive({ limit: 1 });
    assert.equal(first.messages[0].content, "urgent");
    await ack(first.messages[0]);
    const second = await receive({ since_id: first.next_cursor, limit: 1 });
    assert.equal(second.messages[0].content, "low");
    assert.equal(second.next_cursor, first.next_cursor);
    await ack(second.messages[0]);
    await send("scope");
    assert.deepEqual((await receive({ team: "other" })).messages, []);
    assert.equal((await receive({ mark_delivered: false })).messages.length, 1);
    assert.equal(messageRow((await receive({ mark_delivered: false })).messages[0].id).claimed_by, null);
    await ack((await receive()).messages[0]);
  });
  await test("concurrent consumers cannot lease the same message", async () => {
    await send("only once");
    const a = receive(); const b = receive();
    const first = await a; const second = await b;
    assert.equal(first.messages.length + second.messages.length, 1);
    await ack([...first.messages, ...second.messages][0]);
  });
  await test("pause during polling stops delivery; removal exits and clears presence", async () => {
    const waiting = receive({ wait_s: 1 });
    await delay(50);
    db.prepare("UPDATE agents SET paused = 1 WHERE name = 'receiver'").run();
    await send("paused");
    assert.deepEqual((await waiting).messages, []);
    db.prepare("UPDATE agents SET paused = 0 WHERE name = 'receiver'").run();
    await ack((await receive()).messages[0]);
    const removed = assert.rejects(receive({ wait_s: 1 }), /unknown agent/);
    await delay(50);
    db.prepare("UPDATE agents SET removed_at = ? WHERE name = 'receiver'").run(Date.now());
    await removed;
    db.prepare("UPDATE agents SET removed_at = NULL WHERE name = 'receiver'").run();
  });
  await test("answer then ack preserves answered state", async () => {
    await call("ask_async", { from: "sender", to: "receiver", question: "ready?" });
    const message = (await receive()).messages[0];
    await call("reply", { from: "receiver", message_id: message.id, message: "yes" });
    assert.equal(messageRow(message.id).delivered_at, null);
    const repliedAt = messageRow(message.id).replied_at;
    assert(repliedAt >= message.created_at);
    db.prepare("UPDATE messages SET claim_deadline = 0 WHERE id = ?").run(message.id);
    const recovered = (await receive({ since_id: message.id })).messages[0];
    assert.equal(recovered.id, message.id, "reply without ack must remain recoverable");
    await ack(recovered); await ack(recovered);
    assert.equal(messageRow(message.id).status, "answered");
    assert(messageRow(message.id).delivered_at >= repliedAt);
  });
  await test("webhook destinations and management are restricted", async () => {
    for (const url of ["http://example.com", "https://127.0.0.1", "https://[::1]", "https://2130706433", "https://localhost", "https://a.internal", "https://user:pass@example.com", "https://example.com?token=x", "https://example.com:8443"]) {
      assert.throws(() => validateWebhookUrl(url));
    }
    for (const role of ["viewer", "agent"] as const) {
      await assert.rejects(call("webhook_create", { agent: "receiver", url: "https://example.com/hooks" }, { ...owner, role }), /owners or managers/);
      await assert.rejects(call("webhook_list", {}, { ...owner, role }), /owners or managers/);
    }
  });
  let hook: any;
  const requests: { body: any; init: RequestInit }[] = [];
  let responseStatus = 503;
  let networkFailure = false;
  globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
    const body = String(init.body);
    const signature = (init.headers as Record<string, string>)["Agent-Bus-Signature"]!;
    const timestamp = signature.split(",")[0]!.slice(2);
    assert.equal(signature, `t=${timestamp},v1=${createHmac("sha256", hook.secret).update(`${timestamp}.${body}`).digest("hex")}`);
    assert.equal(init.redirect, "manual"); assert(init.signal);
    requests.push({ body: JSON.parse(body), init });
    if (networkFailure) throw new DOMException("simulated network timeout", "TimeoutError");
    return new Response(null, { status: responseStatus });
  }) as typeof fetch;
  await test("durable webhook retries preserve event ID, signature, privacy and inbox state", async () => {
    hook = (await call("webhook_create", { agent: "receiver", url: "https://example.com/receive" })).webhook;
    assert(!JSON.stringify(await call("webhook_list")).includes(hook.secret));
    await send("private content never in webhook");
    assert(alarm !== null);
    alarm = null; await bus.alarm();
    assert.equal(requests.length, 1);
    assert(!JSON.stringify(requests[0].body).includes("private content"));
    const event = requests[0].body;
    assert.equal(messageRow(event.message_id).status, "pending");
    assert.equal((db.prepare("SELECT state FROM webhook_deliveries WHERE id = ?").get(event.id) as any).state, "pending");
    assert(alarm !== null);
    db.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0").run();
    bus = new WorkspaceBusObject(state, env);
    responseStatus = 204;
    alarm = null; await bus.alarm();
    assert.equal(requests[1].body.id, event.id);
    assert.equal((db.prepare("SELECT state FROM webhook_deliveries WHERE id = ?").get(event.id) as any).state, "delivered");
    assert.equal(messageRow(event.message_id).status, "pending");
    assert.equal((await call("webhook_list")).automatic_model_wakeup, false);
    await ack((await receive()).messages[0]);
  });
  await test("human and channel fanout enqueue notifications; failure stops after eight attempts", async () => {
    await call("subscribe", { agent: "receiver", channel: "test" });
    await call("send_channel", { from: "sender", channel: "test", message: "channel" });
    await call("human_chat_post", { team: "delivery", project: "project", content: "@receiver human", request_id: crypto.randomUUID() });
    assert((db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE state = 'pending'").get() as any).n >= 2);
    responseStatus = 302;
    for (let i = 0; i < 8; i++) {
      db.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0 WHERE state = 'pending'").run();
      alarm = null; await bus.alarm();
    }
    assert.equal((db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE state = 'pending'").get() as any).n, 0);
    assert((db.prepare("SELECT COUNT(*) AS n FROM webhook_deliveries WHERE state = 'failed' AND attempts = 8").get() as any).n >= 2);
    for (const message of (await receive()).messages) await ack(message);
  });
  await test("network timeouts retry without exposing errors or consuming the inbox", async () => {
    await send("retry after timeout");
    networkFailure = true;
    alarm = null; await bus.alarm();
    const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE state = 'pending'").get() as any;
    assert.equal(delivery.attempts, 1);
    assert.equal(delivery.http_status, null);
    assert.equal(messageRow(delivery.message_id).status, "pending");
    assert(!JSON.stringify(await call("webhook_list")).includes("simulated network"));
    networkFailure = false; responseStatus = 200;
    db.prepare("UPDATE webhook_deliveries SET next_attempt_at = 0 WHERE id = ?").run(delivery.id);
    alarm = null; await bus.alarm();
    assert.equal((db.prepare("SELECT state FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any).state, "delivered");
    await ack((await receive()).messages[0]);
  });
  await test("revocation cancels queued notifications and alarm scheduling never postpones earlier work", async () => {
    await send("delete queued");
    await call("webhook_delete", { id: hook.id });
    const before = requests.length;
    alarm = null; await bus.alarm();
    assert.equal(requests.length, before);
    const early = Date.now() + 5000;
    const slow = scheduleDeliveryAlarm(storage, early + 60000);
    const fast = scheduleDeliveryAlarm(storage, early);
    await slow; await fast;
    assert.equal(alarm, early);
    await scheduleDeliveryAlarm(storage, early + 100000);
    assert.equal(alarm, early);
  });
  console.log(`Cloud delivery: ${assertions} scenarios passed.`);
} finally {
  globalThis.fetch = originalFetch;
  db.close();
}
