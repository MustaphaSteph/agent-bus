import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-xp-"));
const env = { ...process.env, AGENT_BUS_DIR: tmp };

function run(args: string[]): Promise<{ stdout: string; code: number }> {
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
      if (code !== 0 && err) process.stderr.write(err);
      resolve({ stdout: out, code: code ?? 1 });
    });
  });
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
