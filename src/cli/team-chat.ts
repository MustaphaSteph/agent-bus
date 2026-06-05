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
  watch?: boolean;
  interval: string;
  from?: string;
  message?: string;
  thread?: string;
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
    for (const row of sent) console.log(formatMessage(row));
    if (sent.length === 0) {
      console.log(kleur.yellow("no active recipients in this team scope"));
    }
    if (opts.watch !== true && opts.showLog !== true) return;
    console.log(kleur.gray("---"));
  }

  printTeamChatLog(scope, Number(opts.last));
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

function printTeamChatLog(scope: ScopeOptions & { team: string }, last: number): void {
  console.log(kleur.bold(`team chat ${scope.team}`));
  const banner = scopeBanner(scope);
  if (banner) console.log(banner);
  const messages = recentMessages({ limit: last, ...scope });
  if (messages.length === 0) {
    console.log(kleur.gray("(no team chat messages yet)"));
    return;
  }
  for (const message of messages) {
    console.log(formatTeamChatMessage(message));
  }
}

function formatTeamChatMessage(message: Message): string {
  const channel = message.channel ? kleur.gray(` channel=${message.channel}`) : "";
  const thread = message.thread_id ? kleur.gray(` thread=${message.thread_id}`) : "";
  return `${formatMessage(message)}${channel}${thread}`;
}
