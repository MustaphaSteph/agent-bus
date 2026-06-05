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
console.log("✓ team-chat sends and reads team-scoped messages");

await run(["register", "--name", "preview-pm", "--team", "preview-demo", "--project", "preview-demo", "--capabilities", "coordination", "--replace"]);
await run(["register", "--name", "preview-worker", "--team", "preview-demo", "--project", "preview-demo", "--capabilities", "implementation", "--replace"]);
const hugeBody = "large-body-".repeat(2000);
await run(["inject", "--from", "preview-pm", "--to", "preview-worker", hugeBody]);
const previews = await run(["inbox-previews", "--agent", "preview-worker", "--preview-chars", "24"]);
assert.match(previews.stdout, /len=22000/);
assert.match(previews.stdout, /truncated/);
assert.match(previews.stdout, /large-body-large-body-/);
const previewMessageId = previews.stdout.match(/#(\d+)/)?.[1];
assert.ok(previewMessageId, `expected preview message id in output: ${previews.stdout}`);
const messagePreview = await run(["message", previewMessageId, "--no-content"]);
assert.match(messagePreview.stdout, /len=22000/);
assert.match(messagePreview.stdout, /Next:/);
console.log("✓ inbox-previews and message avoid dumping large inbox bodies");

const ui = start(["ui", "--no-open", "--port", "8791", "--project", "all", "--area", "all", "--team", "all"]);
try {
  const stateRes = await waitForUrl("http://127.0.0.1:8791/api/state");
  const state = await stateRes.json() as { version: string; stats: { online: number }; messages: unknown[] };
  assert.equal(state.version, packageVersion());
  assert.ok(Array.isArray(state.messages));
  assert.ok(state.stats.online >= 0);
  const html = await (await waitForUrl("http://127.0.0.1:8791/")).text();
  assert.match(html, /Agent Bus Cockpit/);
  console.log("✓ local web UI serves cockpit state");
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

rmSync(tmp, { recursive: true, force: true });
