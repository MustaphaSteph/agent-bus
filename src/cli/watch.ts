import kleur from "kleur";
import {
  AREA_WILDCARD,
  type Agent,
  type Message,
  PROJECT_WILDCARD,
  messagesSince,
  whois,
} from "../bus.js";
import { sleep } from "../util/time.js";
import { formatMessage } from "./format.js";
import { scopeBanner, type ScopeOptions } from "./project-scope.js";

export interface WatchOptions extends ScopeOptions {
  intervalMs?: number;
  fromId?: number;
  strict?: boolean;
}

export async function watch(opts: WatchOptions = {}): Promise<never> {
  const interval = opts.intervalMs ?? 250;
  let lastId = opts.fromId ?? mostRecentId(opts);

  printHeader(opts);

  for (;;) {
    const raw = messagesSince(lastId, 200, opts.project, opts.area);
    for (const m of raw) lastId = m.id;
    const fresh = filterStrict(raw, opts);
    for (const m of fresh) {
      console.log(formatMessage(m));
    }
    await sleep(interval);
  }
}

function mostRecentId(scope: ScopeOptions): number {
  const recent = messagesSince(0, 1, scope.project, scope.area).at(-1);
  return recent ? recent.id - 1 : 0;
}

function printHeader(scope: ScopeOptions): void {
  const agents = filterAgentsStrict(whois(scope), scope);
  console.log(kleur.bold("agent-bus watch"));
  const banner = scopeBanner(scope);
  if (banner) console.log(banner);
  if (agents.length === 0) {
    console.log(kleur.gray("  no agents registered yet"));
  } else {
    for (const a of agents) {
      const age = Date.now() - a.last_seen;
      const status =
        age < 60_000
          ? kleur.green("online")
          : age < 5 * 60_000
            ? kleur.yellow("idle")
            : kleur.gray("stale");
      const caps = a.capabilities.length > 0 ? ` [${a.capabilities.join(", ")}]` : "";
      const projectChip = a.project ? ` {${a.project}}` : " {no-project}";
      const areaChip = a.area ? `/${a.area}` : "";
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`  ${status}  ${kleur.bold(a.name)}${kleur.gray(caps)}${kleur.gray(projectChip + areaChip)}${paused}`);
    }
  }
  console.log(kleur.gray("---"));
}

function filterStrict(messages: Message[], scope: WatchOptions): Message[] {
  if (scope.strict !== true) return messages;
  return messages.filter((message) => {
    const projectOk = scope.project === undefined || scope.project === PROJECT_WILDCARD || message.project === scope.project;
    const areaOk = scope.area === undefined || scope.area === AREA_WILDCARD || message.area === scope.area;
    return projectOk && areaOk;
  });
}

function filterAgentsStrict(agents: Agent[], scope: ScopeOptions): Agent[] {
  return agents.filter((agent) => {
    const projectOk = scope.project === undefined || scope.project === PROJECT_WILDCARD || agent.project === scope.project;
    const areaOk = scope.area === undefined || scope.area === AREA_WILDCARD || agent.area === scope.area;
    return projectOk && areaOk;
  });
}
