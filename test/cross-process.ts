import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";
import { packageVersion } from "../src/util/package-info.js";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-xp-"));
const env = { ...process.env, AGENT_BUS_DIR: tmp };

function run(args: string[], opts: { quietErrors?: boolean } = {}): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("./node_modules/.bin/tsx", ["src/cli/index.ts", ...args], {
      env,
      cwd: process.cwd(),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (err += b.toString()));
    child.on("close", (code) => {
      if (code !== 0 && err && opts.quietErrors !== true) process.stderr.write(err);
      resolve({ stdout: out, stderr: err, code: code ?? 1 });
    });
  });
}

function start(args: string[]): ReturnType<typeof spawn> {
  return spawn("./node_modules/.bin/tsx", ["src/cli/index.ts", ...args], {
    env,
    cwd: process.cwd(),
  });
}

async function waitForUrl(url: string, timeoutMs = 5000): Promise<Response> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return res;
      lastError = new Error(`status ${res.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

console.log("agent-bus cross-process smoke test");
console.log(`tmpdir: ${tmp}`);

await run(["register", "--name", "alice", "--capabilities", "area-a", "--replace"]);
await run(["register", "--name", "bob", "--capabilities", "area-b", "--replace"]);

await Promise.all([
  run(["inject", "--from", "alice", "--to", "bob", "msg-1"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-2"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-3"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-4"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-5"]),
]);

const log = await run(["log", "-n", "10"]);
console.log(log.stdout);

const matches = log.stdout.match(/msg-\d/g) ?? [];
const unique = new Set(matches);
assert.equal(unique.size, 5, `expected 5 distinct messages, got ${unique.size}`);

console.log("✓ 5 concurrent writes from separate processes all landed");

await run(["register", "--name", "pm", "--team", "kanban-demo", "--project", "kanban-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "worker", "--team", "kanban-demo", "--project", "kanban-demo", "--capabilities", "implementation", "--replace"]);

const delegated = await run([
  "delegate",
  "--from",
  "pm",
  "--to",
  "worker",
  "--title",
  "Exercise workflow Kanban",
  "--project",
  "kanban-demo",
]);
assert.equal(delegated.code, 0, "delegate command should succeed");
const taskId = delegated.stdout.match(/task #(\d+)/)?.[1];
assert.ok(taskId, `expected delegated task id in output: ${delegated.stdout}`);

assert.equal((await run(["task-start", taskId, "--by", "worker"])).code, 0);
assert.equal((await run(["task-testing", taskId, "--by", "worker"])).code, 0);
const testingBoard = await run(["kanban", "--project", "kanban-demo", "--team", "kanban-demo"]);
assert.match(testingBoard.stdout, /Testing:/);
assert.match(testingBoard.stdout, new RegExp(`#${taskId}`));

assert.equal((await run(["task-done", taskId, "--by", "worker", "--result", "workflow verified"])).code, 0);
const done = await run(["done", "--project", "kanban-demo", "--team", "kanban-demo"]);
assert.match(done.stdout, new RegExp(`#${taskId}`));
assert.match(done.stdout, /workflow verified/);
console.log("✓ task workflow shortcuts update Kanban and done history");

await run(["register", "--name", "send-worker", "--team", "send-demo", "--project", "send-demo", "--capabilities", "implementation", "--replace"]);
const directSend = await run([
  "send",
  "--from",
  "send-pm",
  "--to",
  "send-worker",
  "--project",
  "send-demo",
  "--team",
  "send-demo",
  "--message",
  "stable direct send",
]);
assert.equal(directSend.code, 0, "send should succeed");
assert.match(directSend.stdout, /stable direct send/);
const directMessageId = directSend.stdout.match(/#(\d+)/)?.[1];
assert.ok(directMessageId, `expected sent message id in output: ${directSend.stdout}`);
const scopedDirect = await run(["message", directMessageId, "--project", "send-demo", "--team", "send-demo", "--no-content"]);
assert.equal(scopedDirect.code, 0, "message --team should accept matching scope");
assert.match(scopedDirect.stdout, /stable direct send/);
const wrongScopedDirect = await run(["message", directMessageId, "--project", "send-demo", "--team", "other-team", "--no-content"], { quietErrors: true });
assert.notEqual(wrongScopedDirect.code, 0, "message --team should reject wrong scope");
assert.match(wrongScopedDirect.stderr, /outside requested scope/);
console.log("✓ send and scoped message fetch work");

await run(["register", "--name", "chat-pm", "--team", "chat-demo", "--project", "chat-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "chat-worker", "--team", "chat-demo", "--project", "chat-demo", "--capabilities", "implementation", "--replace"]);

const sentChat = await run([
  "team-chat",
  "--project",
  "chat-demo",
  "--team",
  "chat-demo",
  "--from",
  "chat-pm",
  "hello team chat",
]);
assert.equal(sentChat.code, 0, "team-chat send should succeed");
assert.match(sentChat.stdout, /sent 1 team chat message/);
assert.match(sentChat.stdout, /hello team chat/);
assert.doesNotMatch(sentChat.stdout, /team chat chat-demo/, "team-chat send should not dump the full log by default");

const chatLog = await run(["team-chat", "--project", "chat-demo", "--team", "chat-demo", "-n", "10"]);
assert.match(chatLog.stdout, /team chat chat-demo/);
assert.match(chatLog.stdout, /hello team chat/);
const chatThreadId = sentChat.stdout.match(/thread=(t_[a-z0-9_]+)/)?.[1];
assert.ok(chatThreadId, `expected thread id in team-chat send output: ${sentChat.stdout}`);
const chatThread = await run(["team-chat", "--project", "chat-demo", "--team", "chat-demo", "--thread", chatThreadId, "-n", "10"]);
assert.match(chatThread.stdout, new RegExp(`thread=${chatThreadId}`));
assert.match(chatThread.stdout, /hello team chat/);
const chatSince = await run(["team-chat", "--project", "chat-demo", "--team", "chat-demo", "--since-id", "999999", "-n", "10"]);
assert.doesNotMatch(chatSince.stdout, /hello team chat/);
const chatThreads = await run(["team-chat", "--project", "chat-demo", "--team", "chat-demo", "--threads", "-n", "10"]);
assert.match(chatThreads.stdout, /team chat threads chat-demo/);
assert.match(chatThreads.stdout, new RegExp(chatThreadId));
console.log("✓ team-chat sends and reads team-scoped messages");

await run(["register", "--name", "preview-pm", "--team", "preview-demo", "--project", "preview-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "preview-worker", "--team", "preview-demo", "--project", "preview-demo", "--capabilities", "implementation", "--replace"]);
const hugeBody = "large-body-".repeat(2000);
await run(["send", "--from", "preview-pm", "--to", "preview-worker", "--project", "preview-demo", "--team", "preview-demo", "--message", hugeBody]);
const previews = await run(["inbox-previews", "--agent", "preview-worker", "--project", "preview-demo", "--team", "preview-demo", "--preview-chars", "24"]);
assert.match(previews.stdout, /len=22000/);
assert.match(previews.stdout, /truncated/);
assert.match(previews.stdout, /large-body-large-body-/);
const previewMessageId = previews.stdout.match(/#(\d+)/)?.[1];
assert.ok(previewMessageId, `expected preview message id in output: ${previews.stdout}`);
const messagePreview = await run(["message", previewMessageId, "--no-content"]);
assert.match(messagePreview.stdout, /len=22000/);
assert.match(messagePreview.stdout, /Next:/);
const messageFullAlias = await run(["message", previewMessageId, "--include-content", "--preview-chars", "24"]);
assert.equal(messageFullAlias.code, 0, "message --include-content should be accepted");
console.log("✓ inbox-previews and message avoid dumping large inbox bodies");

await run(["register", "--name", "wait-pm", "--team", "wait-demo", "--project", "wait-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "wait-worker", "--team", "wait-demo", "--project", "wait-demo", "--capabilities", "implementation", "--replace"]);
await run(["team-chat", "--project", "wait-demo", "--team", "wait-demo", "--from", "wait-pm", "wake signal"]);
const waitOut = await run(["wait", "--agent", "wait-worker", "--project", "wait-demo", "--team", "wait-demo", "--timeout-s", "2"]);
assert.equal(waitOut.code, 0, "wait should exit 0 when a message is pending");
assert.match(waitOut.stdout, /message available/);
assert.match(waitOut.stdout, /wake signal/);
const waitStillPending = await run(["inbox-previews", "--agent", "wait-worker", "--project", "wait-demo", "--team", "wait-demo"]);
assert.match(waitStillPending.stdout, /wake signal/, "wait should not consume the message");
const waitTimeout = await run(["wait", "--agent", "wait-worker", "--project", "wait-demo", "--team", "wait-demo", "--thread", "t_nope", "--timeout-s", "1"], { quietErrors: true });
assert.equal(waitTimeout.code, 2, "wait should exit 2 on timeout");
assert.match(waitTimeout.stdout, /timeout/);
console.log("✓ wait blocks for pending messages without consuming them");

await run(["register", "--name", "ui-clean-pm", "--team", "ui-clean", "--project", "ui-clean", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "ui-clean-worker", "--team", "ui-clean", "--project", "ui-clean", "--capabilities", "implementation", "--replace"]);

const ui = start(["ui", "--no-open", "--port", "8791", "--project", "all", "--area", "all", "--team", "all"]);
try {
  const stateRes = await waitForUrl("http://127.0.0.1:8791/api/state");
  const state = await stateRes.json() as { version: string; stats: { online: number }; messages: unknown[] };
  assert.equal(state.version, packageVersion());
  assert.ok(Array.isArray(state.messages));
  assert.ok(state.stats.online >= 0);
  const html = await (await waitForUrl("http://127.0.0.1:8791/")).text();
  assert.match(html, /Agent Bus Cockpit/);
  const removeRes = await fetch("http://127.0.0.1:8791/api/remove-agent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: "ui-clean-worker" }),
  });
  assert.equal(removeRes.status, 200);
  const removed = await removeRes.json() as { removed_agent: { name: string } };
  assert.equal(removed.removed_agent.name, "ui-clean-worker");
  const deleteRes = await fetch("http://127.0.0.1:8791/api/delete-team", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ team: "ui-clean", project: "ui-clean" }),
  });
  assert.equal(deleteRes.status, 200);
  const deleted = await deleteRes.json() as { removed_agents: string[]; team: string };
  assert.equal(deleted.team, "ui-clean");
  assert.deepEqual(deleted.removed_agents, ["ui-clean-pm"]);
  console.log("✓ local web UI serves cockpit state");
  console.log("✓ local web UI can remove members and delete teams");
} finally {
  ui.kill();
}

await run(["register", "--name", "dash-pm", "--team", "dash-demo", "--project", "dash-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "dash-worker", "--team", "dash-demo", "--project", "dash-demo", "--capabilities", "implementation", "--replace"]);
const dashDelegated = await run([
  "delegate",
  "--from",
  "dash-pm",
  "--to",
  "dash-worker",
  "--title",
  "Exercise activity cockpit now",
  "--project",
  "dash-demo",
  "--team",
  "dash-demo",
]);
const dashTaskId = dashDelegated.stdout.match(/task #(\d+)/)?.[1];
assert.ok(dashTaskId, `expected dashboard task id in output: ${dashDelegated.stdout}`);
const nowOut = await run(["now", "--agent", "dash-worker", "--task", dashTaskId, "--phase", "testing", "--note", "running cross-process smoke"]);
assert.match(nowOut.stdout, /updated dash-worker status=working/);
const activity = await run(["activity", "--project", "dash-demo", "--team", "dash-demo", "-n", "20"]);
assert.match(activity.stdout, /running cross-process smoke/);
const cockpit = await run(["cockpit", "--project", "dash-demo", "--team", "dash-demo"]);
assert.match(cockpit.stdout, /Waiting on:/);
assert.match(cockpit.stdout, /acknowledgement/);
console.log("✓ activity, cockpit, and now work through the CLI");

const whois = await run(["whois", "--project", "dash-demo", "--team", "dash-demo"]);
assert.match(whois.stdout, /bus=/);
const doctor = await run(["doctor", "--json"]);
assert.equal(doctor.code, 0);
const doctorJson = JSON.parse(doctor.stdout) as { cli_version: string; agents: { version_warnings: unknown[] }; skills: unknown[] };
assert.equal(doctorJson.cli_version, packageVersion());
assert.ok(Array.isArray(doctorJson.agents.version_warnings));
assert.ok(Array.isArray(doctorJson.skills));
console.log("✓ whois and doctor expose version visibility");

rmSync(tmp, { recursive: true, force: true });
