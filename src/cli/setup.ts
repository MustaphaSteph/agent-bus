import { checkbox, confirm, input, password, select } from "@inquirer/prompts";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
  mode: "local" | "cloud";
  clients: ClientName[];
  url?: string;
  token?: string;
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

export function validateEndpoint(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Enter a full workspace MCP URL: https://host/mcp/workspace"); }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
      url.username || url.password || url.search || url.hash || !/^\/mcp\/[a-zA-Z0-9_-]+$/.test(url.pathname)) {
    throw new Error("Use HTTPS /mcp/<workspace> without credentials, query, or fragment (HTTP is allowed only on loopback).");
  }
  return url.href;
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
  if (!["local", "cloud"].includes(options.mode)) throw new Error("Mode must be local or cloud.");
  if (!options.clients.length || options.clients.some(c => !CLIENTS.includes(c))) throw new Error(`Choose clients: ${CLIENTS.join(", ")}`);
  const name = options.name ?? (options.mode === "cloud" ? "agent-bus-cloud" : "agent-bus");
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(name)) throw new Error("Server name must use 1-64 letters, digits, hyphens, or underscores.");
  if (options.mode === "local" && (options.url || options.token)) throw new Error("Cloud URL/token cannot be used in local mode.");
  if (options.mode === "cloud" && options.localServer) throw new Error("--local-server is only for local mode.");
  let entry: Entry;
  if (options.mode === "cloud") {
    const url = validateEndpoint(options.url ?? "");
    if (!options.token?.trim() || /\s/.test(options.token)) throw new Error("Supply a workspace token via the hidden prompt or --token-env. Tokens must not contain whitespace.");
    entry = { url, headers: { Authorization: `Bearer ${options.token}` } };
  } else {
    if (options.localServer && !existsSync(resolve(options.localServer))) throw new Error("Local server file does not exist. Run npm run build first.");
    entry = options.localServer
      ? { command: process.execPath, args: [resolve(options.localServer)] }
      : { command: "npx", args: ["--yes", `--package=@agent-bus-connect/cli@${packageVersion()}`, "agent-bus-mcp"] };
  }
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
  const skillName = options.mode === "cloud" ? "agent-bus-cloud" : "agent-bus";
  const source = join(packageRoot, "skills", skillName);
  for (const client of new Set(options.clients)) {
    const paths = clientPaths(client, home, env);
    const clientEntry = client === "codex"
      ? options.mode === "cloud"
        ? { url: entry.url, http_headers: entry.headers, startup_timeout_sec: 30, tool_timeout_sec: 120 }
        : { ...entry, startup_timeout_sec: 120, tool_timeout_sec: 120 }
      : client === "claude-code" ? { type: options.mode === "cloud" ? "http" : "stdio", ...entry }
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
  const isolated = plan.options.mode === "local" ? mkdtempSync(join(tmpdir(), "agent-bus-setup-")) : undefined;
  const timeout = AbortSignal.timeout(timeoutMs);
  const transport = plan.options.mode === "cloud"
    ? new StreamableHTTPClientTransport(new URL(String(plan.entry.url)), {
      requestInit: { headers: plan.entry.headers as Record<string, string>, redirect: "error" },
      fetch: (url, init) => fetch(url, { ...init, redirect: "error", signal: AbortSignal.any([timeout, ...(init?.signal ? [init.signal] : [])]) }),
      reconnectionOptions: { maxRetries: 0, initialReconnectionDelay: 1000, maxReconnectionDelay: 1000, reconnectionDelayGrowFactor: 1 },
    })
    : new StdioClientTransport({
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
    if (plan.options.mode === "cloud") {
      if (!names.has("cloud_workspace")) throw new Error("Not an Agent Bus Cloud server");
      const result = await client.callTool({ name: "cloud_workspace", arguments: {} }, undefined, { timeout: 15000, signal: timeout });
      if (result.isError) throw new Error("Workspace access denied");
      const blocks = result.content as { type: string; text?: string }[];
      const text = blocks.find(block => block.type === "text")?.text;
      const workspace = text ? JSON.parse(text) : result.structuredContent;
      if (!object(workspace) || workspace.workspace !== new URL(String(plan.entry.url)).pathname.split("/").pop() ||
          !["owner", "manager", "agent"].includes(String(workspace.role))) throw new Error("Workspace mismatch or read-only token");
    }
    return names.size;
  } catch {
    // Remote errors may echo headers or credentials; do not print their bodies.
    throw new Error(plan.options.mode === "cloud"
      ? "Cloud MCP verification failed. Check the workspace URL, token, permissions, and network. No configuration was written."
      : "Local MCP verification failed. Check Node >=20, npm access, and that this exact CLI version is published (or use --local-server for a source build). No configuration was written.");
  } finally {
    await client.close().catch(() => {});
    await transport.close().catch(() => {});
    if (isolated) rmSync(isolated, { recursive: true, force: true });
  }
}

export function registerSetupCommands(program: Command) {
  program.command("setup").description("Install bundled skills and connect clients to Local or Cloud MCP")
    .option("--mode <mode>", "local or cloud")
    .option("--clients <names>", `comma-separated: ${CLIENTS.join(", ")}`)
    .option("--url <url>", "Cloud workspace MCP URL")
    .option("--token-env <variable>", "environment variable containing a workspace token (never pass the token as an argument)")
    .option("--name <name>", "MCP server name (default agent-bus or agent-bus-cloud)")
    .option("--replace", "back up and replace differing Agent Bus entries/skill files; TOML comments may be reformatted")
    .option("--local-server <path>", "developer option: persistent built MCP server.js instead of a pinned npm package")
    .option("--dry-run", "show destination paths without writing or connecting")
    .option("--yes", "confirm writes without prompting; requires --mode and --clients")
    .action(async (flags) => {
      const interactive = !!process.stdin.isTTY && !!process.stdout.isTTY && !flags.yes;
      if (!interactive && (!flags.mode || !flags.clients)) throw new Error("Non-interactive setup requires --mode and --clients. Use --yes to apply, or --dry-run to inspect.");
      const mode = flags.mode ?? await select({ message: "Where should your agents connect?", choices: [
        { name: "Local - sessions on this machine", value: "local" }, { name: "Cloud - shared workspace across machines", value: "cloud" },
      ] });
      const selected = flags.clients ? String(flags.clients).split(",").map(v => v.trim()) : await checkbox({
        message: "Choose agent clients (detected config folders are marked)", choices: CLIENTS.map(value => ({
          value, name: `${value}${existsSync(clientPaths(value).root) ? " (detected)" : ""}`,
        })), required: true,
      });
      if (!selected.length || selected.some(value => !CLIENTS.includes(value as ClientName))) throw new Error(`Choose clients: ${CLIENTS.join(", ")}`);
      const clients = selected as ClientName[];
      let url = flags.url;
      let token: string | undefined;
      if (flags.tokenEnv) {
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(flags.tokenEnv)) throw new Error("Invalid token environment variable name.");
        token = process.env[flags.tokenEnv];
        if (!token) throw new Error("The selected token environment variable is empty.");
      }
      if (mode === "cloud") {
        if (!url && interactive) url = await input({ message: "Workspace MCP URL (copy from your Cloud dashboard):" });
        validateEndpoint(url ?? "");
        if (!token && flags.dryRun) token = "DRY_RUN_NOT_A_TOKEN";
        if (!token && interactive) token = await password({ message: "Workspace token (stored in private user config; never in this repository):", mask: "*" });
      }
      const options: SetupOptions = { mode, clients, url, token, name: flags.name, replace: flags.replace, localServer: flags.localServer };
      const plan = planSetup(options);
      console.log(`\n${mode === "cloud" ? "Cloud" : "Local"} connection; ${plan.changes.length} file changes:`);
      for (const path of plan.configs) console.log(`  ${path}`);
      console.log("Includes bundled Agent Bus skill files. Existing differing files require --replace; unrelated settings are preserved.");
      if (mode === "cloud") console.log("The token is stored as a static header in user config (0600), not encrypted. Backups also contain credentials; keep them private.");
      if (flags.replace && clients.includes("codex")) console.log("Replacing an existing TOML entry may reformat comments; the original is backed up.");
      if (flags.dryRun) { console.log("Dry run: no files written, no connection attempted."); return; }
      if (!flags.yes && (!interactive || !await confirm({ message: "Test the connection and apply these changes?", default: false }))) {
        console.log("Canceled. No files written."); return;
      }
      console.log("Checking MCP initialize, tool discovery, and workspace access (up to 120 seconds)...");
      const count = await verifySetup(plan);
      const backups = applySetup(plan);
      console.log(`Connected: ${count} MCP tools discovered. Setup complete.`);
      if (backups.length) console.log(`Backups created (${backups.length}); filenames end in .agent-bus-backup-<id>.`);
      console.log(`Restart/reconnect your selected agent clients. Enable/trust '${options.name ?? (mode === "cloud" ? "agent-bus-cloud" : "agent-bus")}' if prompted.`);
      console.log("Ask each session: Use Agent Bus, register a unique name, and join the same team. Tell it which connection to use if both Local and Cloud are installed.");
      console.log("This installs skills + MCP configuration, not marketplace plugins, hooks, or automatic agent wakeups. Project/plugin settings may override user settings.");
    });
}
