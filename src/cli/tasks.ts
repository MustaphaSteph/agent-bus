import kleur from "kleur";
import { listTasks, type Task, type TaskState } from "../bus.js";
import { sleep } from "../util/time.js";
import { scopeBanner, type ScopeOptions } from "./project-scope.js";

const TERMINAL_STATES: TaskState[] = ["completed", "failed", "canceled"];

export interface TasksOptions extends ScopeOptions {
  state?: string;
  all?: boolean;
  watch?: boolean;
  intervalMs?: number;
  requiredCapability?: string;
}

export async function tasks(opts: TasksOptions): Promise<void> {
  const state = parseState(opts.state);
  if (opts.watch) {
    await watchTasks({ ...opts, state });
    return;
  }

  const rows = readTasks(state, opts.all === true, opts);
  printScope(opts);
  if (rows.length === 0) {
    console.log(kleur.gray("(no tasks)"));
    return;
  }
  for (const task of rows) console.log(formatTask(task));
}

function readTasks(
  state: TaskState | undefined,
  includeTerminal: boolean,
  scope: ScopeOptions & { requiredCapability?: string },
): Task[] {
  const { requiredCapability, ...busScope } = scope;
  return listTasks({
    state,
    include_terminal: includeTerminal,
    required_capability: requiredCapability,
    ...busScope,
  });
}

async function watchTasks(opts: TasksOptions & { state?: TaskState }): Promise<never> {
  const interval = opts.intervalMs ?? 1000;
  const includeTerminal = opts.all === true;
  const seen = new Map<number, string>();

  console.log(kleur.bold("agent-bus tasks"));
  printScope(opts);
  console.log(kleur.gray("---"));

  for (;;) {
    const rows = readTasks(opts.state, includeTerminal, opts);
    for (const task of rows) {
      const fingerprint = taskFingerprint(task);
      if (seen.get(task.id) !== fingerprint) {
        console.log(formatTask(task));
        seen.set(task.id, fingerprint);
      }
    }
    await sleep(interval);
  }
}

function parseState(value: string | undefined): TaskState | undefined {
  if (value === undefined) return undefined;
  if (TERMINAL_STATES.includes(value as TaskState) || ["open", "claimed", "working", "blocked"].includes(value)) {
    return value as TaskState;
  }
  throw new Error(
    `invalid task state '${value}' (expected open, claimed, working, blocked, completed, failed, or canceled)`,
  );
}

function taskFingerprint(task: Task): string {
  return JSON.stringify({
    state: task.state,
    title: task.title,
    priority: task.priority,
    claimed_by: task.claimed_by,
    requested_by: task.requested_by,
    project: task.project,
    area: task.area,
    required_capability: task.required_capability,
    updated_at: task.updated_at,
    stale: task.stale === true,
  });
}

export function formatTask(task: Task): string {
  const stale = task.stale === true;
  const state = colorState(task.state)(`[${task.state}]`);
  const held = task.claimed_by ?? "-";
  const thread = abbreviateThread(task.thread_id);
  const project = task.project ? `, project=${task.project}` : ", project=no-project";
  const area = task.area ? `, area=${task.area}` : "";
  const cap = task.required_capability ? `, capability=${task.required_capability}` : "";
  const line =
    `#${task.id} p${task.priority} ${state} ${truncate(task.title, 80)} ` +
    `${kleur.gray("-")} by ${task.requested_by}, held=${held}, thread=${thread}${kleur.gray(project + area + cap)}`;
  return stale ? kleur.red(`${line} stale`) : line;
}

function printScope(scope: ScopeOptions): void {
  const banner = scopeBanner(scope);
  if (banner) console.log(banner);
}

function colorState(state: TaskState): (value: string) => string {
  switch (state) {
    case "open":
      return kleur.cyan;
    case "claimed":
      return kleur.yellow;
    case "working":
      return kleur.blue;
    case "blocked":
      return kleur.red;
    case "completed":
      return kleur.green;
    case "failed":
      return kleur.red;
    case "canceled":
      return kleur.gray;
  }
}

function abbreviateThread(threadId: string): string {
  return threadId.length <= 8 ? threadId : threadId.slice(-8);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}...`;
}
