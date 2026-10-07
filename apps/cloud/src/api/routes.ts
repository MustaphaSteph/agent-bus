import type { Env } from "../shared/types";
import { json, readJson } from "../shared/http";
import { callWorkspace } from "./rpc";
import {
  createAgentToken,
  createUser,
  createWorkspace,
  listWorkspaces,
  requireUser,
  resolveWorkspaceContext,
  verifyUserLogin,
} from "../auth/workspaces";
import { cloudToolStatus } from "../mcp/tool-registry";
import { clearSessionCookie, createSessionCookie, currentUser } from "../auth/session";

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

  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    return json({ user: await currentUser(env, request) });
  }

  if (url.pathname === "/api/auth/signup" && request.method === "POST") {
    const input = await readJson<{ email?: string; password?: string; name?: string }>(request);
    const user = await createUser(env, input.email ?? "", input.password ?? "", input.name);
    return json({ user }, { status: 201, headers: { "set-cookie": await createSessionCookie(env, user.id) } });
  }

  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    const input = await readJson<{ email?: string; password?: string }>(request);
    const user = await verifyUserLogin(env, input.email ?? "", input.password ?? "");
    return json({ user }, { headers: { "set-cookie": await createSessionCookie(env, user.id) } });
  }

  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, { headers: { "set-cookie": clearSessionCookie() } });
  }

  if (url.pathname === "/api/workspaces" && request.method === "GET") {
    const user = await requireUser(env, request);
    return json({ workspaces: await listWorkspaces(env, user.id) });
  }

  if (url.pathname === "/api/workspaces" && request.method === "POST") {
    const user = await requireUser(env, request);
    const input = await readJson<{ slug?: string; name?: string }>(request);
    if (!input.slug || !/^[a-zA-Z0-9_.-]+$/.test(input.slug)) throw new Error("valid slug is required");
    const workspace = await createWorkspace(env, user.id, input.slug, input.name ?? input.slug);
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

  const cockpitMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/cockpit$/);
  if (cockpitMatch && request.method === "GET") {
    const slug = requireSlug(cockpitMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const team = url.searchParams.get("team") ?? undefined;
    const project = url.searchParams.get("project") ?? undefined;
    const area = url.searchParams.get("area") ?? undefined;
    const result = await callWorkspace(env, context, "cockpit", { team, project, area });
    return json({ ok: true, result });
  }

  const activityMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/activity$/);
  if (activityMatch && request.method === "GET") {
    const slug = requireSlug(activityMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const team = url.searchParams.get("team") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const result = await callWorkspace(env, context, "activity", { team, limit });
    return json({ ok: true, result });
  }

  const threadMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/threads\/(?<threadId>[^/]+)$/);
  if (threadMatch && request.method === "GET") {
    const slug = requireSlug(threadMatch);
    const threadId = threadMatch.groups?.threadId;
    if (!threadId) throw new Error("thread id is required");
    const context = await resolveWorkspaceContext(env, request, slug);
    const result = await callWorkspace(env, context, "thread", { thread_id: threadId });
    return json({ ok: true, result });
  }

  return json({ error: { code: "NOT_FOUND", message: "api route not found" } }, { status: 404 });
}
