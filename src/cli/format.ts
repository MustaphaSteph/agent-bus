import kleur from "kleur";
import type { Message } from "../bus.js";

const palette = [
  kleur.cyan,
  kleur.magenta,
  kleur.yellow,
  kleur.green,
  kleur.blue,
  kleur.red,
] as const;

const colorCache = new Map<string, (s: string) => string>();

export function colorFor(agent: string): (s: string) => string {
  const cached = colorCache.get(agent);
  if (cached) return cached;
  let hash = 0;
  for (const ch of agent) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const chosen = palette[hash % palette.length] ?? kleur.white;
  colorCache.set(agent, chosen);
  return chosen;
}

export function formatMessage(m: Message): string {
  const time = new Date(m.created_at).toLocaleTimeString();
  const from = colorFor(m.from_agent)(m.from_agent);
  const to = colorFor(m.to_agent)(m.to_agent);
  const tag =
    m.kind === "ask"
      ? kleur.bold().yellow("ASK")
      : m.kind === "reply"
        ? kleur.bold().green("REPLY")
        : kleur.gray("msg");
  const replyRef = m.reply_to ? kleur.gray(` ↪#${m.reply_to}`) : "";
  return `${kleur.gray(time)} #${m.id} ${from} ${kleur.gray("→")} ${to} ${tag}${replyRef}\n  ${truncate(m.content, 400)}`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max)}${kleur.gray(`… (${s.length - max} more chars)`)}`;
}
