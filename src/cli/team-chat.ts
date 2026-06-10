import kleur from "kleur";
import {
  recentMessages,
  sendTeam,
  TEAM_WILDCARD,
  type Message,
} from "../bus.js";
import { formatMessage } from "./format.js";
import { resolveScopeOptions, scopeBanner, type ScopeOptions } from "./project-scope.js";
import { watch } from "./watch.js";

export interface TeamChatOptions {
  team: string;
  project?: string;
  area?: string;
  last: string;
  sinceId?: string;
  watch?: boolean;
  interval: string;
  from?: string;
  message?: string;
  thread?: string;
  threads?: boolean;
  includeSelf?: boolean;
  showLog?: boolean;
}

export async function teamChat(messageArg: string | undefined, opts: TeamChatOptions): Promise<void> {
  const scope = resolveTeamChatScope(opts.project, opts.area, opts.team);
  const message = opts.message ?? messageArg;

  if (message !== undefined) {
    if (!opts.from) {
      throw new Error("--from is required when sending a team chat message");
    }
    const sent = sendTeam({
      from: opts.from,
      team: scope.team,
      content: message,
      thread_id: opts.thread,
      include_self: opts.includeSelf,
      project: scope.project,
      area: scope.area,
    });
    console.log(`${kleur.green("sent")} ${sent.length} team chat message(s)`);
    for (const row of sent) console.log(formatTeamChatMessage(row));
    if (sent.length === 0) {
      console.log(kleur.yellow("no active recipients in this team scope"));
    }
    if (opts.watch !== true && opts.showLog !== true) return;
    console.log(kleur.gray("---"));
  }

  if (opts.threads === true) {
    printThreadSummary(scope, Number(opts.last), opts.sinceId ? Number(opts.sinceId) : undefined);
  } else {
    printTeamChatLog(scope, Number(opts.last), opts.thread, opts.sinceId ? Number(opts.sinceId) : undefined);
  }
  if (opts.watch === true) {
    console.log(kleur.gray("--- watching team chat; Ctrl+C to stop ---"));
    await watch({
      ...scope,
      intervalMs: Number(opts.interval),
      strict: true,
    });
  }
}

function resolveTeamChatScope(project: string | undefined, area: string | undefined, team: string): ScopeOptions & { team: string } {
  const scope = resolveScopeOptions(project, area, team);
  if (scope.team === undefined || scope.team === TEAM_WILDCARD) {
    throw new Error("team-chat requires a concrete --team value");
  }
  return { ...scope, team: scope.team };
}

function printTeamChatLog(scope: ScopeOptions & { team: string }, last: number, threadId?: string, sinceId?: number): void {
  console.log(kleur.bold(`team chat ${scope.team}${threadId ? ` thread=${threadId}` : ""}`));
  const banner = scopeBanner(scope);
  if (banner) console.log(banner);
  const messages = recentMessages({ limit: last, ...scope, thread_id: threadId, since_id: sinceId });
  if (messages.length === 0) {
    console.log(kleur.gray("(no team chat messages yet)"));
    return;
  }
  for (const message of messages) {
    console.log(formatTeamChatMessage(message));
  }
}

function printThreadSummary(scope: ScopeOptions & { team: string }, last: number, sinceId?: number): void {
  console.log(kleur.bold(`team chat threads ${scope.team}`));
  const banner = scopeBanner(scope);
  if (banner) console.log(banner);
  const messages = recentMessages({ limit: Math.max(last, 100), ...scope, since_id: sinceId });
  if (messages.length === 0) {
    console.log(kleur.gray("(no team chat threads yet)"));
    return;
  }
  const byThread = new Map<string, { count: number; first: Message; last: Message; participants: Set<string> }>();
  for (const message of messages) {
    const key = message.thread_id || `message-${message.id}`;
    const existing = byThread.get(key);
    if (existing) {
      existing.count += 1;
      existing.last = message;
      existing.participants.add(message.from_agent);
      existing.participants.add(message.to_agent);
    } else {
      byThread.set(key, {
        count: 1,
        first: message,
        last: message,
        participants: new Set([message.from_agent, message.to_agent]),
      });
    }
  }
  const rows = [...byThread.entries()]
    .sort((a, b) => b[1].last.id - a[1].last.id)
    .slice(0, last);
  for (const [thread, row] of rows.reverse()) {
    const participants = [...row.participants].join(", ");
    console.log(`#${row.last.id} ${kleur.bold(thread)} ${kleur.gray(`${row.count} msg, ${participants}`)}`);
    console.log(`  ${row.last.from_agent}: ${row.last.content.length > 160 ? `${row.last.content.slice(0, 160)}…` : row.last.content}`);
  }
}

function formatTeamChatMessage(message: Message): string {
  const channel = message.channel ? kleur.gray(` channel=${message.channel}`) : "";
  const thread = message.thread_id ? kleur.gray(` thread=${message.thread_id}`) : "";
  return `${formatMessage(message)}${channel}${thread}`;
}
