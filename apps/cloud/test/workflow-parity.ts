import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { WorkspaceBusObject } from "../src/durable-objects/workspace-bus";
import { WORKSPACE_SCHEMA_SQL } from "../src/durable-objects/schema";
import { metadataForTool } from "../src/mcp/tool-metadata";
import type { Env, WorkspaceContext } from "../src/shared/types";

const home = mkdtempSync(join(tmpdir(), "agent-bus-workflow-parity-"));
process.env.AGENT_BUS_DIR = home;
const local = await import("../../../src/bus");
const { getDb } = await import("../../../src/db");
const db = new Database(":memory:");
const sql = { exec(query: string, ...values: unknown[]) {
  if (query === WORKSPACE_SCHEMA_SQL) { db.exec(query); return { toArray: () => [] }; }
  const statement = db.prepare(query);
  const result = statement.reader ? statement.all(...values) : (statement.run(...values), []);
  return { toArray: () => result };
} };
const storage = { sql, transactionSync: (fn: () => unknown) => db.transaction(fn)(), getAlarm: async () => null, setAlarm: async () => {} };
const bus = new WorkspaceBusObject({ storage } as unknown as DurableObjectState, {} as Env);
const context: WorkspaceContext = { id: "test", slug: "test", role: "owner", principal: { kind: "user", id: "owner", role: "owner" } };
const scope = { project: "parity", team: "tests" };

async function call(op: string, input: Record<string, unknown> = {}, validate = true): Promise<any> {
  // Exercise public schemas, not just private handler methods (approval regression).
  const parsed = validate ? metadataForTool(op).inputSchema.parse(input) : input;
  const response = await bus.fetch(new Request("http://test/rpc", { method: "POST", body: JSON.stringify({ op, input: parsed, context }) }));
  const body = await response.json() as any;
  if (!body.ok) throw Object.assign(new Error(body.error.message), { code: body.error.code });
  return body.result;
}
function errorCode(fn: () => unknown): string | null {
  try { fn(); return null; } catch (e) { return (e as { code: string }).code; }
}
async function cloudCode(op: string, input: Record<string, unknown>): Promise<string | null> {
  try { await call(op, input); return null; } catch (e) { return (e as { code: string }).code; }
}
async function create(title: string, options: Record<string, unknown> = {}) {
  const input = { requested_by: "owner", title, ...scope, ...options };
  const l = local.createTask(input as Parameters<typeof local.createTask>[0]);
  const c = (await call("create_task", input)).task;
  assert.equal(c.id, l.id);
  return l.id;
}

