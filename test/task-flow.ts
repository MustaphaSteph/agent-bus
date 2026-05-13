import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-task-"));
process.env.AGENT_BUS_DIR = tmp;

const { register, createTask, claimTask, updateTask, listTasks, releaseTask } =
  await import("../src/bus.js");
const { closeDb } = await import("../src/db.js");

register({ name: "requester", capabilities: ["product"] });
register({ name: "worker", capabilities: ["dev"] });

const t = createTask({
  requested_by: "requester",
  title: "fix bug X",
  description: "the thing",
  priority: 5,
  cwd: "/repo",
});
console.log("created:", t.id, "state=" + t.state, "thread=" + t.thread_id);

const claimed = claimTask({ agent: "worker", task_id: t.id });
console.log("claimed:", claimed.state, "by=" + claimed.claimed_by);

try {
  claimTask({ agent: "worker", task_id: t.id });
  console.log("BUG: double-claim succeeded");
} catch (e) {
  console.log("double-claim correctly rejected:", (e as { code: string }).code);
}

const working = updateTask({ agent: "worker", task_id: t.id, state: "working" });
console.log("working:", working.state);

const blocked = updateTask({
  agent: "worker",
  task_id: t.id,
  state: "blocked",
  blocked_reason: "waiting on api keys",
});
console.log("blocked:", blocked.state, "reason=" + blocked.blocked_reason);

const done = updateTask({
  agent: "worker",
  task_id: t.id,
  state: "completed",
  result: "fixed in commit abc123",
});
console.log("done:", done.state, "finished_at_set=" + (done.finished_at !== null));

try {
  updateTask({ agent: "worker", task_id: t.id, state: "working" });
  console.log("BUG: terminal transition allowed");
} catch (e) {
  console.log("terminal transition correctly rejected:", (e as { code: string }).code);
}

const t2 = createTask({ requested_by: "requester", title: "task to release" });
claimTask({ agent: "worker", task_id: t2.id });
const released = releaseTask({ agent: "worker", task_id: t2.id });
console.log("released:", released.state, "claimed_by=" + released.claimed_by);

const all = listTasks({ include_terminal: true });
console.log("listed:", all.length, "tasks");

closeDb();
rmSync(tmp, { recursive: true, force: true });
console.log("\nall task-flow checks passed");
