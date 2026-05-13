import kleur from "kleur";
import { messagesSince, whois } from "../bus.js";
import { sleep } from "../util/time.js";
import { formatMessage } from "./format.js";

export interface WatchOptions {
  intervalMs?: number;
  fromId?: number;
}

export async function watch(opts: WatchOptions = {}): Promise<never> {
  const interval = opts.intervalMs ?? 250;
  let lastId = opts.fromId ?? mostRecentId();

  printHeader();

  for (;;) {
    const fresh = messagesSince(lastId, 200);
    for (const m of fresh) {
      console.log(formatMessage(m));
      lastId = m.id;
    }
    await sleep(interval);
  }
}

function mostRecentId(): number {
  const recent = messagesSince(0, 1).at(-1);
  return recent ? recent.id - 1 : 0;
}

function printHeader(): void {
  const agents = whois();
  console.log(kleur.bold("agent-bus watch"));
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
      const paused = a.paused ? kleur.red(" (paused)") : "";
      console.log(`  ${status}  ${kleur.bold(a.name)}${kleur.gray(caps)}${paused}`);
    }
  }
  console.log(kleur.gray("---"));
}
