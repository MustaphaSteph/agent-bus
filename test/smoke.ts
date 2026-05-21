import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-"));
process.env.AGENT_BUS_DIR = tmp;

const {
  ack,
  acknowledgeTask,
  assignTask,
  claimTask,
  claimBestTask,
  checkScopeConflicts,
  createTask,
  directory,
  finalReport,
  getTask,
  ask,
  askBest,
  inbox,
  listTasks,
  listMemories,
  messagesSince,
  pinMemory,
  projectBoard,
  PROJECT_WILDCARD,
  recentMessages,
  register,
  recordDecision,
  remember,
  releaseTask,
  reply,
  send,
  sendChannel,
  sleepAgent,
  setPaused,
  subscribe,
  subscribers,
  threadMessages,
  unsubscribe,
  updateTask,
  wakeAgent,
  whois,
  listDecisions,
  sessionBrief,
  submitReview,
  handoffTask,
} = await import("../src/bus.js");
const { BusError } = await import("../src/util/errors.js");
const { closeDb, getDb } = await import("../src/db.js");
const { deriveProject, deriveScope } = await import("../src/util/project.js");

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++;
      console.log(`  ✓ ${name}`);
    })
    .catch((err) => {
      failed++;
      console.error(`  ✗ ${name}`);
      console.error("    ", err instanceof Error ? err.stack : err);
    });
}

console.log("agent-bus smoke tests");
console.log(`tmpdir: ${tmp}`);

await test("register + whois", () => {
  register({ name: "alice", capabilities: ["frontend"] });
  register({ name: "bob", capabilities: ["backend"] });
  const list = whois();
  assert.equal(list.length, 2);
  const names = list.map((a) => a.name).sort();
  assert.deepEqual(names, ["alice", "bob"]);
});

await test("register without replace on active name fails", () => {
  assert.throws(
    () => register({ name: "alice" }),
    (e: unknown) => e instanceof BusError && e.code === "NAME_TAKEN",
  );
});

await test("register with replace succeeds", () => {
  const a = register({ name: "alice", capabilities: ["frontend", "ui"], replace: true });
  assert.deepEqual(a.capabilities, ["frontend", "ui"]);
});

await test("agent sleep and wake update work status", () => {
  assert.equal(sleepAgent("alice").status, "sleeping");
  assert.equal(wakeAgent("alice").status, "idle");
});

await test("send + inbox round-trip", async () => {
  const sent = send({ from: "alice", to: "bob", content: "hello bob" });
  assert.equal(sent.kind, "msg");
  assert.equal(sent.status, "pending");
  const messages = await inbox({ agent: "bob" });
  assert.equal(messages.length, 1);
  assert.equal(messages[0]?.content, "hello bob");
});

await test("message priority: urgent inbox rows come first", async () => {
  send({ from: "alice", to: "bob", content: "low", priority: "low" });
  send({ from: "alice", to: "bob", content: "urgent", priority: "urgent" });
  const rows = await inbox({ agent: "bob", limit: 2 });
  assert.equal(rows[0]?.content, "urgent");
  assert.equal(rows[0]?.priority, "urgent");
});

await test("inbox marks delivered", async () => {
  const second = await inbox({ agent: "bob" });
  assert.equal(second.length, 0);
});

await test("inbox respects since_id", async () => {
  send({ from: "alice", to: "bob", content: "ping" });
  send({ from: "alice", to: "bob", content: "pong" });
  const fresh = await inbox({ agent: "bob", since_id: 0 });
  assert.equal(fresh.length, 2);
  const newest = fresh[fresh.length - 1]!;
  const empty = await inbox({ agent: "bob", since_id: newest.id });
  assert.equal(empty.length, 0);
});

await test("inbox wait_s returns immediately when messages exist", async () => {
  send({ from: "alice", to: "bob", content: "no-wait" });
  const t0 = Date.now();
  const got = await inbox({ agent: "bob", wait_s: 10 });
  const elapsed = Date.now() - t0;
  assert.equal(got.length, 1);
  assert.ok(elapsed < 500, `expected fast return, took ${elapsed}ms`);
});

await test("inbox wait_s blocks until message arrives", async () => {
  setTimeout(() => {
    send({ from: "alice", to: "bob", content: "late arrival" });
  }, 400);
  const t0 = Date.now();
  const got = await inbox({ agent: "bob", wait_s: 5 });
  const elapsed = Date.now() - t0;
  assert.equal(got.length, 1);
  assert.equal(got[0]?.content, "late arrival");
  assert.ok(elapsed >= 300, `expected to wait ~400ms, took ${elapsed}ms`);
});