try {
  for (const name of ["owner", "worker", "reviewer", "outsider"]) {
    local.register({ name, capabilities: ["test"], ...scope });
    await call("register", { name, capabilities: ["test"], ...scope });
  }
  const states = Object.keys(local.ALLOWED_TRANSITIONS) as local.TaskState[];
  for (const from of states) for (const to of states) {
    const id = await create(`${from}-${to}`);
    for (const database of [db, getDb()]) database.prepare("UPDATE tasks SET state = ?, claimed_by = 'worker' WHERE id = ?").run(from, id);
    const input = { agent: "worker", task_id: id, state: to };
    assert.equal(await cloudCode("update_task", input), errorCode(() => local.updateTask(input)), `${from} -> ${to}`);
    assert.equal((await call("get_task", { task_id: id })).task.state, local.getTask(id).state);
  }
  console.log("PASS: all 64 task transition outcomes match Local");

  const id = await create("independent review", { review_required: true, independent_review: true });
  assert.equal((await call("get_task", { task_id: id })).task.review_state, "pending");
  local.claimTask({ task_id: id, agent: "worker" });
  await call("claim_task", { task_id: id, agent: "worker" });
  assert.equal(await cloudCode("claim_task", { task_id: id, agent: "outsider" }), errorCode(() => local.claimTask({ task_id: id, agent: "outsider" })));
  for (const actor of ["worker", "outsider"]) {
    const input = { task_id: id, agent: actor, state: "completed" as const };
    assert.equal(await cloudCode("update_task", input), errorCode(() => local.updateTask(input)));
  }
  assert.equal(await cloudCode("submit_review", { task_id: id, reviewer: "worker", approved: true }), errorCode(() => local.submitReview({ task_id: id, reviewer: "worker", approved: true })));
  for (const approved of [false, true]) {
    local.submitReview({ task_id: id, reviewer: "reviewer", approved, notes: "evidence" });
    const result = await call("submit_review", { task_id: id, reviewer: "reviewer", review_state: approved ? "approved" : "changes_requested", notes: "evidence" });
    assert.equal(result.task.review_state, local.getTask(id).review_state);
    assert.equal(Boolean(result.task.manager_reviewed), local.getTask(id).manager_reviewed);
  }
  await assert.rejects(call("submit_review", { task_id: id, reviewer: "reviewer", approved: false, review_state: "approved" }), /conflicting/);
  local.updateTask({ task_id: id, agent: "worker", state: "completed" });
  const done = await call("update_task", { task_id: id, agent: "worker", state: "completed" });
  assert(done.task.finished_at);
  for (const op of ["release_task", "cancel_task", "claim_task"]) assert(await cloudCode(op, { task_id: id, agent: "worker" }), `${op} must reject terminal task`);
  await assert.rejects(call("update_task", { task_id: id, agent: "worker", review_state: "approved" }), /Unrecognized/);
  assert(done.events.filter((event: any) => event.metadata.includes("review_state")).length === 2);
  console.log("PASS: ownership, approval aliases, independent review, terminal guards and review history");

  const released = await create("release");
  local.claimTask({ task_id: released, agent: "worker" });
  await call("claim_task", { task_id: released, agent: "worker" });
  local.releaseTask({ task_id: released, agent: "worker" });
  const free = await call("release_task", { task_id: released, agent: "worker" });
  for (const key of ["claimed_by", "claimed_at", "pending_assignee"]) assert.equal(free.task[key], (local.getTask(released) as any)[key]);
  const backlog = await create("parked", { state: "backlog" });
  assert.equal(await cloudCode("claim_task", { task_id: backlog, agent: "worker" }), errorCode(() => local.claimTask({ task_id: backlog, agent: "worker" })));

  const phase = await create("phase");
  local.claimTask({ task_id: phase, agent: "worker" });
  await call("claim_task", { task_id: phase, agent: "worker" });
  local.agentNow({ agent: "worker", task_id: phase, phase: "testing", note: "running" });
  await call("now", { agent: "worker", task_id: phase, phase: "testing", note: "running" });
  const phaseTask = (await call("get_task", { task_id: phase })).task;
  assert.equal(phaseTask.phase, local.getTask(phase).phase);
  assert.equal(phaseTask.state, local.getTask(phase).state);
  const events = (await call("list_task_events", scope)).events;
  assert(events.some((event: any) => event.task_id === phase && event.phase === "testing"));
  assert(events.every((event: any) => event.project === scope.project && event.team === scope.team));
  console.log("PASS: release clears ownership timestamps; backlog and now/event scope match Local");

  for (const status of ["passed", "failed", "skipped"] as const) {
    const input = { by_agent: "worker", task_id: phase, command: `${status}-command`, status, ...scope };
    local.recordTestResult(input);
    await call("record_test_result", input);
  }
  const cloudReport = await call("final_report", scope);
  const localReport = local.finalReport(scope);
  for (const key of ["implemented", "not_implemented", "known_risks", "tests_passed", "manual_tests_needed", "warnings"] as const) {
    assert.deepEqual([...cloudReport[key]].sort(), [...localReport[key]].sort(), key);
  }
  for (const key of ["safe_to_commit", "safe_to_push", "safe_to_deploy"] as const) assert.equal(cloudReport[key], localReport[key]);
  assert(!cloudReport.tests_passed.some((text: string) => text.includes("failed-command")));
  const gate = await call("review_gate", scope);
  assert.equal(gate.ok, local.reviewGate(scope).ok);
  assert.equal(new Set(gate.blockers).size, gate.blockers.length);
  console.log("PASS: final report fields and review verdict match Local; failed tests stay in test_results only");

  const cleanScope = { project: "clean", team: "clean" };
  for (const name of ["clean-owner", "clean-reviewer"]) {
    local.register({ name, ...cleanScope });
    await call("register", { name, ...cleanScope });
  }
  const parkedInput = { requested_by: "clean-owner", title: "Future idea", state: "backlog" as const, ...cleanScope };
  local.createTask(parkedInput);
  await call("create_task", parkedInput);
  assert.equal((await call("review_gate", cleanScope)).ok, true, "backlog must not block delivery");
  assert.equal(local.reviewGate(cleanScope).ok, true);
  const cleanInput = { requested_by: "clean-owner", title: "Verified work", review_required: true, ...cleanScope };
  const cleanTask = local.createTask(cleanInput);
  await call("create_task", cleanInput);
  local.claimTask({ agent: "clean-owner", task_id: cleanTask.id });
  await call("claim_task", { agent: "clean-owner", task_id: cleanTask.id });
  local.submitReview({ reviewer: "clean-reviewer", task_id: cleanTask.id, approved: true });
  await call("submit_review", { reviewer: "clean-reviewer", task_id: cleanTask.id, approved: true });
  local.updateTask({ agent: "clean-owner", task_id: cleanTask.id, state: "completed" });
  await call("update_task", { agent: "clean-owner", task_id: cleanTask.id, state: "completed" });
  assert.equal((await call("review_gate", cleanScope)).ok, local.reviewGate(cleanScope).ok);
  assert.equal((await call("review_gate", cleanScope)).ok, true);
  console.log("PASS: backlog-only and independently reviewed clean work are safe in both runtimes");

  const memory = await call("remember", { by_agent: "worker", kind: "risk", content: "demo risk", ...scope });
  await call("pin_memory", { memory_id: memory.id });
  assert((await call("session_brief", scope)).pinned_memories.some((m: any) => m.id === memory.id));
  await call("unpin_memory", { memory_id: memory.id });
  const brief = await call("session_brief", scope);
  assert(!brief.pinned_memories.some((m: any) => m.id === memory.id));
  assert(brief.recent_memories.some((m: any) => m.id === memory.id));
  await call("record_decision", { by_agent: "worker", decision: "Keep parity tested", ...scope });
  await call("send", { from: "worker", to: "reviewer", message: "test delivery" });
  const inbox = await call("inbox", { agent: "reviewer", ...scope });
  assert(inbox.messages.length && inbox.messages.every((m: any) => m.status === "pending" && !m.delivered_at && m.claim_token));
  for (const message of inbox.messages) {
    await call("ack", { agent: "reviewer", message_id: message.id, claim_token: message.claim_token });
    assert.equal((await call("get_message", { message_id: message.id })).message.status, "delivered");
  }
  const activity = (await call("activity", { ...scope, limit: 200 })).activity;
  for (const type of ["message", "task_event", "test_result", "memory", "decision"]) assert(activity.some((event: any) => event.type === type), type);
  const bundle = await call("task_result", { task_id: phase });
  assert(Array.isArray(bundle.messages) && Array.isArray(bundle.memories));
  console.log("PASS: memory pinning, all activity sources, delivery metadata and task bundles");
  const inherited = await call("remember", { by_agent: "worker", kind: "fact", content: "inherit scope" });
  assert((await call("list_memories", scope)).memories.some((m: any) => m.id === inherited.id));
  const inheritedTest = await call("record_test_result", { by_agent: "reviewer", task_id: phase, command: "inherit task scope", status: "passed" });
  assert((await call("list_test_results", scope)).test_results.some((t: any) => t.id === inheritedTest.id));
} finally {
  db.close();
  getDb().close();
  rmSync(home, { recursive: true, force: true });
}
