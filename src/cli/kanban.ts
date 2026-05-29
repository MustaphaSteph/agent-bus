import kleur from "kleur";
import { listTasks, taskResult, type Task, type TaskState } from "../bus.js";
import { sleep } from "../util/time.js";
import { scopeBanner, type ScopeOptions } from "./project-scope.js";
import { formatTask } from "./tasks.js";

const TERMINAL_STATES: TaskState[] = ["completed", "failed", "canceled"];
const ACTIVE_STATES: TaskState[] = ["open", "claimed", "working", "blocked"];
const ALL_STATES: TaskState[] = ["open", "claimed", "working", "blocked", "completed", "failed", "canceled"];

export interface KanbanOptions extends ScopeOptions {
  all?: boolean;
  done?: boolean;
  compact?: boolean;
  watch?: boolean;
  intervalMs?: number;
  limit?: number;
}

export async function kanban(opts: KanbanOptions): Promise<void> {
  if (opts.watch === true) {
    await watchKanban(opts);
    return;
  }
  printKanban(opts);
}

export function doneTasks(opts: ScopeOptions & { state?: string; limit?: number }): void {
  const states = parseDoneState(opts.state);
  const rows = listTasks({
    ...opts,
    state: states,
    include_terminal: true,
    limit: opts.limit ?? 100,
  });
  const banner = scopeBanner(opts);
  if (banner) console.log(banner);
  console.log(kleur.bold("Done tasks"));
  if (rows.length === 0) {
    console.log(kleur.gray("  - none"));
    return;
  }
  for (const task of rows) {
    const finished = task.finished_at ? new Date(task.finished_at).toLocaleString() : "-";
    const result = task.final_answer ?? task.result ?? "";
    const suffix = result ? kleur.gray(` - ${truncate(result, 120)}`) : "";
    console.log(`${formatTask(task)}${kleur.gray(`, finished=${finished}`)}${suffix}`);
  }
}

export function taskDetail(taskId: number, limit: number, json: boolean): void {
  const result = taskResult(taskId, limit);
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  const task = result.task;
  console.log(kleur.bold(`#${task.id} ${task.title}`));
  console.log(
    [
      `state=${task.state}`,
      `phase=${task.phase ?? "-"}`,
      `holder=${task.claimed_by ?? "-"}`,
      `requested_by=${task.requested_by}`,
      `mode=${task.mode}`,
      `priority=${task.priority}`,
    ].join(" "),
  );
  console.log(kleur.gray(`project=${task.project ?? "-"} area=${task.area ?? "-"} team=${task.team ?? "-"} thread=${task.thread_id}`));
  if (task.description) console.log(`description: ${task.description}`);
  if (task.blocked_reason) console.log(kleur.red(`blocked: ${task.blocked_reason}`));
  if (task.result) console.log(`result: ${task.result}`);
  if (task.final_answer) console.log(`final: ${task.final_answer}`);
  if (task.expected_output) console.log(kleur.gray(`expected: ${task.expected_output}`));
  if (task.edit_scope.length > 0) console.log(kleur.gray(`edit_scope: ${task.edit_scope.join(", ")}`));
  if (task.read_scope.length > 0) console.log(kleur.gray(`read_scope: ${task.read_scope.join(", ")}`));
  if (task.changed_files.length > 0) console.log(kleur.gray(`changed_files: ${task.changed_files.join(", ")}`));

  console.log(kleur.bold("Events:"));
  printList(result.events.map((row) => `#${row.id} [${row.event_type}] ${row.by_agent}: ${row.message}${row.phase ? ` phase=${row.phase}` : ""}`));
  console.log(kleur.bold("Test evidence:"));
  printList(result.test_results.map((row) => `#${row.id} [${row.status}] ${row.command}${row.output_summary ? ` - ${row.output_summary}` : ""}`));
  console.log(kleur.bold("Memories:"));
  printList(result.memories.map((row) => `#${row.id} [${row.kind}] ${row.content}`));
  console.log(kleur.bold("Messages:"));
  printList(result.messages.map((row) => `#${row.id} ${row.from_agent} -> ${row.to_agent}: ${truncate(row.content, 220)}`));
}

async function watchKanban(opts: KanbanOptions): Promise<never> {
  const interval = opts.intervalMs ?? 2000;
  for (;;) {
    process.stdout.write("\x1Bc");
    printKanban(opts);
    await sleep(interval);
  }
}

function printKanban(opts: KanbanOptions): void {
  const banner = scopeBanner(opts);
  if (banner) console.log(banner);
  console.log(kleur.bold("agent-bus kanban"));

  const rows = listTasks({
    ...opts,
    state: taskStates(opts),
    include_terminal: opts.all === true || opts.done === true,
    limit: opts.limit ?? 200,
  });
  const waitingReview = rows.filter((task) => task.review_required && task.review_state === "pending" && !TERMINAL_STATES.includes(task.state));

  for (const state of taskStates(opts)) {
    printColumn(columnLabel(state), rows.filter((task) => task.state === state), opts.compact === true);
  }
  if (opts.done !== true) {
    printColumn("Waiting Review", waitingReview, opts.compact === true);
  }
}

function printColumn(title: string, tasks: Task[], compact: boolean): void {
  console.log(kleur.bold(`${title}:`));
  if (tasks.length === 0) {
    console.log(kleur.gray("  - none"));
    return;
  }
  for (const task of tasks) {
    if (compact) {
      const held = task.claimed_by ?? task.pending_assignee ?? "-";
      const stale = task.stale === true ? " stale" : "";
      console.log(`  - #${task.id} ${truncate(task.title, 72)}${kleur.gray(` held=${held}${stale}`)}`);
    } else {
      console.log(`  - ${formatTask(task)}`);
    }
  }
}

function taskStates(opts: KanbanOptions): TaskState[] {
  if (opts.done === true) return TERMINAL_STATES;
  if (opts.all === true) return ALL_STATES;
  return ACTIVE_STATES;
}

function parseDoneState(value: string | undefined): TaskState[] {
  if (value === undefined) return TERMINAL_STATES;
  if (TERMINAL_STATES.includes(value as TaskState)) return [value as TaskState];
  throw new Error("done --state must be completed, failed, or canceled");
}

function columnLabel(state: TaskState): string {
  switch (state) {
    case "open":
      return "Open";
    case "claimed":
      return "Claimed";
    case "working":
      return "Working";
    case "blocked":
      return "Blocked";
    case "completed":
      return "Completed";
    case "failed":
      return "Failed";
    case "canceled":
      return "Canceled";
  }
}

function printList(values: string[]): void {
  console.log(values.length === 0 ? "  - none" : values.map((value) => `  - ${value}`).join("\n"));
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}