await test("inbox wait_s times out cleanly with empty array", async () => {
  const t0 = Date.now();
  const got = await inbox({ agent: "bob", wait_s: 1 });
  const elapsed = Date.now() - t0;
  assert.deepEqual(got, []);
  assert.ok(elapsed >= 900 && elapsed < 1500, `expected ~1s wait, took ${elapsed}ms`);
});

await test("unknown recipient rejected", () => {
  assert.throws(
    () => send({ from: "alice", to: "ghost", content: "x" }),
    (e: unknown) => e instanceof BusError && e.code === "UNKNOWN_AGENT",
  );
});

await test("very large messages are accepted", async () => {
  const big = "x".repeat(2 * 1024 * 1024);
  const sent = send({ from: "alice", to: "bob", content: big });
  assert.equal(sent.content.length, big.length);
  const got = await inbox({ agent: "bob" });
  const found = got.find((m) => m.id === sent.id);
  assert.ok(found, "expected large message to land in inbox");
  assert.equal(found.content.length, big.length);
});

await test("paused agent gets empty inbox; resume restores", async () => {
  setPaused("bob", true);
  send({ from: "alice", to: "bob", content: "queued" });
  const whilePaused = await inbox({ agent: "bob" });
  assert.equal(whilePaused.length, 0);
  setPaused("bob", false);
  const got = await inbox({ agent: "bob" });
  assert.equal(got.length, 1);
  assert.equal(got[0]?.content, "queued");
});

await test("ask + reply round-trip", async () => {
  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "bob" });
    const askMsg = pending.find((m) => m.kind === "ask");
    assert.ok(askMsg, "expected an ask in bob's inbox");
    reply({ from: "bob", ask_id: askMsg.id, answer: "42" });
  }, 300);

  const answer = await ask({ from: "alice", to: "bob", question: "meaning?", timeout_s: 5 });
  clearTimeout(replier);
  assert.equal(answer.kind, "reply");
  assert.equal(answer.content, "42");
});

await test("ask timeout fires", async () => {
  await assert.rejects(
    () => ask({ from: "alice", to: "bob", question: "silence?", timeout_s: 1 }),
    (e: unknown) => e instanceof BusError && e.code === "ASK_TIMEOUT",
  );
});

await test("mutual ask is rejected as cycle", async () => {
  const askA = ask({ from: "alice", to: "bob", question: "longer", timeout_s: 5 });
  await new Promise((r) => setTimeout(r, 100));

  await assert.rejects(
    () => ask({ from: "bob", to: "alice", question: "reverse", timeout_s: 5 }),
    (e: unknown) => e instanceof BusError && e.code === "ASK_CYCLE",
  );

  const pending = await inbox({ agent: "bob" });
  const target = pending
    .filter((m) => m.kind === "ask" && m.content === "longer")
    .pop();
  assert.ok(target, "expected the in-flight ask in bob's inbox");
  reply({ from: "bob", ask_id: target.id, answer: "cleanup" });
  const answer = await askA;
  assert.equal(answer.content, "cleanup");
});

await test("invalid name rejected", () => {
  assert.throws(
    () => register({ name: "bad name!" }),
    (e: unknown) => e instanceof BusError && e.code === "INVALID_INPUT",
  );
});

await test("recentMessages returns ascending order", () => {
  const r = recentMessages(10);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i]!.id > r[i - 1]!.id, "should be ascending");
  }
});

// --- Tier 1: threads, ack, channels, ask_best -------------------------------

await test("send auto-generates a thread_id", () => {
  const m = send({ from: "alice", to: "bob", content: "thread test" });
  assert.ok(m.thread_id.startsWith("t_"), "expected auto thread_id");
});

await test("send carries provided thread_id", () => {
  const m = send({ from: "alice", to: "bob", content: "x", thread_id: "t_explicit_1" });
  assert.equal(m.thread_id, "t_explicit_1");
});

await test("reply inherits thread_id from ask", async () => {
  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "bob" });
    const a = pending.find((m) => m.kind === "ask");
    assert.ok(a, "ask missing");
    reply({ from: "bob", ask_id: a.id, answer: "ok" });
  }, 200);
  const answer = await ask({
    from: "alice",
    to: "bob",
    question: "thread inherit?",
    timeout_s: 5,
    thread_id: "t_inherit_xyz",
  });
  clearTimeout(replier);
  assert.equal(answer.thread_id, "t_inherit_xyz");
});

await test("threadMessages returns all messages in a thread, in order", () => {
  const tid = "t_chain_42";
  send({ from: "alice", to: "bob", content: "1", thread_id: tid });
  send({ from: "bob", to: "alice", content: "2", thread_id: tid });
  send({ from: "alice", to: "bob", content: "3", thread_id: tid });
  const chain = threadMessages(tid);
  assert.equal(chain.length, 3);
  assert.deepEqual(chain.map((m) => m.content), ["1", "2", "3"]);
});

