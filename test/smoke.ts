import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-"));
process.env.AGENT_BUS_DIR = tmp;

const {
  ack,
  acknowledgeTask,
  activityTimeline,
  agentNow,
  assignTask,
  cancelTask,
  claimTask,
  claimBestTask,
  checkScopeConflicts,
  cockpit,
  createTask,
  delegate,
  delegateTeam,
  directory,
  finalReport,
  getMessage,
  getTask,
  ask,
  askBest,
  askTeam,
  inbox,
  inboxPreviews,
  inboxStatus,
  listTasks,
  listTaskEvents,
  listTestResults,
  listMemories,
  messagePage,
  messageThread,
  messagesSince,
  pinMemory,
  projectBoard,
  PROJECT_WILDCARD,
  recentMessages,
  register,
  scopes,
  timeseries,
  recordDecision,
  recordTaskEvent,
  recordTestResult,
  remember,
  releaseTask,
  reply,
  replyThread,
  send,
  sendChannel,
  sendTeam,
  sleepAgent,
  setPaused,
  subscribe,
  subscribers,
  threadMessages,
  unsubscribe,
  updateTask,
  wakeAgent,
  whois,
  waitForAgents,
  listDecisions,
  sessionBrief,
  submitReview,
  handoffTask,
  reviewGate,
  taskResult,
  teamBoard,
  waitForTask,
  messageStatus,
  whyNoReply,
} = await import("../src/bus.js");
const { classifyTaskMessage } = await import("../src/cli/ui.js");
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
  register({ name: "alice", capabilities: ["area-a"] });
  register({ name: "bob", capabilities: ["area-b"] });
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
  const a = register({ name: "alice", capabilities: ["area-a", "ui"], replace: true });
  assert.deepEqual(a.capabilities, ["area-a", "ui"]);
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

