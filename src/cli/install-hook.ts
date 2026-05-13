import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import kleur from "kleur";

const HOOK_MARKER = "agent-bus:auto-inbox";

interface HookEntry {
  type: "command";
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

interface SettingsShape {
  hooks?: Record<string, HookMatcher[]>;
  [key: string]: unknown;
}

function settingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function readSettings(path: string): SettingsShape {
  if (!existsSync(path)) return {};
  const raw = readFileSync(path, "utf8").trim();
  if (raw.length === 0) return {};
  return JSON.parse(raw) as SettingsShape;
}

function writeSettings(path: string, value: SettingsShape): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

export function installHook(agent: string): void {
  const path = settingsPath();
  const settings = readSettings(path);
  const hooks = settings.hooks ?? {};
  const stops = hooks.Stop ?? [];

  const command = `agent-bus poll-inbox --agent ${shellEscape(agent)} --session "$CLAUDE_SESSION_ID" # ${HOOK_MARKER}:${agent}`;

  const filtered = stops.filter((m) => !m.hooks.some((h) => h.command.includes(`${HOOK_MARKER}:${agent}`)));
  filtered.push({
    matcher: ".*",
    hooks: [{ type: "command", command }],
  });

  hooks.Stop = filtered;
  settings.hooks = hooks;
  writeSettings(path, settings);

  console.log(kleur.green("✓"), `installed Stop hook for '${agent}' in ${path}`);
  console.log(kleur.gray("  Claude Code will auto-poll your inbox after every turn."));
}

export function uninstallHook(): void {
  const path = settingsPath();
  if (!existsSync(path)) {
    console.log(kleur.gray("nothing to remove (no settings.json)"));
    return;
  }
  const settings = readSettings(path);
  const stops = settings.hooks?.Stop ?? [];
  const filtered = stops.filter(
    (m) => !m.hooks.some((h) => h.command.includes(HOOK_MARKER)),
  );
  if (filtered.length === stops.length) {
    console.log(kleur.gray("no agent-bus hook found"));
    return;
  }
  if (settings.hooks) {
    settings.hooks.Stop = filtered;
    if (filtered.length === 0) delete settings.hooks.Stop;
  }
  writeSettings(path, settings);
  console.log(kleur.green("✓"), "removed agent-bus Stop hook");
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
