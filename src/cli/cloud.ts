import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { Command } from "commander";
import kleur from "kleur";
import { busDir } from "../util/paths.js";

type WorkspaceRole = "owner" | "manager" | "agent" | "viewer";

interface CloudConfig {
  hosts?: Record<string, { cookie?: string }>;
}

interface CloudOptions {
  host?: string;
}

interface CloudHealthBody {
  ok?: boolean;
  service?: string;
  env?: string;
  d1?: {
    ok?: boolean;
    error?: string;
  };
  tools?: {
    total?: number;
    implemented?: number;
    missing?: string[];
  };
}

interface CloudToolStatus {
  name: string;
  implemented?: boolean;
}

interface CloudWorkspaceSummary {
  slug: string;
  name: string;
  role?: string;
}

interface CloudWorkspaceMember {
  user_id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  created_at?: number;
}

const DEFAULT_HOST = "http://localhost:8787";
const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

function configPath(): string {
  return join(busDir(), "cloud.json");
}

function loadConfig(): CloudConfig {
  const path = configPath();
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as CloudConfig;
}

function saveConfig(config: CloudConfig): void {
  writeFileSync(configPath(), `${JSON.stringify(config, null, 2)}\n`);
}

function normalizeHost(host?: string): string {
  return (host ?? process.env.AGENT_BUS_CLOUD_HOST ?? DEFAULT_HOST).replace(/\/+$/, "");
}

function cookieForHost(host: string): string | undefined {
  return loadConfig().hosts?.[host]?.cookie;
}

function saveCookie(host: string, setCookie: string | null): void {
  if (!setCookie) throw new Error("cloud response did not set a session cookie");
  const cookie = setCookie.split(";")[0];
  const config = loadConfig();
  config.hosts ??= {};
  config.hosts[host] = { ...config.hosts[host], cookie };
  saveConfig(config);
}

function clearCookie(host: string): void {
  const config = loadConfig();
  if (config.hosts?.[host]) {
    delete config.hosts[host].cookie;
    saveConfig(config);
  }
}

async function parseResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return { text };
  }
}

function errorMessage(body: unknown, fallback: string): string {
  if (typeof body === "object" && body !== null) {
    const maybe = body as { error?: { message?: unknown }; message?: unknown };
    if (typeof maybe.error?.message === "string") return maybe.error.message;
    if (typeof maybe.message === "string") return maybe.message;
  }
  return fallback;
}

async function request(host: string, path: string, init: RequestInit = {}, cookie?: string): Promise<unknown> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (cookie) headers.set("cookie", cookie);
  const response = await fetch(`${host}${path}`, { ...init, headers });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(body, `${response.status} ${response.statusText}`));
  return body;
}

function requireCookie(host: string): string {
  const cookie = cookieForHost(host);
  if (!cookie) throw new Error(`not logged in for ${host}; run agent-bus cloud login --host ${host}`);
  return cookie;
}

function printJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

function mcpUrl(host: string, workspace: string): string {
  return `${host}/mcp/${encodeURIComponent(workspace)}`;
}

function printMcpConfig(host: string, workspace: string, token?: string): void {
  const url = mcpUrl(host, workspace);
  console.log(`MCP URL: ${url}`);
  if (token) {
    console.log("");
    printJson({
      mcpServers: {
        "agent-bus-cloud": {
          type: "http",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      },
    });
  }
}

async function tokenTest(host: string, workspaceSlug: string, token: string): Promise<unknown> {
  const response = await fetch(`${mcpUrl(host, workspaceSlug)}?json=1`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ tool: "cloud_workspace", input: {} }),
  });
  const body = await parseResponse(response);
  if (!response.ok) throw new Error(errorMessage(body, "token test failed"));
  return body;
}

function parseRole(value: string): WorkspaceRole {
  if (value === "owner" || value === "manager" || value === "agent" || value === "viewer") return value;
  throw new Error("role must be owner, manager, agent, or viewer");
}

function defaultCloudDir(): string {
  const appDir = resolve(process.cwd(), "apps/cloud");
  if (existsSync(join(appDir, "wrangler.toml"))) return appDir;
  return process.cwd();
}

function readCloudDeployConfig(cloudDir: string): { dir: string; databaseId?: string; envName?: string; wranglerPath: string } {
  const dir = resolve(cloudDir);
  const wranglerPath = join(dir, "wrangler.toml");
  if (!existsSync(wranglerPath)) throw new Error(`wrangler.toml not found in ${dir}`);
  const config = readFileSync(wranglerPath, "utf8");
  return {
    dir,
    wranglerPath,
    databaseId: config.match(/^\s*database_id\s*=\s*"([^"]+)"/m)?.[1],
    envName: config.match(/^\s*AGENT_BUS_CLOUD_ENV\s*=\s*"([^"]+)"/m)?.[1],
  };
}