await test("ack: claim_s keeps message pending until ack", async () => {
  send({ from: "alice", to: "bob", content: "ack-me" });
  const first = await inbox({ agent: "bob", claim_s: 60 });
  const target = first.find((m) => m.content === "ack-me");
  assert.ok(target, "claimed message missing");
  assert.equal(target.status, "pending", "should remain pending under claim");

  const concurrent = await inbox({ agent: "bob" });
  assert.ok(
    !concurrent.find((m) => m.id === target.id),
    "claimed message should not be visible to concurrent inbox",
  );

  const acked = ack({ agent: "bob", message_id: target.id });
  assert.equal(acked.status, "delivered");

  const afterAck = await inbox({ agent: "bob" });
  assert.ok(!afterAck.find((m) => m.id === target.id), "acked message should not redeliver");
});

await test("ack: expired claim redelivers the message", async () => {
  send({ from: "alice", to: "bob", content: "redeliver-me" });
  const first = await inbox({ agent: "bob", claim_s: 1 });
  const target = first.find((m) => m.content === "redeliver-me");
  assert.ok(target);

  await new Promise((r) => setTimeout(r, 1100));

  const second = await inbox({ agent: "bob" });
  assert.ok(
    second.find((m) => m.id === target.id),
    "expired claim should make message visible again",
  );
});

await test("subscribe + send_channel fans out to subscribers", () => {
  register({ name: "carol", capabilities: ["frontend"] });
  register({ name: "dave", capabilities: ["frontend"] });
  subscribe({ agent: "carol", channel: "frontend-team" });
  subscribe({ agent: "dave", channel: "frontend-team" });

  const list = subscribers("frontend-team");
  assert.deepEqual(list.sort(), ["carol", "dave"]);

  const sent = sendChannel({ from: "alice", channel: "frontend-team", content: "standup at 10" });
  assert.equal(sent.length, 2);
  for (const m of sent) {
    assert.equal(m.channel, "frontend-team");
    assert.equal(m.content, "standup at 10");
  }
});

await test("send_channel excludes the sender even if they are subscribed", () => {
  subscribe({ agent: "alice", channel: "frontend-team" });
  const sent = sendChannel({ from: "alice", channel: "frontend-team", content: "no self echo" });
  const recipients = sent.map((m) => m.to_agent).sort();
  assert.deepEqual(recipients, ["carol", "dave"]);
});

await test("unsubscribe removes the agent from the channel", () => {
  unsubscribe({ agent: "dave", channel: "frontend-team" });
  assert.deepEqual(subscribers("frontend-team").sort(), ["alice", "carol"]);
});

await test("ask_best routes to a capability-matching agent", async () => {
  register({ name: "react-expert", capabilities: ["react", "css"] });
  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "react-expert" });
    const a = pending.find((m) => m.kind === "ask");
    assert.ok(a, "expected ask in react-expert inbox");
    reply({ from: "react-expert", ask_id: a.id, answer: "use useMemo" });
  }, 200);
  const answer = await askBest({
    from: "alice",
    capability: "react",
    question: "how to memoize this?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.equal(answer.content, "use useMemo");
  assert.equal(answer.from_agent, "react-expert");
});

await test("register roles influence directory and ask_best routing", async () => {
  register({ name: "role-asker", replace: true });
  register({ name: "role-worker", capabilities: ["audit"], role: "worker", routing_weight: 1 });
  register({ name: "role-verifier", capabilities: ["audit"], role: "verifier", routing_weight: 5 });

  const listing = directory().find((a) => a.name === "role-verifier");
  assert.equal(listing?.role, "verifier");
  assert.equal(listing?.presence, "online");

  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "role-verifier" });
    const askMsg = pending.find((m) => m.kind === "ask");
    assert.ok(askMsg, "expected role-scoped ask");
    reply({ from: "role-verifier", ask_id: askMsg.id, answer: "verified" });
  }, 200);
  const answer = await askBest({
    from: "role-asker",
    capability: "audit",
    role: "verifier",
    question: "?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.equal(answer.from_agent, "role-verifier");
});

await test("ask_best fails when no agent has the capability", async () => {
  await assert.rejects(
    () => askBest({ from: "alice", capability: "rust-async-runtime", question: "?", timeout_s: 1 }),
    (e: unknown) => e instanceof BusError && e.code === "UNKNOWN_AGENT",
  );
});

// --- Tier 3: project scoping ------------------------------------------------

