import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import Database from "better-sqlite3";
import { WORKSPACE_SCHEMA_SQL } from "../src/durable-objects/schema";
import { eventOperation, deliverMcpEvents } from "../src/durable-objects/mcp-events";
import { WorkspaceBusObject } from "../src/durable-objects/workspace-bus";
import type { Env, WorkspaceContext } from "../src/shared/types";

const db = new Database(":memory:"); db.exec(WORKSPACE_SCHEMA_SQL);
db.exec("CREATE TABLE memberships (workspace_id TEXT, user_id TEXT, role TEXT); INSERT INTO memberships VALUES ('ws', 'owner', 'owner'), ('ws', 'other', 'agent');");
db.exec("CREATE TABLE agent_tokens (id TEXT, workspace_id TEXT, role TEXT); CREATE TABLE oauth_connections (id TEXT, workspace_id TEXT, user_id TEXT, role TEXT, revoked_at INTEGER, expires_at INTEGER);");
const sql = { exec(query: string, ...args: unknown[]) {
  if (query === WORKSPACE_SCHEMA_SQL) { db.exec(query); return { toArray: () => [] }; }
  const stmt = db.prepare(query); return { toArray: () => stmt.reader ? stmt.all(...args) : (stmt.run(...args), []) };
} };
// Execute writes immediately like Durable Object SQLite (not on toArray).
sql.exec = (query, ...args) => {
  if (query === WORKSPACE_SCHEMA_SQL) { db.exec(query); return { toArray: () => [] }; }
  const stmt = db.prepare(query); const rows = stmt.reader ? stmt.all(...args) : (stmt.run(...args), []); return { toArray: () => rows };
};
const storage = { sql, getAlarm: async () => null, setAlarm: async () => {}, transactionSync: (fn: () => unknown) => db.transaction(fn)() } as unknown as DurableObjectStorage;
const env = { AGENT_BUS_CLOUD_DB: { prepare: (query: string) => ({ bind: (...args: unknown[]) => ({ first: async () => db.prepare(query).get(...args) ?? null }) }) } } as unknown as Env;
const owner: WorkspaceContext = { id: "ws", slug: "ws", role: "owner", principal: { kind: "user", id: "owner", role: "owner" } };
const other: WorkspaceContext = { ...owner, principal: { kind: "user", id: "other", role: "agent" } };
const bus = new WorkspaceBusObject({ storage } as DurableObjectState, env);
async function call(op: string, input: Record<string, unknown>) {
  const response = await bus.fetch(new Request("https://test/rpc", { method: "POST", body: JSON.stringify({ op, input, context: owner }) }));
  const body = await response.json() as any; if (!body.ok) throw new Error(body.error.message); return body.result;
}
let secret = "whsec_" + Buffer.alloc(32, 7).toString("base64");
const request = (overrides: Record<string, unknown> = {}) => ({ name: "inbox.message_available", arguments: { agent: "receiver", team: "team" }, delivery: { mode: "webhook", url: "https://example.com/callback", secret }, ...overrides });
const subscribe = (input = request(), context = owner) => eventOperation(storage, env, context, "mcp_events_subscribe", input) as Promise<any>;
const unsubscribe = (input = request(), context = owner) => eventOperation(storage, env, context, "mcp_events_unsubscribe", input);
const originalFetch = globalThis.fetch;
const received: any[] = []; let status = 200; let validChallenge = true; let verifications = 0;
let duringVerify: (() => Promise<void>) | undefined;
globalThis.fetch = (async (_url: unknown, init: RequestInit) => {
  const body = String(init.body); const data = JSON.parse(body); const headers = new Headers(init.headers);
  const expected = createHmac("sha256", Buffer.from(secret.slice(6), "base64")).update(`${headers.get("webhook-id")}.${headers.get("webhook-timestamp")}.${body}`).digest("base64");
  assert(headers.get("webhook-signature")!.split(" ").includes("v1," + expected)); assert.equal(init.redirect, "manual");
  if (data.type === "verification") { verifications++; await duringVerify?.(); return Response.json({ challenge: validChallenge ? data.challenge : "wrong" }); }
  received.push({ data, headers }); return new Response(null, { status });
}) as typeof fetch;
let tests = 0;
async function test(name: string, run: () => Promise<void>) { await run(); console.log("PASS " + name); tests++; }
try {
  await call("register", { name: "sender", team: "team" }); await call("register", { name: "receiver", team: "team" });
  await test("callback verifies before activation; repeated subscription is idempotent", async () => {
    const first = await subscribe(); const second = await subscribe(); assert.equal(first.id, second.id); assert.equal(verifications, 1);
    assert.equal(first.cursor, null); assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_subscriptions").get() as any).n, 1);
  });
  await test("notification signed and retried with same event ID; never consumes inbox", async () => {
    const message = await call("send", { from: "sender", to: "receiver", message: "private contents" });
    status = 503; await deliverMcpEvents(storage, env);
    assert.equal(received.length, 1); assert.equal(received[0].data.data.message_id, message.id); assert(!JSON.stringify(received).includes("private contents"));
    assert.equal((db.prepare("SELECT status FROM messages WHERE id = ?").get(message.id) as any).status, "pending");
    db.prepare("UPDATE mcp_event_deliveries SET next_attempt_at=0").run(); status = 200; await deliverMcpEvents(storage, env);
    assert.equal(received[1].data.eventId, received[0].data.eventId);
    assert.equal((db.prepare("SELECT state FROM mcp_event_deliveries").get() as any).state, "delivered");
  });
  await test("nonmatching team does not enqueue; cursor replay is rejected honestly", async () => {
    const before = (db.prepare("SELECT COUNT(*) n FROM mcp_event_deliveries").get() as any).n;
    db.prepare("UPDATE agents SET team='elsewhere' WHERE name='sender'").run(); await call("send", { from: "sender", to: "receiver", message: "outside filter" });
    assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_deliveries").get() as any).n, before);
    await assert.rejects(subscribe(request({ cursor: "123" })));
    db.prepare("UPDATE agents SET team='team' WHERE name='sender'").run();
  });
  await test("secret rotation verifies and signs with both keys during grace period", async () => {
    secret = "whsec_" + Buffer.alloc(32, 9).toString("base64"); await subscribe();
    await call("send", { from: "sender", to: "receiver", message: "rotated" }); await deliverMcpEvents(storage, env);
    assert.equal(received.at(-1).headers.get("webhook-signature").split(" ").length, 2);
  });
  await test("unsubscribe is principal-scoped, idempotent and removes queued delivery", async () => {
    await unsubscribe(request(), other);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_subscriptions WHERE expires_at>0").get() as any).n, 1);
    await unsubscribe(); await unsubscribe(); const before = received.length; await deliverMcpEvents(storage, env); assert.equal(received.length, before);
  });
  await test("bad secrets, private URLs, unknown agents and viewers rejected", async () => {
    for (const url of ["http://example.com", "https://127.0.0.1", "https://a.internal", "https://example.com/?secret=x"]) await assert.rejects(subscribe(request({ delivery: { mode: "webhook", url, secret } })));
    await assert.rejects(subscribe(request({ delivery: { mode: "webhook", url: "https://example.com/callback", secret: "whsec_eA==" } })));
    await assert.rejects(subscribe(request({ arguments: { agent: "missing" } })));
    await assert.rejects(subscribe(request(), { ...owner, role: "viewer" }));
  });
  await test("failed callback and concurrent unsubscribe cannot activate a subscription", async () => {
    validChallenge = false; await assert.rejects(subscribe(), /MCP_CALLBACK_FAILED/); validChallenge = true;
    assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_generations").get() as any).n, 0);
    duringVerify = async () => { await unsubscribe(); }; await assert.rejects(subscribe(), /changed during verification/); duringVerify = undefined;
    assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_subscriptions WHERE expires_at>0").get() as any).n, 0);
  });
  await test("revoked membership cancels events before sending", async () => {
    await subscribe(); await call("send", { from: "sender", to: "receiver", message: "revoked" });
    db.prepare("DELETE FROM memberships WHERE user_id='owner'").run(); const before = received.length; await deliverMcpEvents(storage, env);
    assert.equal(received.length, before); assert.equal((db.prepare("SELECT COUNT(*) n FROM mcp_event_subscriptions").get() as any).n, 0);
    db.prepare("INSERT INTO memberships VALUES ('ws','owner','owner')").run();
  });
  await test("expiration prevents delivery and finite TTL caps unlimited requests", async () => {
    const sub = await subscribe(request({ ttlMs: null })); assert(Date.parse(sub.refreshBefore) <= Date.now() + 86400000);
    await call("send", { from: "sender", to: "receiver", message: "expired" }); db.prepare("UPDATE mcp_event_subscriptions SET expires_at=1").run();
    const before = received.length; await deliverMcpEvents(storage, env); assert.equal(received.length, before);
  });
  await test("paused agents defer notifications without consuming retry budget", async () => {
    await subscribe(); await call("send", { from: "sender", to: "receiver", message: "paused" });
    db.prepare("UPDATE agents SET paused=1 WHERE name='receiver'").run();
    const before = received.length; await deliverMcpEvents(storage, env); assert.equal(received.length, before);
    assert.equal((db.prepare("SELECT attempts FROM mcp_event_deliveries WHERE state='pending'").get() as any).attempts, 0);
    db.prepare("UPDATE agents SET paused=0 WHERE name='receiver'").run(); db.prepare("UPDATE mcp_event_deliveries SET next_attempt_at=0").run();
    await deliverMcpEvents(storage, env); assert.equal(received.length, before + 1); await unsubscribe();
  });
  await test("token deletion and OAuth revocation cancel subscriptions before delivery", async () => {
    for (const kind of ["agent_token", "oauth"] as const) {
      const context: WorkspaceContext = { ...owner, role: "agent", principal: { kind, id: "connection-test", role: "agent" } };
      if (kind === "agent_token") db.prepare("INSERT INTO agent_tokens VALUES ('connection-test','ws','agent')").run();
      else db.prepare("INSERT INTO oauth_connections VALUES ('connection-test','ws','owner','agent',NULL,?)").run(Date.now() + 60000);
      await subscribe(request(), context); await call("send", { from: "sender", to: "receiver", message: "revoked connection" });
      if (kind === "agent_token") db.prepare("DELETE FROM agent_tokens").run();
      else db.prepare("UPDATE oauth_connections SET revoked_at=1").run();
      const before = received.length; await deliverMcpEvents(storage, env); assert.equal(received.length, before);
      await assert.rejects(subscribe(request(), context), /revoked/);
    }
  });
  await test("410/413 are terminal and never retried", async () => {
    for (const code of [413, 410]) {
      await subscribe(); status = code; await call("send", { from: "sender", to: "receiver", message: "terminal" }); await deliverMcpEvents(storage, env);
      const before = received.length; db.prepare("UPDATE mcp_event_deliveries SET next_attempt_at=0").run(); await deliverMcpEvents(storage, env); assert.equal(received.length, before);
    } status = 200;
  });
  await test("reply idempotency survives lost response and cannot target another original", async () => {
    const original = await call("send", { from: "sender", to: "receiver", message: "reply once" });
    const input = { from: "receiver", message_id: original.id, message: "done", idempotency_key: "wake:receiver:1" };
    const a = await call("reply", input); const b = await call("reply", input); assert.deepEqual(a, b);
    assert.equal((db.prepare("SELECT COUNT(*) n FROM messages WHERE reply_to=?").get(original.id) as any).n, 1);
    const next = await call("send", { from: "sender", to: "receiver", message: "next" }); await assert.rejects(call("reply", { ...input, message_id: next.id }));
  });
  console.log(`${tests} MCP event delivery scenarios passed`);
} finally { globalThis.fetch = originalFetch; db.close(); }