export function registerCloudCommands(program: Command): void {
  const cloud = program
    .command("cloud")
    .description("Agent Bus Cloud setup helpers for the hosted Worker dashboard and remote MCP endpoint")
    .option("--host <url>", "Agent Bus Cloud host", DEFAULT_HOST);

  cloud
    .command("signup")
    .description("Create a dashboard account and save the session cookie locally")
    .requiredOption("--email <email>", "account email")
    .requiredOption("--password <password>", "account password")
    .option("--name <name>", "display name")
    .action(async (opts: { email: string; password: string; name?: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const response = await fetch(`${host}/api/auth/signup`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: opts.email, password: opts.password, name: opts.name }),
      });
      const body = await parseResponse(response);
      if (!response.ok) throw new Error(errorMessage(body, "signup failed"));
      saveCookie(host, response.headers.get("set-cookie"));
      console.log(`${kleur.green("signed up")} ${opts.email}`);
      console.log(`host: ${host}`);
    });

  cloud
    .command("login")
    .description("Log in to the dashboard API and save the session cookie locally")
    .requiredOption("--email <email>", "account email")
    .requiredOption("--password <password>", "account password")
    .action(async (opts: { email: string; password: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const response = await fetch(`${host}/api/auth/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: opts.email, password: opts.password }),
      });
      const body = await parseResponse(response);
      if (!response.ok) throw new Error(errorMessage(body, "login failed"));
      saveCookie(host, response.headers.get("set-cookie"));
      console.log(`${kleur.green("logged in")} ${opts.email}`);
      console.log(`host: ${host}`);
    });

  cloud
    .command("logout")
    .description("Forget the saved cloud session cookie for a host")
    .action(() => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      clearCookie(host);
      console.log(`${kleur.green("logged out")} ${host}`);
    });

  cloud
    .command("health")
    .description("Check an Agent Bus Cloud host and its published cloud tool surface")
    .option("--json", "print raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const health = await request(host, "/api/health") as CloudHealthBody;
      const toolsBody = await request(host, "/api/tools") as { tools?: CloudToolStatus[] };
      const tools = toolsBody.tools ?? [];
      const implemented = tools.filter((tool) => tool.implemented !== false).length;
      const missing = health.tools?.missing ?? tools.filter((tool) => tool.implemented === false).map((tool) => tool.name);
      const body = {
        host,
        health,
        tools: {
          total: health.tools?.total ?? tools.length,
          implemented: health.tools?.implemented ?? implemented,
          missing,
        },
      };
      if (opts.json) return printJson(body);
      const total = body.tools.total;
      const implementedCount = body.tools.implemented;
      const ok = health.ok === true && health.d1?.ok !== false && missing.length === 0 && total > 0;
      console.log(`${ok ? kleur.green("healthy") : kleur.yellow("check")} ${host}`);
      console.log(`service: ${health.service ?? "unknown"}`);
      console.log(`env: ${health.env ?? "unknown"}`);
      console.log(`d1: ${health.d1?.ok === false ? kleur.yellow("failed") : "ok"}`);
      if (health.d1?.ok === false && health.d1.error) console.log(`${kleur.yellow("d1 error:")} ${health.d1.error}`);
      console.log(`tools: ${implementedCount}/${total} implemented`);
      if (missing.length > 0) console.log(`${kleur.yellow("missing:")} ${missing.join(", ")}`);
    });

  cloud
    .command("deploy-check")
    .description("Validate local Agent Bus Cloud production deploy settings")
    .option("--dir <path>", "cloud app directory; defaults to ./apps/cloud when present")
    .option("--json", "print raw JSON")
    .action((opts: { dir?: string; json?: boolean }) => {
      const config = readCloudDeployConfig(opts.dir ?? defaultCloudDir());
      const problems: string[] = [];
      if (!config.databaseId || config.databaseId === PLACEHOLDER_DATABASE_ID) {
        problems.push("replace the placeholder D1 database_id in wrangler.toml");
      }
      if (config.envName !== "production") {
        problems.push('set AGENT_BUS_CLOUD_ENV = "production" in wrangler.toml');
      }
      const result = {
        ok: problems.length === 0,
        dir: config.dir,
        wrangler_toml: config.wranglerPath,
        database_id: config.databaseId ?? null,
        env: config.envName ?? null,
        problems,
        manual_checks: [
          "apply D1 migrations with wrangler d1 migrations apply agent-bus-cloud --remote",
          "set AGENT_BUS_CLOUD_AUTH_SECRET with wrangler secret put AGENT_BUS_CLOUD_AUTH_SECRET",
          "run npm --prefix apps/cloud run deploy from the repo root or npm run deploy inside apps/cloud",
        ],
      };
      if (opts.json) return printJson(result);
      if (result.ok) {
        console.log(`${kleur.green("deploy config: ok")} ${config.dir}`);
      } else {
        console.log(`${kleur.yellow("deploy config: needs changes")} ${config.dir}`);
        for (const problem of problems) console.log(`- ${problem}`);
      }
      console.log("manual checks:");
      for (const check of result.manual_checks) console.log(`- ${check}`);
      if (!result.ok) process.exitCode = 1;
    });

  cloud
    .command("workspaces")
    .description("List workspaces visible to the logged-in dashboard user")
    .option("--json", "print raw JSON")
    .action(async (opts: { json?: boolean }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await request(host, "/api/workspaces", {}, requireCookie(host)) as { workspaces?: Array<{ slug: string; name: string; role?: string }> };
      if (opts.json) return printJson(body);
      for (const workspace of body.workspaces ?? []) {
        console.log(`${kleur.bold(workspace.slug)} ${kleur.gray(workspace.name)} ${kleur.gray(workspace.role ?? "")}`);
      }
      if ((body.workspaces ?? []).length === 0) console.log(kleur.gray("(no workspaces)"));
    });

  cloud
    .command("bootstrap <workspace>")
    .description("Create or reuse a workspace, create an agent token, print MCP config, and verify the token")
    .option("--name <name>", "workspace display name")
    .option("--token-name <name>", "agent token name", "agent")
    .option("--role <role>", "owner, manager, agent, or viewer", "agent")
    .option("--no-token-test", "skip remote MCP token verification")
    .action(async (workspaceSlug: string, opts: { name?: string; tokenName: string; role: string; tokenTest?: boolean }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const cookie = requireCookie(host);
      const role = parseRole(opts.role);
      await request(host, "/api/health");
      const workspacesBody = await request(host, "/api/workspaces", {}, cookie) as { workspaces?: CloudWorkspaceSummary[] };
      const existing = (workspacesBody.workspaces ?? []).find((workspaceRow) => workspaceRow.slug === workspaceSlug);
      if (existing) {
        console.log(`${kleur.green("using workspace")} ${workspaceSlug}`);
      } else {
        await request(host, "/api/workspaces", {
          method: "POST",
          body: JSON.stringify({ slug: workspaceSlug, name: opts.name ?? workspaceSlug }),
        }, cookie);
        console.log(`${kleur.green("created workspace")} ${workspaceSlug}`);
      }

      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/tokens`, {
        method: "POST",
        body: JSON.stringify({ name: opts.tokenName, role }),
      }, cookie) as { token?: { id: string; token: string } };
      if (!body.token?.token) throw new Error("cloud did not return a token");
      console.log(`${kleur.green("created token")} ${body.token.id}`);
      printMcpConfig(host, workspaceSlug, body.token.token);
      if (opts.tokenTest !== false) {
        await tokenTest(host, workspaceSlug, body.token.token);
        console.log(`${kleur.green("token test: ok")} ${workspaceSlug}`);
      }
    });

  const workspace = cloud.command("workspace").description("Manage hosted workspaces");
  workspace
    .command("create <slug>")
    .description("Create a hosted workspace")
    .option("--name <name>", "workspace display name")
    .action(async (slug: string, opts: { name?: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await request(host, "/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ slug, name: opts.name ?? slug }),
      }, requireCookie(host)) as { workspace?: { slug: string; name: string } };
      console.log(`${kleur.green("created")} ${body.workspace?.slug ?? slug}`);
      printMcpConfig(host, slug);
    });

  const tokens = cloud.command("tokens").description("Manage workspace agent tokens");
  tokens
    .command("list <workspace>")
    .description("List tokens for a workspace")
    .option("--json", "print raw JSON")
    .action(async (workspaceSlug: string, opts: { json?: boolean }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/tokens`, {}, requireCookie(host)) as { tokens?: Array<{ id: string; name: string; role: string; last_used_at?: number | null }> };
      if (opts.json) return printJson(body);
      for (const token of body.tokens ?? []) {
        const used = token.last_used_at ? new Date(token.last_used_at).toISOString() : "never";
        console.log(`${kleur.bold(token.id)} ${token.name} ${kleur.gray(token.role)} ${kleur.gray(`last_used=${used}`)}`);
      }
      if ((body.tokens ?? []).length === 0) console.log(kleur.gray("(no tokens)"));
    });

  tokens
    .command("create <workspace>")
    .description("Create an agent token and print remote MCP config")
    .requiredOption("--name <name>", "token name")
    .option("--role <role>", "owner, manager, agent, or viewer", "agent")
    .action(async (workspaceSlug: string, opts: { name: string; role: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const role = parseRole(opts.role);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/tokens`, {
        method: "POST",
        body: JSON.stringify({ name: opts.name, role }),
      }, requireCookie(host)) as { token?: { id: string; token: string } };
      if (!body.token?.token) throw new Error("cloud did not return a token");
      console.log(`${kleur.green("created token")} ${body.token.id}`);
      printMcpConfig(host, workspaceSlug, body.token.token);
    });

  tokens
    .command("revoke <workspace> <token-id>")
    .description("Revoke an agent token")
    .action(async (workspaceSlug: string, tokenId: string) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/tokens/${encodeURIComponent(tokenId)}`, {
        method: "DELETE",
      }, requireCookie(host));
      console.log(`${kleur.green("revoked")} ${tokenId}`);
    });

  const members = cloud.command("members").description("Manage dashboard users in a hosted workspace");
  members
    .command("list <workspace>")
    .description("List dashboard members for a workspace")
    .option("--json", "print raw JSON")
    .action(async (workspaceSlug: string, opts: { json?: boolean }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`, {}, requireCookie(host)) as { members?: CloudWorkspaceMember[] };
      if (opts.json) return printJson(body);
      for (const member of body.members ?? []) {
        const name = member.name ? ` ${kleur.gray(member.name)}` : "";
        console.log(`${kleur.bold(member.email)} ${kleur.gray(member.role)} ${kleur.gray(member.user_id)}${name}`);
      }
      if ((body.members ?? []).length === 0) console.log(kleur.gray("(no members)"));
    });

  members
    .command("add <workspace>")
    .description("Add or update a dashboard member by email; the user must already have an Agent Bus Cloud account")
    .requiredOption("--email <email>", "member email")
    .option("--role <role>", "owner, manager, agent, or viewer", "viewer")
    .action(async (workspaceSlug: string, opts: { email: string; role: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const role = parseRole(opts.role);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members`, {
        method: "POST",
        body: JSON.stringify({ email: opts.email, role }),
      }, requireCookie(host)) as { member?: CloudWorkspaceMember };
      console.log(`${kleur.green("member saved")} ${body.member?.email ?? opts.email} ${kleur.gray(body.member?.role ?? role)}`);
      if (body.member?.user_id) console.log(`user_id: ${body.member.user_id}`);
    });

  members
    .command("role <workspace> <user-id>")
    .description("Change a dashboard member role")
    .requiredOption("--role <role>", "owner, manager, agent, or viewer")
    .action(async (workspaceSlug: string, userId: string, opts: { role: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const role = parseRole(opts.role);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}`, {
        method: "PATCH",
        body: JSON.stringify({ role }),
      }, requireCookie(host)) as { updated?: boolean };
      console.log(`${body.updated ? kleur.green("updated") : kleur.yellow("not updated")} ${userId} ${kleur.gray(role)}`);
    });

  members
    .command("remove <workspace> <user-id>")
    .description("Remove a dashboard member from a workspace")
    .action(async (workspaceSlug: string, userId: string) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await request(host, `/api/workspaces/${encodeURIComponent(workspaceSlug)}/members/${encodeURIComponent(userId)}`, {
        method: "DELETE",
      }, requireCookie(host)) as { removed?: boolean };
      console.log(`${body.removed ? kleur.green("removed") : kleur.yellow("not removed")} ${userId}`);
    });

  cloud
    .command("mcp-url <workspace>")
    .description("Print the remote MCP URL for a workspace")
    .action((workspaceSlug: string) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      printMcpConfig(host, workspaceSlug);
    });

  cloud
    .command("mcp-config <workspace>")
    .description("Print a generic remote MCP config for a workspace token")
    .requiredOption("--token <token>", "agent bearer token")
    .action((workspaceSlug: string, opts: { token: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      printMcpConfig(host, workspaceSlug, opts.token);
    });

  cloud
    .command("token-test <workspace>")
    .description("Verify a bearer token can reach the workspace remote MCP endpoint")
    .requiredOption("--token <token>", "agent bearer token")
    .action(async (workspaceSlug: string, opts: { token: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const body = await tokenTest(host, workspaceSlug, opts.token);
      printJson(body);
    });
}