await test("deriveProject uses git root basename and sanitizes", () => {
  const root = mkdtempSync(join(tmpdir(), "agent bus weird!"));
  mkdirSync(join(root, ".git"));
  const child = join(root, "nested", "src");
  mkdirSync(child, { recursive: true });

  assert.ok(deriveProject(child)?.startsWith("agent-bus-weird"));

  const fallback = mkdtempSync(join(tmpdir(), "plain project!"));
  assert.ok(deriveProject(fallback)?.startsWith("plain-project"));

  rmSync(root, { recursive: true, force: true });
  rmSync(fallback, { recursive: true, force: true });
});

await test("deriveScope reads .agent-bus.json areas from cwd", () => {
  const root = mkdtempSync(join(tmpdir(), "agent bus scoped!"));
  mkdirSync(join(root, ".git"));
  mkdirSync(join(root, "apps", "ios"), { recursive: true });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  writeFileSync(
    join(root, ".agent-bus.json"),
    JSON.stringify({
      project: "mobile-suite",
      areas: {
        ios: ["apps/ios/**"],
        backend: ["services/api/**"],
      },
    }),
  );

  assert.deepEqual(deriveScope(join(root, "apps", "ios", "Sources")), {
    project: "mobile-suite",
    area: "ios",
  });
  assert.deepEqual(deriveScope(join(root, "services", "api")), {
    project: "mobile-suite",
    area: "backend",
  });

  rmSync(root, { recursive: true, force: true });
});

await test("project: register, whois, send, recent, and messagesSince scope", () => {
  register({ name: "p1-alice", project: "p1", capabilities: ["review"] });
  register({ name: "p1-bob", project: "p1" });
  register({ name: "p2-alice", project: "p2" });
  register({ name: "global-agent", replace: true });

  const p1 = send({ from: "p1-alice", to: "p1-bob", content: "p1 message" });
  const p2 = send({ from: "p2-alice", to: "p1-bob", content: "p2 message" });
  const global = send({ from: "global-agent", to: "p1-bob", content: "global message" });

  assert.equal(p1.project, "p1");
  assert.equal(p2.project, "p2");
  assert.equal(global.project, null);
  assert.equal(p1.area, null);

  const p1Whois = whois({ project: "p1" }).map((a) => a.name);
  assert.ok(p1Whois.includes("p1-alice"));
  assert.ok(p1Whois.includes("p1-bob"));
  assert.ok(p1Whois.includes("global-agent"));
  assert.ok(!p1Whois.includes("p2-alice"));

  const allWhois = whois({ project: PROJECT_WILDCARD }).map((a) => a.name);
  assert.ok(allWhois.includes("p1-alice"));
  assert.ok(allWhois.includes("p2-alice"));

  const p1Recent = recentMessages({ project: "p1", limit: 50 }).map((m) => m.id);
  assert.ok(p1Recent.includes(p1.id));
  assert.ok(p1Recent.includes(global.id));
  assert.ok(!p1Recent.includes(p2.id));

  const p1Since = messagesSince(0, 500, "p1").map((m) => m.id);
  assert.ok(p1Since.includes(p1.id));
  assert.ok(p1Since.includes(global.id));
  assert.ok(!p1Since.includes(p2.id));
});

await test("area: register, messages, ask_best, and tasks stay in lane", async () => {
  register({ name: "area-asker", project: "app", area: "ios" });
  register({ name: "area-ios", project: "app", area: "ios", capabilities: ["build"] });
  register({ name: "area-backend", project: "app", area: "backend", capabilities: ["build"] });
  register({ name: "area-manager", project: "app", area: "pm", capabilities: ["plan"] });

  const iosMsg = send({ from: "area-ios", to: "area-manager", content: "ios update" });
  const backendMsg = send({ from: "area-backend", to: "area-manager", content: "backend update" });
  assert.equal(iosMsg.area, "ios");
  assert.equal(backendMsg.area, "backend");

  const iosWhois = whois({ project: "app", area: "ios" }).map((a) => a.name);
  assert.ok(iosWhois.includes("area-ios"));
  assert.ok(!iosWhois.includes("area-backend"));

  const iosRecent = recentMessages({ project: "app", area: "ios", limit: 50 }).map((m) => m.id);
  assert.ok(iosRecent.includes(iosMsg.id));
  assert.ok(!iosRecent.includes(backendMsg.id));

  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "area-ios" });
    const askMsg = pending.find((m) => m.kind === "ask");
    assert.ok(askMsg, "expected area-scoped ask");
    reply({ from: "area-ios", ask_id: askMsg.id, answer: "ios build answer" });
  }, 200);

  const answer = await askBest({
    from: "area-asker",
    capability: "build",
    question: "build?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.equal(answer.from_agent, "area-ios");

  await assert.rejects(
    () =>
      askBest({
        from: "area-asker",
        capability: "plan",
        question: "?",
        timeout_s: 1,
      }),
    (e: unknown) =>
      e instanceof BusError &&
      e.code === "UNKNOWN_AGENT" &&
      e.message.includes("area 'ios'") &&
      e.message.includes('area="*"'),
  );

  const iosTask = createTask({ requested_by: "area-ios", title: "ios task" });
  const backendTask = createTask({ requested_by: "area-backend", title: "backend task" });
  assert.equal(iosTask.area, "ios");
  assert.equal(backendTask.area, "backend");

  const iosTasks = listTasks({ project: "app", area: "ios", include_terminal: true }).map((t) => t.id);
  assert.ok(iosTasks.includes(iosTask.id));
  assert.ok(!iosTasks.includes(backendTask.id));

  const allAreaTasks = listTasks({ project: "app", area: PROJECT_WILDCARD, include_terminal: true }).map((t) => t.id);
  assert.ok(allAreaTasks.includes(iosTask.id));
  assert.ok(allAreaTasks.includes(backendTask.id));
});

