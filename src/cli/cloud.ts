import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

const DEFAULT_HOST = "http://localhost:8787";

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

function parseRole(value: string): WorkspaceRole {
  if (value === "owner" || value === "manager" || value === "agent" || value === "viewer") return value;
  throw new Error("role must be owner, manager, agent, or viewer");
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

  cloud
    .command("mcp-url <workspace>")
    .description("Print the remote MCP URL for a workspace")
    .action((workspaceSlug: string) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      printMcpConfig(host, workspaceSlug);
    });

  cloud
    .command("token-test <workspace>")
    .description("Verify a bearer token can reach the workspace remote MCP endpoint")
    .requiredOption("--token <token>", "agent bearer token")
    .action(async (workspaceSlug: string, opts: { token: string }) => {
      const host = normalizeHost(cloud.opts<CloudOptions>().host);
      const response = await fetch(`${mcpUrl(host, workspaceSlug)}?json=1`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${opts.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ tool: "cloud_workspace", input: {} }),
      });
      const body = await parseResponse(response);
      if (!response.ok) throw new Error(errorMessage(body, "token test failed"));
      printJson(body);
    });
}
