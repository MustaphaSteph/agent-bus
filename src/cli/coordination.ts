import kleur from "kleur";
import {
  activityTimeline,
  agentNow,
  cockpit,
  type ActivityItem,
} from "../bus.js";
import { scopeBanner, type ScopeOptions } from "./project-scope.js";

export interface ActivityCliOptions extends ScopeOptions {
  limit?: number;
  sinceMs?: number;
}

export function printActivity(opts: ActivityCliOptions): void {
  const banner = scopeBanner(opts);
  if (banner) console.log(banner);
  console.log(kleur.bold("agent-bus activity"));
  const rows = activityTimeline({
    project: opts.project,
    area: opts.area,
    team: opts.team,
    since: opts.sinceMs,
    limit: opts.limit,
  });
  if (rows.length === 0) {
    console.log(kleur.gray("  - none"));
    return;
  }
  for (const row of rows) {
    console.log(formatActivity(row));
  }
}

export function printCockpit(opts: ScopeOptions & { limit?: number }): void {
  const banner = scopeBanner(opts);
  if (banner) console.log(banner);
  const view = cockpit(opts);
  console.log(kleur.bold("agent-bus cockpit"));
  printSection("Waiting on", view.waiting_on);
  printSection("Ready", view.ready);
  printSection("Blockers", view.blockers);
  printSection("Suggested next actions", view.suggested_next_actions);
}

export function printNow(opts: {
  agent: string;
  taskId?: number;
  phase?: string | null;
  note?: string | null;
  status?: string;
}): void {
  const result = agentNow({
    agent: opts.agent,
    task_id: opts.taskId,
    phase: opts.phase,
    note: opts.note,
    status: opts.status as never,
  });
  console.log(`${kleur.green("updated")} ${result.agent.name} status=${result.agent.status}`);
  if (result.task) {
    console.log(`task #${result.task.id} state=${result.task.state} phase=${result.task.phase ?? "-"}`);
  }
  if (result.event) {
    console.log(`event #${result.event.id} ${result.event.event_type}: ${result.event.message}`);
  }
  printSection("Suggested next actions", result.suggested_next_actions);
}

export function parseSince(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const match = /^(\d+)([smhd])$/.exec(trimmed);
  if (!match) throw new Error("--since must be ms epoch or a duration like 30m, 2h, 1d");
  const amount = Number(match[1]);
  const unit = match[2];
  const scale = unit === "s" ? 1000 : unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return Date.now() - amount * scale;
}

function formatActivity(row: ActivityItem): string {
  const time = new Date(row.at).toLocaleTimeString();
  const tag = kleur.gray(`[${row.source}]`);
  return `${kleur.gray(time)} ${tag} ${truncate(row.summary, 180)}`;
}

function printSection(title: string, values: string[]): void {
  console.log(kleur.bold(`${title}:`));
  if (values.length === 0) {
    console.log(kleur.gray("  - none"));
    return;
  }
  for (const value of values) console.log(`  - ${value}`);
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}${kleur.gray(`... (${value.length - max} more chars)`)}`;
}