await test("project: ask_best is scoped and fails loud for wrong project", async () => {
  register({ name: "p3-asker", project: "p3" });
  register({ name: "p3-react", project: "p3", capabilities: ["react"] });
  register({ name: "p4-python", project: "p4", capabilities: ["python"] });

  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "p3-react" });
    const a = pending.find((m) => m.kind === "ask");
    assert.ok(a, "expected project-scoped ask");
    reply({ from: "p3-react", ask_id: a.id, answer: "p3 answer" });
  }, 200);

  const answer = await askBest({
    from: "p3-asker",
    capability: "react",
    question: "memo?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.equal(answer.from_agent, "p3-react");

  await assert.rejects(
    () =>
      askBest({
        from: "p3-asker",
        capability: "python",
        question: "?",
        timeout_s: 1,
      }),
    (e: unknown) =>
      e instanceof BusError &&
      e.code === "UNKNOWN_AGENT" &&
      e.message.includes("project 'p3'") &&
      e.message.includes('project="*"'),
  );
});

await test("project: tasks inherit requester project and scoped list hides null tasks", () => {
  register({ name: "p5-requester", project: "p5" });
  register({ name: "p6-requester", project: "p6" });
  register({ name: "null-requester", replace: true });

  const p5 = createTask({ requested_by: "p5-requester", title: "p5 task" });
  const p6 = createTask({ requested_by: "p6-requester", title: "p6 task" });
  const legacy = createTask({ requested_by: "null-requester", title: "null task" });

  assert.equal(p5.project, "p5");
  assert.equal(p6.project, "p6");
  assert.equal(legacy.project, null);

  const p5Tasks = listTasks({ project: "p5", include_terminal: true }).map((t) => t.id);
  assert.ok(p5Tasks.includes(p5.id));
  assert.ok(!p5Tasks.includes(p6.id));
  assert.ok(!p5Tasks.includes(legacy.id));

  const allTasks = listTasks({ project: PROJECT_WILDCARD, include_terminal: true }).map((t) => t.id);
  assert.ok(allTasks.includes(p5.id));
  assert.ok(allTasks.includes(p6.id));
  assert.ok(allTasks.includes(legacy.id));
});

// --- Tier 2: first-class tasks ---------------------------------------------

await test("tasks: create + get round-trip", () => {
  const t = createTask({
    requested_by: "alice",
    title: "verify current diff",
    description: "run tests and report findings",
    priority: 3,
    cwd: "/repo",
    mode: "investigate_only",
    expected_output: "structured report",
    deadline_at: 123456,
    checkin_at: 123000,
    file_scope: ["src/**", "test/**"],
  });
  assert.equal(t.state, "open");
  assert.equal(t.requested_by, "alice");
  assert.equal(t.priority, 3);
  assert.equal(t.cwd, "/repo");
  assert.equal(t.mode, "investigate_only");
  assert.equal(t.expected_output, "structured report");
  assert.deepEqual(t.file_scope, ["src/**", "test/**"]);
  assert.ok(t.thread_id.startsWith("t_"));

  const fetched = getTask(t.id);
  assert.equal(fetched.id, t.id);
  assert.equal(fetched.title, "verify current diff");
});