await test("inbox_previews and get_message avoid pulling full large bodies", async () => {
  const big = "abcdef".repeat(200_000);
  const sent = send({ from: "alice", to: "bob", content: big, thread_id: "t_large_preview" });
  const previews = await inboxPreviews({ agent: "bob", limit: 1, preview_chars: 12 });
  const preview = previews.find((m) => m.id === sent.id);
  assert.ok(preview);
  assert.equal(preview.content_preview, "abcdefabcdef");
  assert.equal(preview.content_length, big.length);
  assert.equal(preview.truncated, true);
  assert.ok(!("content" in preview));

  const fetchedPreview = getMessage({ message_id: sent.id, include_content: false });
  assert.equal(fetchedPreview.full_content_included, false);
  assert.ok(!("content" in fetchedPreview.message));

  const fetchedFull = getMessage({ message_id: sent.id });
  assert.equal(fetchedFull.full_content_included, true);
  assert.ok("content" in fetchedFull.message);
  if ("content" in fetchedFull.message) assert.equal(fetchedFull.message.content.length, big.length);

  const stillPending = await inbox({ agent: "bob", limit: 1 });
  assert.ok(stillPending.some((m) => m.id === sent.id), "preview should not consume message");
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

await test("inbox_status reports unread, claimed, and delivered without consuming", async () => {
  const unread = send({ from: "alice", to: "bob", content: "status-unread" });
  let status = inboxStatus({ agent: "bob" });
  assert.ok(status.unread.some((m) => m.id === unread.id));
  assert.ok(status.summary.includes("unread"));

  const claimed = send({ from: "alice", to: "bob", content: "status-claimed" });
  const claimedRows = await inbox({ agent: "bob", claim_s: 60 });
  const claimedRow = claimedRows.find((m) => m.id === claimed.id);
  assert.ok(claimedRow);
  status = inboxStatus({ agent: "bob" });
  assert.ok(status.in_flight.some((m) => m.id === claimed.id));

  const acked = ack({ agent: "bob", message_id: claimed.id });
  status = inboxStatus({ agent: "bob" });
  assert.ok(status.delivered_recent.some((m) => m.id === acked.id));
});

await test("inbox and inbox_status can filter by team", async () => {
  register({ name: "team-inbox-pm", capabilities: ["coord"], project: "teaminboxproj", team: "alpha", replace: true });
  register({ name: "team-inbox-alpha", capabilities: ["worker"], project: "teaminboxproj", team: "alpha", replace: true });
  register({ name: "team-inbox-beta", capabilities: ["worker"], project: "teaminboxproj", team: "beta", replace: true });

  const alpha = sendTeam({ from: "team-inbox-pm", team: "alpha", project: "teaminboxproj", content: "alpha team note" });
  assert.equal(alpha.length, 1);
  const betaDirect = send({ from: "team-inbox-beta", to: "team-inbox-alpha", content: "beta direct note" });

  let status = inboxStatus({ agent: "team-inbox-alpha", team: "alpha" });
  assert.ok(status.unread.some((m) => m.content === "alpha team note"));
  assert.ok(!status.unread.some((m) => m.id === betaDirect.id));

  const alphaRows = await inbox({ agent: "team-inbox-alpha", team: "alpha" });
  assert.equal(alphaRows.length, 1);
  assert.equal(alphaRows[0]?.content, "alpha team note");

  status = inboxStatus({ agent: "team-inbox-alpha", team: "beta" });
  assert.ok(status.unread.some((m) => m.id === betaDirect.id));

  const betaRows = await inbox({ agent: "team-inbox-alpha", team: "beta" });
  assert.equal(betaRows.length, 1);
  assert.equal(betaRows[0]?.content, "beta direct note");
});

await test("message_status and why_no_reply explain unanswered asks", async () => {
  const askMessage = send({ from: "alice", to: "bob", content: "need answer", kind: "ask" });
  let status = messageStatus({ message_id: askMessage.id });
  assert.equal(status.message.id, askMessage.id);
  assert.equal(status.reply, null);
  assert.ok(status.diagnostics.some((line) => line.includes("no reply")));

  const why = whyNoReply(askMessage.id);
  assert.ok(why.suggested_next_actions.length > 0);

  const pending = await inbox({ agent: "bob" });
  const target = pending.find((m) => m.id === askMessage.id);
  assert.ok(target);
  const answered = reply({ from: "bob", ask_id: target.id, answer: "answer" });
  status = messageStatus({ message_id: askMessage.id });
  assert.equal(status.reply?.id, answered.id);
});

await test("reply_thread continues with the last other participant", async () => {
  const tid = "t_reply_thread_test";
  send({ from: "alice", to: "bob", content: "first", thread_id: tid });
  send({ from: "bob", to: "alice", content: "second", thread_id: tid });
  const sent = replyThread({ from: "alice", thread_id: tid, message: "third" });
  assert.equal(sent.to_agent, "bob");
  assert.equal(sent.thread_id, tid);
  const rows = await inbox({ agent: "bob" });
  assert.ok(rows.some((m) => m.id === sent.id));
});

await test("reply to non-ask explains reply_thread fallback", async () => {
  const msg = send({ from: "alice", to: "bob", content: "normal message", thread_id: "t_non_ask_reply" });
  assert.throws(
    () => reply({ from: "bob", ask_id: msg.id, answer: "not valid" }),
    (e: unknown) =>
      e instanceof BusError
      && e.code === "ASK_NOT_FOUND"
      && e.message.includes("kind='msg'")
      && e.message.includes("reply_thread"),
  );
  await inbox({ agent: "bob", limit: 1 });
});

await test("subscribe + send_channel fans out to subscribers", () => {
  register({ name: "carol", capabilities: ["tests"] });
  register({ name: "dave", capabilities: ["tests"] });
  subscribe({ agent: "carol", channel: "team-updates" });
  subscribe({ agent: "dave", channel: "team-updates" });

  const list = subscribers("team-updates");
  assert.deepEqual(list.sort(), ["carol", "dave"]);

  const sent = sendChannel({ from: "alice", channel: "team-updates", content: "standup at 10" });
  assert.equal(sent.length, 2);
  for (const m of sent) {
    assert.equal(m.channel, "team-updates");
    assert.equal(m.content, "standup at 10");
  }
});

await test("send_channel excludes the sender even if they are subscribed", () => {
  subscribe({ agent: "alice", channel: "team-updates" });
  const sent = sendChannel({ from: "alice", channel: "team-updates", content: "no self echo" });
  const recipients = sent.map((m) => m.to_agent).sort();
  assert.deepEqual(recipients, ["carol", "dave"]);
});

await test("unsubscribe removes the agent from the channel", () => {
  unsubscribe({ agent: "dave", channel: "team-updates" });
  assert.deepEqual(subscribers("team-updates").sort(), ["alice", "carol"]);
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
  mkdirSync(join(root, "apps", "area-a"), { recursive: true });
  mkdirSync(join(root, "services", "api"), { recursive: true });
  writeFileSync(
    join(root, ".agent-bus.json"),
    JSON.stringify({
      project: "mobile-suite",
      areas: {
        "area-a": ["apps/area-a/**"],
        "area-b": ["services/api/**"],
      },
    }),
  );

  assert.deepEqual(deriveScope(join(root, "apps", "area-a", "Sources")), {
    project: "mobile-suite",
    area: "area-a",
  });
  assert.deepEqual(deriveScope(join(root, "services", "api")), {
    project: "mobile-suite",
    area: "area-b",
  });

  rmSync(root, { recursive: true, force: true });
});

await test("deriveScope supports direct area for separated project folders", () => {
  const areaA = mkdtempSync(join(tmpdir(), "shop area-a"));
  const areaB = mkdtempSync(join(tmpdir(), "shop area-b"));
  mkdirSync(join(areaA, ".git"));
  mkdirSync(join(areaB, ".git"));
  writeFileSync(
    join(areaA, ".agent-bus.json"),
    JSON.stringify({ project: "shop", area: "area-a" }),
  );
  writeFileSync(
    join(areaB, ".agent-bus.json"),
    JSON.stringify({ project: "shop", area: "area-b" }),
  );

  assert.deepEqual(deriveScope(areaA), {
    project: "shop",
    area: "area-a",
  });
  assert.deepEqual(deriveScope(areaB), {
    project: "shop",
    area: "area-b",
  });

  rmSync(areaA, { recursive: true, force: true });
  rmSync(areaB, { recursive: true, force: true });
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
  register({ name: "area-asker", project: "app", area: "area-a" });
  register({ name: "area-area-a", project: "app", area: "area-a", capabilities: ["build"] });
  register({ name: "area-area-b", project: "app", area: "area-b", capabilities: ["build"] });
  register({ name: "area-manager", project: "app", area: "pm", capabilities: ["plan"] });

  const areaAMsg = send({ from: "area-area-a", to: "area-manager", content: "area-a update" });
  const areaBMsg = send({ from: "area-area-b", to: "area-manager", content: "area-b update" });
  assert.equal(areaAMsg.area, "area-a");
  assert.equal(areaBMsg.area, "area-b");

  const areaAWhois = whois({ project: "app", area: "area-a" }).map((a) => a.name);
  assert.ok(areaAWhois.includes("area-area-a"));
  assert.ok(!areaAWhois.includes("area-area-b"));

  const areaARecent = recentMessages({ project: "app", area: "area-a", limit: 50 }).map((m) => m.id);
  assert.ok(areaARecent.includes(areaAMsg.id));
  assert.ok(!areaARecent.includes(areaBMsg.id));

  const replier = setTimeout(async () => {
    const pending = await inbox({ agent: "area-area-a" });
    const askMsg = pending.find((m) => m.kind === "ask");
    assert.ok(askMsg, "expected area-scoped ask");
    reply({ from: "area-area-a", ask_id: askMsg.id, answer: "area-a build answer" });
  }, 200);

  const answer = await askBest({
    from: "area-asker",
    capability: "build",
    question: "build?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.equal(answer.from_agent, "area-area-a");

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
      e.message.includes("area 'area-a'") &&
      e.message.includes('area="*"'),
  );

  const areaATask = createTask({ requested_by: "area-area-a", title: "area-a task" });
  const areaBTask = createTask({ requested_by: "area-area-b", title: "area-b task" });
  assert.equal(areaATask.area, "area-a");
  assert.equal(areaBTask.area, "area-b");

  const areaATasks = listTasks({ project: "app", area: "area-a", include_terminal: true }).map((t) => t.id);
  assert.ok(areaATasks.includes(areaATask.id));
  assert.ok(!areaATasks.includes(areaBTask.id));

  const allAreaTasks = listTasks({ project: "app", area: PROJECT_WILDCARD, include_terminal: true }).map((t) => t.id);
  assert.ok(allAreaTasks.includes(areaATask.id));
  assert.ok(allAreaTasks.includes(areaBTask.id));
});

await test("team: directory, send_team, ask_team, and tasks stay in team", async () => {
  register({ name: "team-pm", project: "teamproj", area: "area-a", replace: true });
  register({ name: "team-alpha-a", project: "teamproj", area: "area-a", team: "alpha", capabilities: ["review"], replace: true });
  register({ name: "team-alpha-b", project: "teamproj", area: "area-a", team: "alpha", capabilities: ["review"], replace: true });
  register({ name: "team-beta-a", project: "teamproj", area: "area-a", team: "beta", capabilities: ["review"], replace: true });

  const alphaDirectory = directory({ project: "teamproj", area: "area-a", team: "alpha" }).map((agent) => agent.name);
  assert.ok(alphaDirectory.includes("team-alpha-a"));
  assert.ok(!alphaDirectory.includes("team-beta-a"));

  const sent = sendTeam({ from: "team-pm", team: "alpha", content: "alpha only" });
  assert.deepEqual(sent.map((message) => message.to_agent).sort(), ["team-alpha-a", "team-alpha-b"]);
  assert.ok(sent.every((message) => message.team === "alpha"));
  assert.equal((await inbox({ agent: "team-beta-a" })).length, 0);

  const replier = setTimeout(async () => {
    const pending = [
      ...(await inbox({ agent: "team-alpha-a" })),
      ...(await inbox({ agent: "team-alpha-b" })),
    ];
    const askMsg = pending.find((message) => message.kind === "ask");
    assert.ok(askMsg, "expected team ask");
    reply({ from: askMsg.to_agent, ask_id: askMsg.id, answer: "alpha answer" });
  }, 200);
  const answer = await askTeam({
    from: "team-pm",
    team: "alpha",
    capability: "review",
    question: "team-scoped?",
    timeout_s: 5,
  });
  clearTimeout(replier);
  assert.ok(["team-alpha-a", "team-alpha-b"].includes(answer.from_agent));

  const alphaTask = createTask({ requested_by: "team-pm", title: "alpha task", team: "alpha" });
  const betaTask = createTask({ requested_by: "team-beta-a", title: "beta task", team: "beta" });
  const alphaTasks = listTasks({ project: "teamproj", area: "area-a", team: "alpha", include_terminal: true }).map((task) => task.id);
  assert.ok(alphaTasks.includes(alphaTask.id));
  assert.ok(!alphaTasks.includes(betaTask.id));
  assert.ok(teamBoard({ project: "teamproj", area: "area-a", team: "alpha" }).open_tasks.some((task) => task.id === alphaTask.id));
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
  register({ name: "task-rust", capabilities: ["rust"], replace: true, project: "taskp", area: "area-b" });
  register({ name: "task-js", capabilities: ["js"], replace: true, project: "taskp", area: "area-b" });
  const t = createTask({
    requested_by: "task-rust",
    title: "rust task",
    required_capability: "rust",
    project: "taskp",
    area: "area-b",
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
  register({ name: "scope-pm", project: "scope", area: "area-a", replace: true });
  register({ name: "scope-a", project: "scope", area: "area-a", replace: true });
  register({ name: "scope-b", project: "scope", area: "area-a", replace: true });
  const first = createTask({
    requested_by: "scope-pm",
    title: "edit auth form",
    file_scope: ["src/components/auth/**"],
  });
  claimTask({ agent: "scope-a", task_id: first.id });

  const conflicts = checkScopeConflicts({
    project: "scope",
    area: "area-a",
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

await test("delegate creates assigned task, event, notification, and ack requirement", async () => {
  register({ name: "delegate-pm", project: "delegatep", replace: true });
  register({ name: "delegate-worker", project: "delegatep", replace: true });
  const result = delegate({
    from: "delegate-pm",
    to_agent: "delegate-worker",
    title: "delegated task",
    description: "exercise high-level primitive",
    mode: "investigate_only",
    expected_output: "short report",
    edit_scope: ["src/bus.ts"],
  });
  assert.equal(result.assigned, true);
  assert.equal(result.pending, false);
  assert.equal(result.task.claimed_by, "delegate-worker");
  assert.equal(result.task.ack_required, true);
  assert.equal(result.event.phase, "delegated");
  const notices = await inbox({ agent: "delegate-worker" });
  assert.ok(notices.some((msg) => msg.content.includes("assigned task")));
});

await test("delegate_team creates tracked tasks and reports skipped team members", async () => {
  register({ name: "delegate-team-pm", project: "delegate-team-p", team: "ui", replace: true });
  register({ name: "delegate-team-a", project: "delegate-team-p", team: "ui", capabilities: ["design"], replace: true });
  register({ name: "delegate-team-b", project: "delegate-team-p", team: "ui", capabilities: ["design"], replace: true });
  register({ name: "delegate-team-other", project: "delegate-team-p", team: "ui", capabilities: ["backend"], replace: true });
  register({ name: "delegate-team-paused", project: "delegate-team-p", team: "ui", capabilities: ["design"], replace: true });
  setPaused("delegate-team-paused", true);

  const result = delegateTeam({
    from: "delegate-team-pm",
    team: "ui",
    project: "delegate-team-p",
    capability: "design",
    title: "team design plan",
    description: "produce a tracked plan",
    mode: "investigate_only",
    expected_output: "plan",
  });

  assert.equal(result.team, "ui");
  assert.equal(result.delegated_count, 2);
  assert.equal(result.tasks.length, 2);
  assert.ok(result.tasks.every((entry) => entry.task.thread_id === result.thread_id));
  assert.deepEqual(result.tasks.map((entry) => entry.task.claimed_by).sort(), ["delegate-team-a", "delegate-team-b"]);
  assert.ok(result.skipped.some((entry) => entry.agent === "delegate-team-pm" && entry.reason === "self"));
  assert.ok(result.skipped.some((entry) => entry.agent === "delegate-team-other" && entry.reason === "capability_mismatch"));
  assert.ok(result.skipped.some((entry) => entry.agent === "delegate-team-paused" && entry.reason === "paused"));

  const board = teamBoard({ project: "delegate-team-p", team: "ui" });
  const boardIds = board.active_tasks.map((task) => task.id).sort();
  assert.deepEqual(boardIds, result.tasks.map((entry) => entry.task.id).sort());

  const noticesA = await inbox({ agent: "delegate-team-a", team: "ui" });
  const noticesB = await inbox({ agent: "delegate-team-b", team: "ui" });
  assert.ok(noticesA.some((msg) => msg.content.includes("assigned task")));
  assert.ok(noticesB.some((msg) => msg.content.includes("assigned task")));
});

await test("wait_for_task returns when task activity arrives", async () => {
  register({ name: "wait-pm", project: "waitp", replace: true });
  register({ name: "wait-worker", project: "waitp", replace: true });
  const task = createTask({ requested_by: "wait-pm", title: "wait task" });
  claimTask({ agent: "wait-worker", task_id: task.id });
  setTimeout(() => {
    recordTaskEvent({
      by_agent: "wait-worker",
      task_id: task.id,
      event_type: "progress",
      message: "progress after wait started",
      phase: "working",
    });
  }, 100);
  const result = await waitForTask({ task_id: task.id, wait_s: 2, since_updated_at: Date.now(), limit: 20 });
  assert.equal(result.timed_out, false);
  assert.equal(result.latest_event?.message, "progress after wait started");
  assert.equal(result.holder?.name, "wait-worker");
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
  register({ name: "board-pm", project: "boardp", area: "area-a", replace: true });
  register({ name: "board-worker", project: "boardp", area: "area-a", replace: true });
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
    area: "area-a",
    pinned: true,
  });
  const board = projectBoard({ project: "boardp", area: "area-a" });
  assert.ok(board.active_tasks.some((row) => row.id === task.id));
  assert.ok(board.waiting_review.some((row) => row.id === task.id));
  assert.ok(board.pinned_risks.some((row) => row.content.includes("pending review")));
});

await test("wait_for_agents reports ready, stale, missing, and wrong scope", async () => {
  register({ name: "roster-ready", project: "roster", area: "area-a", replace: true });
  register({ name: "roster-wrong", project: "other", area: "area-a", replace: true });
  register({ name: "roster-stale", project: "roster", area: "area-a", replace: true });
  getDb().prepare("UPDATE agents SET last_seen = ? WHERE name = ?").run(Date.now() - 10 * 60_000, "roster-stale");

  const result = await waitForAgents({
    names: ["roster-ready", "roster-wrong", "roster-stale", "roster-missing"],
    project: "roster",
    area: "area-a",
    timeout_s: 0,
  });
  const globalResult = await waitForAgents({
    names: ["roster-ready"],
    project: "*",
    area: "*",
    timeout_s: 0,
  });
  assert.ok(result.ready.some((agent) => agent.name === "roster-ready"));
  assert.ok(globalResult.ready.some((agent) => agent.name === "roster-ready"));
  assert.ok(result.stale.some((agent) => agent.name === "roster-stale"));
  assert.ok(result.missing.includes("roster-missing"));
  assert.ok(result.wrong_scope.some((agent) => agent.name === "roster-wrong"));
});

await test("tasks: pending assignment is claimed after agent registers", async () => {
  register({ name: "pending-pm", project: "pendingp", area: "*", role: "pm", replace: true });
  const task = createTask({
    requested_by: "pending-pm",
    title: "future worker task",
    ack_required: true,
    file_scope: ["src/future/**"],
  });
  const assigned = assignTask({
    task_id: task.id,
    to_agent: "future-worker",
    allow_pending_agent: true,
  });
  assert.equal(assigned.pending_assignee, "future-worker");
  assert.equal(assigned.state, "open");

  register({ name: "future-worker", project: "pendingp", area: "area-a", replace: true });
  const notices = await inbox({ agent: "future-worker" });
  assert.ok(notices.some((msg) => msg.content.includes("pending assignment task")));
  const claimed = claimBestTask({ agent: "future-worker", project: "pendingp", area: "*" });
  assert.equal(claimed?.id, task.id);
  assert.equal(claimed?.claimed_by, "future-worker");
  assert.equal(claimed?.pending_assignee, null);
});

await test("tasks: read scope does not create edit conflicts for verifier", () => {
  register({ name: "scope-v-pm", project: "scopev", area: "area-a", replace: true });
  register({ name: "scope-v-worker", project: "scopev", area: "area-a", replace: true });
  register({ name: "scope-v-verifier", project: "scopev", area: "*", role: "verifier", replace: true });
  const editTask = createTask({
    requested_by: "scope-v-pm",
    title: "edit scoped work",
    mode: "edit_files",
    file_scope: ["src/components/**"],
    edit_scope: ["src/components/**"],
  });
  claimTask({ agent: "scope-v-worker", task_id: editTask.id });
  const verifierTask = createTask({
    requested_by: "scope-v-pm",
    title: "verify broad read",
    mode: "test_only",
    file_scope: ["src/**"],
    read_scope: ["src/**"],
    edit_scope: [],
  });
  claimTask({ agent: "scope-v-verifier", task_id: verifierTask.id });
  const board = projectBoard({ project: "scopev", area: "*" });
  assert.equal(board.scope_conflicts.length, 0);
  assert.ok(checkScopeConflicts({ edit_scope: ["src/components/**"], project: "*", area: "*" }).some((row) => row.task_id === editTask.id));
});

await test("test results are recorded in final report", () => {
  register({ name: "test-evidence-pm", project: "evidence", replace: true });
  const task = createTask({ requested_by: "test-evidence-pm", title: "evidence task", mode: "test_only" });
  const result = recordTestResult({
    by_agent: "test-evidence-pm",
    task_id: task.id,
    command: "npm run build",
    status: "passed",
    output_summary: "build passed",
  });
  assert.equal(result.project, "evidence");
  assert.ok(listTestResults({ project: "evidence" }).some((row) => row.id === result.id));
  const report = finalReport({ project: "evidence" });
  assert.ok(report.test_results.some((row) => row.command === "npm run build"));
  assert.ok(report.tests_passed.some((line) => line.includes("npm run build")));
});

await test("decisions: record and list by scope", () => {
  register({ name: "decision-pm", project: "dp", area: "area-b", replace: true });
  const decision = recordDecision({
    by_agent: "decision-pm",
    decision: "Use task modes for agent permissions",
    rationale: "prevents accidental edits",
    implemented: true,
  });
  assert.equal(decision.project, "dp");
  assert.equal(decision.area, "area-b");
  const listed = listDecisions({ project: "dp", area: "area-b" });
  assert.ok(listed.some((row) => row.id === decision.id && row.implemented));
});

await test("memories: remember and list by scope and metadata", () => {
  register({ name: "memory-pm", project: "mp", area: "area-b", replace: true });
  register({ name: "memory-worker", project: "mp", area: "area-b", replace: true });
  const task = createTask({ requested_by: "memory-pm", title: "memory linked task" });
  const oldMemory = remember({
    by_agent: "memory-pm",
    kind: "handoff",
    content: "Old area-b handoff.",
  });
  const memory = remember({
    by_agent: "memory-pm",
    agent: "memory-worker",
    kind: "handoff",
    content: "Worker owns area-b memory tests.",
    task_id: task.id,
    thread_id: "thread-memory",
    pinned: true,
    supersedes_id: oldMemory.id,
  });
  assert.equal(memory.project, "mp");
  assert.equal(memory.area, "area-b");
  assert.equal(memory.task_id, task.id);
  assert.equal(memory.pinned, true);
  assert.equal(memory.supersedes_id, oldMemory.id);

  const listed = listMemories({
    project: "mp",
    area: "area-b",
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

await test("sessions: register and create task carry session metadata", () => {
  const agent = register({
    name: "session-worker",
    capabilities: ["session"],
    session_id: "codex-session-1",
    replace: true,
  });
  assert.equal(agent.session_id, "codex-session-1");

  const task = createTask({
    requested_by: "session-worker",
    title: "session-scoped task",
  });
  assert.equal(task.session_id, "codex-session-1");
});

await test("task events: record progress and build task result bundle", () => {
  register({ name: "event-pm", project: "events", replace: true });
  register({ name: "event-worker", project: "events", replace: true });
  const task = createTask({
    requested_by: "event-pm",
    title: "eventful task",
    project: "events",
    phase: "planned",
  });
  claimTask({ agent: "event-worker", task_id: task.id });
  const event = recordTaskEvent({
    by_agent: "event-worker",
    task_id: task.id,
    event_type: "progress",
    message: "Implemented first pass",
    phase: "editing",
    metadata: { files: ["src/demo.ts"] },
  });
  assert.equal(event.phase, "editing");

  const listed = listTaskEvents({ task_id: task.id });
  assert.ok(listed.some((row) => row.id === event.id));
  assert.equal(getTask(task.id).phase, "editing");

  recordTestResult({
    by_agent: "event-worker",
    task_id: task.id,
    command: "npm test",
    status: "passed",
    output_summary: "smoke passed",
    project: "events",
  });
  remember({
    by_agent: "event-worker",
    kind: "summary",
    content: "Eventful task has a progress row.",
    task_id: task.id,
    project: "events",
  });

  const result = taskResult(task.id);
  assert.equal(result.task.id, task.id);
  assert.ok(result.events.some((row) => row.id === event.id));
  assert.ok(result.test_results.some((row) => row.command === "npm test"));
  assert.ok(result.memories.some((row) => row.content.includes("progress row")));
});

await test("cancelTask cancels active work, records event, and notifies requester", async () => {
  register({ name: "cancel-pm", project: "cancel", replace: true });
  register({ name: "cancel-worker", project: "cancel", replace: true });
  const task = createTask({
    requested_by: "cancel-pm",
    title: "cancel me",
    project: "cancel",
  });
  claimTask({ agent: "cancel-worker", task_id: task.id });
  const result = cancelTask({
    agent: "cancel-worker",
    task_id: task.id,
    reason: "scope changed",
  });
  assert.equal(result.task.state, "canceled");
  assert.equal(result.task.phase, "canceled");
  assert.equal(result.event.event_type, "cancel");

  const notices = await inbox({ agent: "cancel-pm" });
  assert.ok(notices.some((row) => row.content.includes("canceled task")));
});

await test("reviewGate blocks unsafe project state and passes clean completed work", () => {
  register({ name: "gate-pm", project: "gate", replace: true });
  register({ name: "gate-worker", project: "gate", replace: true });
  const task = createTask({
    requested_by: "gate-pm",
    title: "review gate task",
    project: "gate",
    review_required: true,
  });
  claimTask({ agent: "gate-worker", task_id: task.id });
  updateTask({ agent: "gate-worker", task_id: task.id, state: "working" });

  const blocked = reviewGate({ project: "gate" });
  assert.equal(blocked.ok, false);
  assert.ok(blocked.blockers.some((row) => row.includes("active task")));

  submitReview({ reviewer: "gate-pm", task_id: task.id, approved: true, notes: "ok" });
  updateTask({ agent: "gate-worker", task_id: task.id, state: "completed", result: "done" });
  recordTestResult({
    by_agent: "gate-worker",
    task_id: task.id,
    command: "npm test",
    status: "passed",
    project: "gate",
  });

  const clean = reviewGate({ project: "gate" });
  assert.equal(clean.ok, true);
});

await test("activity, cockpit, and now summarize coordination state", () => {
  register({ name: "ux-pm", project: "ux", team: "ios-ui", capabilities: ["coordination"], replace: true });
  register({ name: "ux-worker", project: "ux", team: "ios-ui", capabilities: ["implementation"], replace: true });
  const task = createTask({
    requested_by: "ux-pm",
    title: "Build visible status",
    project: "ux",
    team: "ios-ui",
    ack_required: true,
  });
  claimTask({ agent: "ux-worker", task_id: task.id });
  const status = agentNow({
    agent: "ux-worker",
    task_id: task.id,
    phase: "testing",
    note: "running smoke checks",
  });
  assert.equal(status.agent.status, "working");
  assert.equal(status.task?.phase, "testing");
  assert.equal(status.event?.message, "running smoke checks");

  const timeline = activityTimeline({ project: "ux", team: "ios-ui", limit: 20 });
  assert.ok(timeline.some((item) => item.summary.includes("running smoke checks")));

  const dashboard = cockpit({ project: "ux", team: "ios-ui" });
  assert.ok(dashboard.waiting_on.some((item) => item.includes("acknowledgement")));
  assert.ok(dashboard.suggested_next_actions.length > 0);
});

await test("scopes enumerates projects and teams with counts", async () => {
  register({ name: "scope-pm", capabilities: ["coord"], project: "scopeproj", team: "sa", replace: true });
  register({ name: "scope-w1", capabilities: ["build"], project: "scopeproj", team: "sa", replace: true });
  register({ name: "scope-w2", capabilities: ["build"], project: "scopeproj", team: "sb", replace: true });
  register({ name: "scope-other", capabilities: ["build"], project: "otherproj", team: "ox", replace: true });

  const blocked = createTask({
    requested_by: "scope-pm",
    title: "blocked work",
    project: "scopeproj",
    team: "sa",
  });
  claimTask({ agent: "scope-w1", task_id: blocked.id });
  updateTask({ agent: "scope-w1", task_id: blocked.id, state: "working" });
  updateTask({ agent: "scope-w1", task_id: blocked.id, state: "blocked", blocked_reason: "waiting" });

  const result = scopes();
  const proj = result.projects.find((p) => p.project === "scopeproj");
  assert.ok(proj, "scopeproj should be enumerated");
  assert.equal(proj?.agents_total, 3);
  assert.ok(result.projects.some((p) => p.project === "otherproj"), "otherproj should be enumerated");

  const teamSa = proj?.teams.find((t) => t.team === "sa");
  const teamSb = proj?.teams.find((t) => t.team === "sb");
  assert.equal(teamSa?.agents_total, 2);
  assert.equal(teamSb?.agents_total, 1);
  assert.equal(teamSa?.blocked_tasks, 1);
  assert.ok((teamSa?.attention ?? 0) >= 1, "blocked task should count toward attention");

  assert.ok(result.totals.projects >= 2);
  assert.ok(result.totals.agents >= 4);
  assert.equal(result.totals.attention, result.projects.reduce((sum, p) => sum + p.attention, 0));
});

await test("messagePage pages history with a cursor", async () => {
  register({ name: "mp-a", capabilities: [], project: "mpproj", team: "mpteam", replace: true });
  register({ name: "mp-b", capabilities: [], project: "mpproj", team: "mpteam", replace: true });
  for (let i = 0; i < 7; i++) send({ from: "mp-a", to: "mp-b", content: "mp-msg-" + i });

  const p1 = messagePage({ project: "mpproj", team: "mpteam", limit: 3 });
  assert.equal(p1.messages.length, 3);
  assert.equal(p1.has_more, true);
  assert.ok(p1.next_cursor !== null);
  assert.ok((p1.messages[0]?.id ?? 0) < (p1.messages[2]?.id ?? 0)); // ascending within page

  const p2 = messagePage({ project: "mpproj", team: "mpteam", limit: 3, before_id: p1.next_cursor ?? undefined });
  assert.equal(p2.messages.length, 3);
  assert.ok((p2.messages[2]?.id ?? 0) < (p1.messages[0]?.id ?? 0)); // strictly older than page 1

  const p3 = messagePage({ project: "mpproj", team: "mpteam", limit: 3, before_id: p2.next_cursor ?? undefined });
  assert.equal(p3.messages.length, 1);
  assert.equal(p3.has_more, false);
  assert.equal(p3.next_cursor, null);
});

await test("timeseries buckets messages and tasks over a window", async () => {
  register({ name: "ts-a", capabilities: [], project: "tsproj", team: "tsteam", replace: true });
  register({ name: "ts-b", capabilities: [], project: "tsproj", team: "tsteam", replace: true });
  for (let i = 0; i < 4; i++) send({ from: "ts-a", to: "ts-b", content: "ts-msg-" + i });
  const task = createTask({ requested_by: "ts-a", title: "ts task", project: "tsproj", team: "tsteam" });
  recordTaskEvent({ by_agent: "ts-a", task_id: task.id, event_type: "progress", message: "ping" });

  const ts = timeseries({ project: "tsproj", team: "tsteam" });
  assert.equal(ts.messages.length, 24); // default buckets
  assert.equal(ts.totals.messages, 4); // exact: team filter isolates this scope
  assert.equal(ts.messages.reduce((a, b) => a + b, 0), 4);
  assert.ok(ts.totals.task_events >= 1);
  assert.ok(ts.daily.tasks_created.reduce((a, b) => a + b, 0) >= 1);
  assert.equal(typeof ts.deltas.messages_pct, "number");

  const ts6 = timeseries({ project: "tsproj", team: "tsteam", buckets: 6 });
  assert.equal(ts6.messages.length, 6);
  assert.equal(ts6.totals.messages, 4);
});

await test("messageThread + replies_count expose reply_to threads", async () => {
  register({ name: "th-a", capabilities: [], project: "thproj", team: "thteam", replace: true });
  register({ name: "th-b", capabilities: [], project: "thproj", team: "thteam", replace: true });
  const root = send({ from: "th-a", to: "th-b", content: "thread root question" });
  send({ from: "th-b", to: "th-a", content: "reply one", reply_to: root.id });
  send({ from: "th-b", to: "th-a", content: "reply two", reply_to: root.id });
  send({ from: "th-a", to: "th-b", content: "unrelated message" });

  const thread = messageThread(root.id);
  assert.equal(thread.root.id, root.id);
  assert.equal(thread.count, 2);
  assert.deepEqual(thread.replies.map((m) => m.content), ["reply one", "reply two"]);
  const limitedThread = messageThread(root.id, 1);
  assert.equal(limitedThread.count, 2);
  assert.deepEqual(limitedThread.replies.map((m) => m.content), ["reply one"]);

  const page = messagePage({ project: "thproj", team: "thteam", limit: 50 });
  const rootRow = page.messages.find((m) => m.id === root.id);
  assert.ok(rootRow, "root should be in the page");
  assert.equal(rootRow?.replies_count, 2);
  assert.equal(rootRow?.has_replies, true);
  const unrelated = page.messages.find((m) => m.content_preview === "unrelated message");
  assert.equal(unrelated?.has_replies, false);
});

await test("replyThread creates a threaded reply (reply_to=root, kind=reply)", async () => {
  register({ name: "rt-a", capabilities: [], project: "rtproj", team: "rtteam", replace: true });
  register({ name: "rt-b", capabilities: [], project: "rtproj", team: "rtteam", replace: true });
  const root = send({ from: "rt-a", to: "rt-b", content: "rt root" });
  const r1 = replyThread({ from: "rt-b", thread_id: root.thread_id, message: "rt reply one" });
  assert.equal(r1.kind, "reply");
  assert.equal(r1.reply_to, root.id);
  assert.equal(r1.thread_id, root.thread_id);
  const r2 = replyThread({ from: "rt-a", thread_id: root.thread_id, message: "rt reply two" });
  assert.equal(r2.reply_to, root.id); // groups under the root, not chained to r1

  const thread = messageThread(root.id);
  assert.equal(thread.count, 2);
  assert.deepEqual(thread.replies.map((m) => m.content), ["rt reply one", "rt reply two"]);

  const page = messagePage({ project: "rtproj", team: "rtteam", limit: 50 });
  const rootRow = page.messages.find((m) => m.id === root.id);
  assert.equal(rootRow?.replies_count, 2);
  assert.equal(rootRow?.has_replies, true);
});

await test("classifyTaskMessage tags task notifications, not normal chat", () => {
  // actual task notifications -> task archetype with the right id
  assert.deepEqual(classifyTaskMessage("assigned task #13: Build the cockpit. acknowledge_task."), { isTask: true, taskId: 13 });
  assert.deepEqual(classifyTaskMessage("pending assignment task #12: Design UX"), { isTask: true, taskId: 12 });
  assert.deepEqual(classifyTaskMessage("acknowledged task #14: claimed"), { isTask: true, taskId: 14 });
  assert.deepEqual(classifyTaskMessage("task #15 working: building"), { isTask: true, taskId: 15 });
  // normal conversation that merely mentions a task stays a normal message
  assert.equal(classifyTaskMessage("Quick check before I start Phase 0 on task #13?").isTask, false);
  assert.equal(classifyTaskMessage("#16 LANDED. reply_thread now threads, see task #16 above").isTask, false);
  assert.equal(classifyTaskMessage("Phase 0 done: scopes() added").isTask, false);
  assert.equal(classifyTaskMessage("what would you make the tiny bug be?").isTask, false);
});

closeDb();
rmSync(tmp, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
