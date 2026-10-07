import type { Env } from "../shared/types";
import { json, readJson } from "../shared/http";
import { callWorkspace } from "./rpc";
import {
  createAgentToken,
  createWorkspace,
  listWorkspaces,
  resolveWorkspaceContext,
} from "../auth/workspaces";
import { cloudToolStatus } from "../mcp/tool-registry";

function requireSlug(params: RegExpMatchArray): string {
  const slug = params.groups?.slug;
  if (!slug) throw new Error("workspace slug is required");
  return slug;
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") {
    return json({ ok: true, service: "agent-bus-cloud", env: env.AGENT_BUS_CLOUD_ENV });
  }

  if (url.pathname === "/api/tools") {
    return json({ tools: cloudToolStatus() });
  }

  if (url.pathname === "/api/workspaces" && request.method === "GET") {
    return json({ workspaces: await listWorkspaces(env) });
  }

  if (url.pathname === "/api/workspaces" && request.method === "POST") {
    const input = await readJson<{ slug?: string; name?: string }>(request);
    if (!input.slug || !/^[a-zA-Z0-9_.-]+$/.test(input.slug)) throw new Error("valid slug is required");
    const workspace = await createWorkspace(env, input.slug, input.name ?? input.slug);
    return json({ workspace }, { status: 201 });
  }

  const tokenMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/tokens$/);
  if (tokenMatch && request.method === "POST") {
    const slug = requireSlug(tokenMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    if (context.role !== "owner" && context.role !== "manager") throw new Error("not allowed");
    const input = await readJson<{ name?: string; role?: "owner" | "manager" | "agent" | "viewer" }>(request);
    const token = await createAgentToken(env, context.id, input.name ?? "agent", input.role ?? "agent");
    return json({ token }, { status: 201 });
  }

  const rpcMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/rpc$/);
  if (rpcMatch && request.method === "POST") {
    const slug = requireSlug(rpcMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const input = await readJson<{ op?: string; input?: unknown }>(request);
    if (!input.op) throw new Error("op is required");
    const result = await callWorkspace(env, context, input.op, input.input ?? {});
    return json({ ok: true, result });
  }

  return json({ error: { code: "NOT_FOUND", message: "api route not found" } }, { status: 404 });
}