await test("tasks: capability requirements, assign, and claim_best", () => {
  register({ name: "task-rust", capabilities: ["rust"], replace: true, project: "taskp", area: "backend" });
  register({ name: "task-js", capabilities: ["js"], replace: true, project: "taskp", area: "backend" });
  const t = createTask({
    requested_by: "task-rust",
    title: "rust task",
    required_capability: "rust",
    project: "taskp",
    area: "backend",
  });
  assert.equal(t.required_capability, "rust");
  assert.throws(
    () => assignTask({ task_id: t.id, to_agent: "task-js" }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_FORBIDDEN",
  );

  const claimed = claimBestTask({ agent: "task-rust" });
  assert.equal(claimed?.id, t.id);
  assert.equal(claimed?.claimed_by, "task-rust");
});

await test("tasks: manager checklist fields update and final report uses review state", () => {
  const t = createTask({
    requested_by: "alice",
    title: "reviewable task",
    mode: "test_only",
    expected_output: "test report",
  });
  claimTask({ agent: "bob", task_id: t.id });
  updateTask({
    agent: "bob",
    task_id: t.id,
    state: "working",
    final_answer: "tests passed",
  });
  updateTask({
    agent: "bob",
    task_id: t.id,
    state: "completed",
    manager_reviewed: true,
    result: "done",
  });

  const report = finalReport({ project: PROJECT_WILDCARD, area: PROJECT_WILDCARD });
  assert.ok(report.implemented.includes("reviewable task"));
  assert.ok(report.tests_passed.includes("tests passed"));
  assert.equal(report.safe_to_deploy, false);
});

await test("tasks: scope conflicts block overlapping active edits unless allowed", () => {
  register({ name: "scope-pm", project: "scope", area: "frontend", replace: true });
  register({ name: "scope-a", project: "scope", area: "frontend", replace: true });
  register({ name: "scope-b", project: "scope", area: "frontend", replace: true });
  const first = createTask({
    requested_by: "scope-pm",
    title: "edit auth form",
    file_scope: ["src/components/auth/**"],
  });
  claimTask({ agent: "scope-a", task_id: first.id });

  const conflicts = checkScopeConflicts({
    project: "scope",
    area: "frontend",
    file_scope: ["src/components/auth/LoginForm.tsx"],
  });
  assert.equal(conflicts.length, 1);
  assert.equal(conflicts[0]?.task_id, first.id);

  const second = createTask({
    requested_by: "scope-pm",
    title: "edit auth input",
    file_scope: ["src/components/auth/LoginForm.tsx"],
    allow_conflicts: true,
  });
  assert.throws(
    () => claimTask({ agent: "scope-b", task_id: second.id }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_SCOPE_CONFLICT",
  );
  const claimed = claimTask({ agent: "scope-b", task_id: second.id, allow_conflicts: true });
  assert.equal(claimed.claimed_by, "scope-b");
});

await test("tasks: assignment notification and acknowledgement receipt", async () => {
  register({ name: "ack-pm", project: "ackp", replace: true });
  register({ name: "ack-worker", project: "ackp", replace: true });
  const task = createTask({
    requested_by: "ack-pm",
    title: "ack task",
    ack_required: true,
  });
  assignTask({ task_id: task.id, to_agent: "ack-worker" });
  const assignedMessages = await inbox({ agent: "ack-worker" });
  assert.ok(assignedMessages.some((msg) => msg.content.includes("assigned task")));

  const acked = acknowledgeTask({
    agent: "ack-worker",
    task_id: task.id,
    response: "claimed",
    note: "starting now",
  });
  assert.equal(acked.acknowledged_by, "ack-worker");
  assert.ok(acked.acknowledged_at !== null);
  const receipts = await inbox({ agent: "ack-pm" });
  assert.ok(receipts.some((msg) => msg.content.includes("acknowledged task")));
});

await test("tasks: review gate requires approval before completion", () => {
  register({ name: "review-pm", project: "reviewp", replace: true });
  register({ name: "review-worker", project: "reviewp", replace: true });
  register({ name: "reviewer", project: "reviewp", role: "verifier", replace: true });
  const task = createTask({
    requested_by: "review-pm",
    title: "review-gated task",
    review_required: true,
    file_scope: ["src/review/**"],
  });
  claimTask({ agent: "review-worker", task_id: task.id });
  updateTask({
    agent: "review-worker",
    task_id: task.id,
    state: "working",
    changed_files: ["src/review/a.ts"],
  });
  assert.throws(
    () => updateTask({ agent: "review-worker", task_id: task.id, state: "completed" }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_REVIEW_REQUIRED",
  );
  const reviewed = submitReview({
    reviewer: "reviewer",
    task_id: task.id,
    approved: true,
    notes: "looks good",
  });
  assert.equal(reviewed.review_state, "approved");
  const done = updateTask({ agent: "review-worker", task_id: task.id, state: "completed" });
  assert.equal(done.state, "completed");
});

await test("tasks: handoff records pinned memory and reassigns", () => {
  register({ name: "handoff-pm", project: "handoffp", replace: true });
  register({ name: "handoff-a", project: "handoffp", replace: true });
  register({ name: "handoff-b", project: "handoffp", replace: true });
  const task = createTask({ requested_by: "handoff-pm", title: "handoff task" });
  claimTask({ agent: "handoff-a", task_id: task.id });
  const result = handoffTask({
    from_agent: "handoff-a",
    to_agent: "handoff-b",
    task_id: task.id,
    reason: "switching sessions",
  });
  assert.equal(result.task.claimed_by, "handoff-b");
  assert.ok(result.memory?.pinned);
  assert.equal(result.memory?.kind, "handoff");
});

await test("project board: summarizes review and pinned risks", () => {
  register({ name: "board-pm", project: "boardp", area: "frontend", replace: true });
  register({ name: "board-worker", project: "boardp", area: "frontend", replace: true });
  const task = createTask({
    requested_by: "board-pm",
    title: "board review task",
    review_required: true,
    file_scope: ["src/board/**"],
  });
  claimTask({ agent: "board-worker", task_id: task.id });
  remember({
    by_agent: "board-pm",
    kind: "risk",
    content: "Board task has pending review.",
    project: "boardp",
    area: "frontend",
    pinned: true,
  });
  const board = projectBoard({ project: "boardp", area: "frontend" });
  assert.ok(board.active_tasks.some((row) => row.id === task.id));
  assert.ok(board.waiting_review.some((row) => row.id === task.id));
  assert.ok(board.pinned_risks.some((row) => row.content.includes("pending review")));
});

await test("decisions: record and list by scope", () => {
  register({ name: "decision-pm", project: "dp", area: "backend", replace: true });
  const decision = recordDecision({
    by_agent: "decision-pm",
    decision: "Use task modes for agent permissions",
    rationale: "prevents accidental edits",
    implemented: true,
  });
  assert.equal(decision.project, "dp");
  assert.equal(decision.area, "backend");
  const listed = listDecisions({ project: "dp", area: "backend" });
  assert.ok(listed.some((row) => row.id === decision.id && row.implemented));
});

await test("memories: remember and list by scope and metadata", () => {
  register({ name: "memory-pm", project: "mp", area: "backend", replace: true });
  register({ name: "memory-worker", project: "mp", area: "backend", replace: true });
  const task = createTask({ requested_by: "memory-pm", title: "memory linked task" });
  const oldMemory = remember({
    by_agent: "memory-pm",
    kind: "handoff",
    content: "Old backend handoff.",
  });
  const memory = remember({
    by_agent: "memory-pm",
    agent: "memory-worker",
    kind: "handoff",
    content: "Worker owns backend memory tests.",
    task_id: task.id,
    thread_id: "thread-memory",
    pinned: true,
    supersedes_id: oldMemory.id,
  });
  assert.equal(memory.project, "mp");
  assert.equal(memory.area, "backend");
  assert.equal(memory.task_id, task.id);
  assert.equal(memory.pinned, true);
  assert.equal(memory.supersedes_id, oldMemory.id);

  const listed = listMemories({
    project: "mp",
    area: "backend",
    agent: "memory-worker",
    kind: "handoff",
    task_id: task.id,
    thread_id: "thread-memory",
    pinned: true,
  });
  assert.deepEqual(listed.map((row) => row.id), [memory.id]);

  const unpinned = pinMemory(memory.id, false);
  assert.equal(unpinned.pinned, false);
});

await test("session brief: summarizes current scope", () => {
  register({ name: "brief-pm", project: "bp", area: "docs", replace: true });
  register({ name: "brief-worker", project: "bp", area: "docs", replace: true });
  const task = createTask({
    requested_by: "brief-pm",
    title: "write handoff docs",
    project: "bp",
    area: "docs",
  });
  recordDecision({
    by_agent: "brief-pm",
    decision: "Use structured memories for handoffs",
  });
  const memory = remember({
    by_agent: "brief-pm",
    kind: "summary",
    content: "Session brief includes active agents and open tasks.",
    pinned: true,
  });
  send({ from: "brief-pm", to: "brief-worker", content: "Please read the brief." });

  const brief = sessionBrief({ project: "bp", area: "docs" });
  assert.ok(brief.active_agents.some((agent) => agent.name === "brief-pm"));
  assert.ok(brief.open_tasks.some((row) => row.id === task.id));
  assert.ok(brief.recent_decisions.some((row) => row.decision.includes("structured memories")));
  assert.ok(brief.pinned_memories.some((row) => row.id === memory.id));
  assert.ok(brief.recent_messages.some((row) => row.content.includes("Please read")));
  assert.ok(brief.suggested_next_actions.length > 0);
});

await test("tasks: atomic claim rejects second claimant", () => {
  const t = createTask({ requested_by: "alice", title: "claim race" });
  const claimed = claimTask({ agent: "bob", task_id: t.id });
  assert.equal(claimed.state, "claimed");
  assert.equal(claimed.claimed_by, "bob");

  assert.throws(
    () => claimTask({ agent: "carol", task_id: t.id }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_NOT_CLAIMABLE",
  );
});

await test("tasks: happy path transitions through blocked to completed", () => {
  const blocker = createTask({ requested_by: "alice", title: "dependency task" });
  const t = createTask({ requested_by: "alice", title: "state machine" });
  claimTask({ agent: "bob", task_id: t.id });

  const working = updateTask({ agent: "bob", task_id: t.id, state: "working" });
  assert.equal(working.state, "working");

  const blocked = updateTask({
    agent: "bob",
    task_id: t.id,
    state: "blocked",
    blocked_reason: "waiting for dependency",
    blocked_on_task_id: blocker.id,
  });
  assert.equal(blocked.state, "blocked");
  assert.equal(blocked.blocked_reason, "waiting for dependency");
  assert.equal(blocked.blocked_on_task_id, blocker.id);

  const resumed = updateTask({ agent: "bob", task_id: t.id, state: "working" });
  assert.equal(resumed.state, "working");

  const completed = updateTask({
    agent: "bob",
    task_id: t.id,
    state: "completed",
    result: "done",
  });
  assert.equal(completed.state, "completed");
  assert.equal(completed.result, "done");
  assert.ok(completed.finished_at !== null);
});

await test("tasks: invalid transitions are rejected", () => {
  const t = createTask({ requested_by: "alice", title: "bad transition" });
  assert.throws(
    () => updateTask({ agent: "alice", task_id: t.id, state: "working" }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_INVALID_TRANSITION",
  );

  const claimed = claimTask({ agent: "bob", task_id: t.id });
  assert.equal(claimed.state, "claimed");
  updateTask({ agent: "bob", task_id: t.id, state: "failed", result: "could not proceed" });
  assert.throws(
    () => updateTask({ agent: "bob", task_id: t.id, state: "working" }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_INVALID_TRANSITION",
  );
});

await test("tasks: release returns a claimed task to open", () => {
  const t = createTask({ requested_by: "alice", title: "release me" });
  claimTask({ agent: "bob", task_id: t.id });
  const released = releaseTask({ agent: "bob", task_id: t.id });
  assert.equal(released.state, "open");
  assert.equal(released.claimed_by, null);
  assert.equal(released.claimed_at, null);
});

await test("tasks: list filters and terminal inclusion work", () => {
  const active = createTask({ requested_by: "alice", title: "active task", priority: 10 });
  const done = createTask({ requested_by: "alice", title: "terminal task" });
  claimTask({ agent: "bob", task_id: done.id });
  updateTask({ agent: "bob", task_id: done.id, state: "working" });
  updateTask({ agent: "bob", task_id: done.id, state: "completed" });

  const defaultList = listTasks();
  assert.ok(defaultList.some((t) => t.id === active.id));
  assert.ok(!defaultList.some((t) => t.id === done.id));

  const all = listTasks({ include_terminal: true });
  assert.ok(all.some((t) => t.id === done.id));

  const completed = listTasks({ state: "completed" });
  assert.ok(completed.some((t) => t.id === done.id));
});

await test("tasks: stale flag surfaces old holders", () => {
  const t = createTask({ requested_by: "alice", title: "stale holder" });
  claimTask({ agent: "bob", task_id: t.id });
  getDb()
    .prepare("UPDATE agents SET last_seen = ? WHERE name = ?")
    .run(Date.now() - 10 * 60 * 1000, "bob");

  const listed = listTasks({ state: "claimed" }).find((task) => task.id === t.id);
  assert.ok(listed, "expected task in claimed list");
  assert.equal(listed.stale, true);
});

await test("tasks: blocked_on_task_id must reference an existing task", () => {
  assert.throws(
    () => createTask({ requested_by: "alice", title: "missing dep", blocked_on_task_id: 999_999 }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_NOT_FOUND",
  );

  const t = createTask({ requested_by: "alice", title: "missing update dep" });
  claimTask({ agent: "bob", task_id: t.id });
  updateTask({ agent: "bob", task_id: t.id, state: "working" });
  assert.throws(
    () =>
      updateTask({
        agent: "bob",
        task_id: t.id,
        state: "blocked",
        blocked_on_task_id: 999_999,
      }),
    (e: unknown) => e instanceof BusError && e.code === "TASK_NOT_FOUND",
  );
});

closeDb();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
