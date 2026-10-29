import { checkbox, confirm } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { applyEdits, modify, parse as parseJson, type ParseError } from "jsonc-parser";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import { isDeepStrictEqual } from "node:util";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { packageVersion } from "../util/package-info.js";

export const CLIENTS = ["codex", "claude-code", "kimi", "cursor"] as const;
export type ClientName = typeof CLIENTS[number];
type Entry = Record<string, unknown>;
export interface SetupOptions {
  mode: "local";
  clients: ClientName[];
  name?: string;
  replace?: boolean;
  localServer?: string;
}
export interface Change { path: string; before: string | null; after: string; mode: number }
export interface SetupPlan { options: SetupOptions; entry: Entry; changes: Change[]; configs: string[] }
const packageRoot = fileURLToPath(new URL("../../", import.meta.url));

function object(value: unknown): value is Entry {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function clientPaths(client: ClientName, home = homedir(), env = process.env) {
  const root = client === "codex" ? env.CODEX_HOME || join(home, ".codex")
    : client === "kimi" ? env.KIMI_CODE_HOME || join(home, ".kimi-code")
    : client === "claude-code" ? env.CLAUDE_CONFIG_DIR || join(home, ".claude")
    : join(home, ".cursor");
  return {
    root: resolve(root),
    config: client === "claude-code"
      ? env.CLAUDE_CONFIG_DIR ? join(root, ".claude.json") : join(home, ".claude.json")
      : join(root, client === "codex" ? "config.toml" : "mcp.json"),
    skills: join(root, "skills"),
  };
}

function safePath(path: string) {
  for (let current = resolve(path); ; current = dirname(current)) {
    try {
      if (lstatSync(current).isSymbolicLink()) throw new Error(`Refusing symlink destination: ${current}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (dirname(current) === current) break;
  }
}

function readExisting(path: string): string | null {
  safePath(path);
  if (!existsSync(path)) return null;
  if (!lstatSync(path).isFile()) throw new Error(`Not a regular file: ${path}`);
  return readFileSync(path, "utf8");
}

export function mergeConfig(raw: string | null, entry: Entry, name: string, toml: boolean, replace = false): string {
  let parsed: unknown;
  try {
    const errors: ParseError[] = [];
    parsed = toml ? parseToml(raw || "") : parseJson(raw ?? "{}", errors);
    if (errors.length || !object(parsed)) throw new Error();
  } catch { throw new Error("Invalid existing configuration; repair it before setup. No settings were changed."); }
  const rootKey = toml ? "mcp_servers" : "mcpServers";
  const servers = parsed[rootKey];
  if (servers !== undefined && !object(servers)) throw new Error(`Existing ${rootKey} must be an object.`);
  const existing = object(servers) && Object.hasOwn(servers, name) ? servers[name] : undefined;
  // TOML objects have a null prototype; compare their JSON-compatible values.
  if (existing !== undefined && isDeepStrictEqual(JSON.parse(JSON.stringify(existing)), entry)) return raw!;
  if (existing !== undefined && !replace) throw new Error(`MCP entry '${name}' already differs. Use --replace to replace only this entry, or --name for a separate connection.`);
  if (!toml) return applyEdits(raw ?? "{}", modify(raw ?? "{}", [rootKey, name], entry, {
    formattingOptions: { insertSpaces: true, tabSize: 2 },
  })) + (raw?.endsWith("\n") ? "" : "\n");

  // New TOML tables can be appended without disturbing existing comments.
  if (existing === undefined) {
    const result = `${raw ?? ""}\n${stringifyToml({ [rootKey]: { [name]: entry } })}`;
    try { parseToml(result); return result; } catch { /* Inline tables require reserialization. */ }
  }
  return stringifyToml({ ...parsed, [rootKey]: { ...(object(servers) ? servers : {}), [name]: entry } });
}

export function planSetup(options: SetupOptions, home = homedir(), env = process.env): SetupPlan {
  if (options.mode !== "local") throw new Error("This installer supports only local mode.");
  if (!options.clients.length || options.clients.some(c => !CLIENTS.includes(c))) throw new Error(`Choose clients: ${CLIENTS.join(", ")}`);
  const name = options.name ?? "agent-bus";
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error("Server name must use 1-64 letters, digits, hyphens, or underscores.");
  if (options.localServer && !existsSync(resolve(options.localServer))) throw new Error("Local server file does not exist. Run npm run build first.");
  const entry: Entry = options.localServer
      ? { command: process.execPath, args: [resolve(options.localServer)] }
      : { command: "npx", args: ["--yes", `--package=@agent-bus-connect/cli@${packageVersion()}`, "agent-bus-mcp"] };
  const changes: Change[] = [];
  const configs: string[] = [];
  function add(path: string, after: string, mode = 0o600, skill = false) {
    const planned = changes.find(change => change.path === path);
    if (planned) {
      if (planned.after !== after) throw new Error(`Selected clients have conflicting destination paths: ${path}`);
      return;
    }
    const before = readExisting(path);
    if (before === after && (lstatSync(path).mode & 0o077) === 0) return;
    if (skill && before !== null && before !== after && !options.replace) throw new Error(`Skill file already differs: ${path}. Use --replace to update it (with backups).`);
    changes.push({ path, before, after, mode });
  }
  const skillName = "agent-bus";
  const source = join(packageRoot, "skills", skillName);
  for (const client of new Set(options.clients)) {
    const paths = clientPaths(client, home, env);
    const clientEntry = client === "codex"
      ? { ...entry, startup_timeout_sec: 120, tool_timeout_sec: 120 }
      : client === "claude-code" ? { type: "stdio", ...entry }
      : client === "kimi" ? { ...entry, startupTimeoutMs: 120000, toolTimeoutMs: 120000 } : entry;
    const before = readExisting(paths.config);
    add(paths.config, mergeConfig(before, clientEntry, name, client === "codex", options.replace));
    configs.push(paths.config);
    const copySkill = (dir: string, destination: string) => {
      for (const item of readdirSync(dir, { withFileTypes: true })) {
        const src = join(dir, item.name), dst = join(destination, item.name);
        if (item.isDirectory()) copySkill(src, dst);
        else if (item.isFile()) add(dst, readFileSync(src, "utf8"), item.name.endsWith(".sh") ? 0o700 : 0o600, true);
        else throw new Error("Bundled skill contains an unsupported file type.");
      }
    };
    copySkill(source, join(paths.skills, skillName));
  }
  return { options, entry, changes, configs };
}

export function applySetup(plan: SetupPlan): string[] {
  const backups: string[] = [], written: Change[] = [];
  const transaction = randomUUID();
  // Preflight every file before the first write; recheck immediately before each replacement.
  for (const change of plan.changes) {
    if (readExisting(change.path) !== change.before) throw new Error(`Configuration changed during setup: ${change.path}. Retry.`);
  }
  try {
    for (const change of plan.changes) {
      if (readExisting(change.path) !== change.before) throw new Error("Configuration changed during setup. Retry.");
      mkdirSync(dirname(change.path), { recursive: true, mode: 0o700 });
      if (change.before !== null) {
        const backup = `${change.path}.agent-bus-backup-${transaction}`;
        writeFileSync(backup, change.before, { flag: "wx", mode: 0o600 });
        backups.push(backup);
      }
      const temporary = `${change.path}.agent-bus-tmp-${transaction}`;
      try {
        writeFileSync(temporary, change.after, { flag: "wx", mode: change.mode });
        renameSync(temporary, change.path);
      } finally { rmSync(temporary, { force: true }); }
      written.push(change);
    }
  } catch (error) {
    for (const change of written.reverse()) {
      // Do not overwrite a concurrent edit while rolling back our own writes.
      if (readExisting(change.path) !== change.after) continue;
      if (change.before === null) rmSync(change.path);
      else writeFileSync(change.path, change.before, { mode: 0o600 });
    }
    throw error;
  }
  return backups;
}

export async function verifySetup(plan: Pick<SetupPlan, "entry" | "options">, timeoutMs = 120000): Promise<number> {
  const client = new Client({ name: "agent-bus-setup", version: packageVersion() });
  const isolated = mkdtempSync(join(tmpdir(), "agent-bus-setup-"));
  const timeout = AbortSignal.timeout(timeoutMs);
  const transport = new StdioClientTransport({
      command: String(plan.entry.command), args: plan.entry.args as string[], stderr: "pipe",
      env: { ...Object.fromEntries(Object.entries(process.env).filter((pair): pair is [string, string] => pair[1] !== undefined)), AGENT_BUS_DIR: isolated! },
    });
  try {
    if (transport instanceof StdioClientTransport) transport.stderr?.on("data", () => {});
    await client.connect(transport, { timeout: timeoutMs, signal: timeout });
    const names = new Set<string>();
    let cursor: string | undefined;
    const seen = new Set<string>();
    do {
      const result = await client.listTools(cursor ? { cursor } : {}, { timeout: 15000, signal: timeout });
      for (const tool of result.tools) names.add(tool.name);
      cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new Error("Repeated tool cursor");
      if (cursor) seen.add(cursor);
    } while (cursor);
    for (const name of ["register", "inbox", "send"]) if (!names.has(name)) throw new Error("Not an Agent Bus server");
    return names.size;
  } catch {
    throw new Error("Local MCP verification failed. Check Node >=20, npm access, and that this exact CLI version is published (or use --local-server for a source build). No configuration was written.");
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (isolated) rmSync(isolated, { recursive: true, force: true });
  }
}

export function registerSetupCommands(program: Command) {
  program.command("setup").description("Install bundled skills and connect clients to local MCP")
    .option("--mode <mode>", "local")
    .option("--clients <names>", `comma-separated: ${CLIENTS.join(", ")}`)
    .option("--name <name>", "MCP server name (default agent-bus)")
    .option("--replace", "back up and replace differing Agent Bus entries/skill files; TOML comments may be reformatted")
    .option("--local-server <path>", "developer option: persistent built MCP server.js instead of a pinned npm package")
    .option("--dry-run", "show destination paths without writing or connecting")
    .option("--yes", "confirm writes without prompting; requires --mode and --clients")
    .action(async (flags) => {
      const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !flags.yes;
      if (!interactive && (!flags.mode || !flags.clients)) throw new Error("Non-interactive setup requires --mode and --clients. Use --yes to apply, or --dry-run to inspect.");
      const mode = flags.mode ?? "local";
      const selected = flags.clients ? String(flags.clients).split(",").map(v => v.trim()) : await checkbox({
        message: "Choose agent clients (detected config folders are marked)", choices: CLIENTS.map(value => ({
          value, name: `${value}${existsSync(clientPaths(value).root) ? " (detected)" : ""}`,
        })), required: true,
      });
      if (!selected.length || selected.some(value => !CLIENTS.includes(value as ClientName))) throw new Error(`Choose clients: ${CLIENTS.join(", ")}`);
      const clients = selected as ClientName[];
      const options: SetupOptions = { mode, clients, name: flags.name, replace: flags.replace, localServer: flags.localServer };
      const plan = planSetup(options);
      console.log(`\nLocal connection; ${plan.changes.length} file changes:`);
      for (const path of plan.configs) console.log(`  ${path}`);
      console.log("Includes bundled Agent Bus skill files. Existing differing files require --replace; unrelated settings are preserved.");
      if (flags.replace && clients.includes("codex")) console.log("Replacing an existing TOML entry may reformat comments; the original is backed up.");
      if (flags.dryRun) { console.log("Dry run: no files written, no connection attempted."); return; }
      if (!flags.yes && (!interactive || !await confirm({ message: "Test the connection and apply these changes?", default: false }))) {
        console.log("Canceled. No files written."); return;
      }
      console.log("Checking MCP initialize and tool discovery (up to 120 seconds)...");
      const count = await verifySetup(plan);
      const backups = applySetup(plan);
      console.log(`Connected: ${count} MCP tools discovered. Setup complete.`);
      if (backups.length) console.log(`Backups created (${backups.length}); filenames end in .agent-bus-backup-<id>.`);
      console.log(`Restart/reconnect your selected agent clients. Enable/trust '${options.name ?? "agent-bus"}' if prompted.`);
      console.log("Ask each session: Use Agent Bus, register a unique name, and join the same team.");
      console.log("This installs skills + MCP configuration, not marketplace plugins, hooks, or automatic agent wakeups. Project/plugin settings may override user settings.");
    });
}
