import kleur from "kleur";
import { messagesSince, whois } from "../bus.js";
import { sleep } from "../util/time.js";
import { formatMessage } from "./format.js";

export interface WatchOptions {
  intervalMs?: number;
  fromId?: number;
  project?: string;
}

export async function watch(opts: WatchOptions = {}): Promise<never> {
  const interval = opts.intervalMs ?? 250;
  let lastId = opts.fromId ?? mostRecentId(opts.project);

  printHeader(opts.project);

  for (;;) {
    const fresh = messagesSince(lastId, 200, opts.project);
    for (const m of fresh) {
      console.log(formatMessage(m));
      lastId = m.id;
    }
    await sleep(interval);
  }
}

function mostRecentId(project: string | undefined): number {
  const recent = messagesSince(0, 1, project).at(-1);
  return recent ? recent.id - 1 : 0;
}

function printHeader(project: string | undefined): void {
  const agents = whois({ project });
  console.log(kleur.bold("agent-bus watch"));
  if (project !== undefined && project !== "*") {
    console.log(kleur.gray(`scoped: ${project} (use --project all for global)`));
  }
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
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`  ${status}  ${kleur.bold(a.name)}${kleur.gray(caps)}${kleur.gray(projectChip)}${paused}`);
    }
  }
  console.log(kleur.gray("---"));
}
