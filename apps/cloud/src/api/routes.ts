import type { Env } from "../shared/types";
import { HttpError, json, readJson } from "../shared/http";
import { callWorkspace } from "./rpc";
import {
  addWorkspaceMember,
  createAgentToken,
  createUser,
  createWorkspace,
  listWorkspaces,
  listAgentTokens,
  listWorkspaceMembers,
  removeWorkspaceMember,
  requireUser,
  resolveWorkspaceContext,
  revokeAgentToken,
  updateWorkspaceMemberRole,
  verifyUserLogin,
} from "../auth/workspaces";
import { cloudToolStatus } from "../mcp/tool-registry";
import { clearSessionCookie, createSessionCookie, currentUser } from "../auth/session";

function requireSlug(params: RegExpMatchArray): string {
  const slug = params.groups?.slug;
  if (!slug) throw new Error("workspace slug is required");
  return slug;
}

function isOwner(role: string): boolean {
  return role === "owner";
}

function canViewWorkspaceAdmin(role: string): boolean {
  return role === "owner" || role === "manager" || role === "viewer";
}

function parseRole(role: unknown): "owner" | "manager" | "agent" | "viewer" {
  if (role === "owner" || role === "manager" || role === "agent" || role === "viewer") return role;
  throw new Error("valid role is required");
}

export async function handleApi(request: Request, env: Env, url: URL): Promise<Response> {
  if (url.pathname === "/api/health") {
    const tools = cloudToolStatus();
    const implemented = tools.filter((tool) => tool.implemented).length;
    let d1 = { ok: false, error: "not checked" };
    try {
      await env.AGENT_BUS_CLOUD_DB.prepare("SELECT 1").first();
      d1 = { ok: true, error: "" };
    } catch (error) {
      d1 = { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
    return json({
      ok: d1.ok && implemented === tools.length && tools.length > 0,
      service: "agent-bus-cloud",
      env: env.AGENT_BUS_CLOUD_ENV,
      d1,
      tools: {
        total: tools.length,
        implemented,
        missing: tools.filter((tool) => !tool.implemented).map((tool) => tool.name),
      },
    });
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
  if (tokenMatch && request.method === "GET") {
    const slug = requireSlug(tokenMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    if (!canViewWorkspaceAdmin(context.role)) throw new Error("not allowed");
    return json({ tokens: await listAgentTokens(env, context.id) });
  }

  if (tokenMatch && request.method === "POST") {
    const slug = requireSlug(tokenMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    if (context.role !== "owner" && context.role !== "manager") throw new Error("not allowed");
    const input = await readJson<{ name?: string; role?: "owner" | "manager" | "agent" | "viewer" }>(request);
    const token = await createAgentToken(env, context.id, input.name ?? "agent", input.role ? parseRole(input.role) : "agent");
    return json({ token }, { status: 201 });
  }

  const tokenDeleteMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/tokens\/(?<tokenId>[^/]+)$/);
  if (tokenDeleteMatch && request.method === "DELETE") {
    const slug = requireSlug(tokenDeleteMatch);
    const tokenId = tokenDeleteMatch.groups?.tokenId;
    if (!tokenId) throw new Error("token id is required");
    const context = await resolveWorkspaceContext(env, request, slug);
    if (context.role !== "owner" && context.role !== "manager") throw new Error("not allowed");
    return json(await revokeAgentToken(env, context.id, tokenId));
  }

  const membersMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/members$/);
  if (membersMatch && request.method === "GET") {
    const slug = requireSlug(membersMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    if (!canViewWorkspaceAdmin(context.role)) throw new Error("not allowed");
    return json({ members: await listWorkspaceMembers(env, context.id) });
  }

  if (membersMatch && request.method === "POST") {
    const slug = requireSlug(membersMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    if (!isOwner(context.role)) throw new Error("only workspace owners can add members");
    const input = await readJson<{ email?: string; role?: "owner" | "manager" | "agent" | "viewer" }>(request);
    const member = await addWorkspaceMember(env, context.id, input.email ?? "", parseRole(input.role ?? "viewer"));
    return json({ member }, { status: 201 });
  }

  const memberMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/members\/(?<userId>[^/]+)$/);
  if (memberMatch && request.method === "PATCH") {
    const slug = requireSlug(memberMatch);
    const userId = memberMatch.groups?.userId;
    if (!userId) throw new Error("member user id is required");
    const context = await resolveWorkspaceContext(env, request, slug);
    if (!isOwner(context.role)) throw new Error("only workspace owners can update members");
    const input = await readJson<{ role?: "owner" | "manager" | "agent" | "viewer" }>(request);
    return json(await updateWorkspaceMemberRole(env, context.id, userId, parseRole(input.role)));
  }

  if (memberMatch && request.method === "DELETE") {
    const slug = requireSlug(memberMatch);
    const userId = memberMatch.groups?.userId;
    if (!userId) throw new Error("member user id is required");
    const context = await resolveWorkspaceContext(env, request, slug);
    if (!isOwner(context.role)) throw new Error("only workspace owners can remove members");
    return json(await removeWorkspaceMember(env, context.id, userId));
  }

  const rpcMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/rpc$/);
  if (rpcMatch && request.method === "POST") {
    const slug = requireSlug(rpcMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const input = await readJson<{ op?: string; input?: unknown }>(request);
    if (!input.op) throw new Error("op is required");
    if (input.op === "human_chat_post") throw new HttpError(403, "FORBIDDEN", "Use the workspace chat to send a human message.");
    const result = await callWorkspace(env, context, input.op, input.input ?? {});
    return json({ ok: true, result });
  }

  const chatMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/chat$/);
  if (chatMatch && (request.method === "GET" || request.method === "POST")) {
    const context = await resolveWorkspaceContext(env, request, requireSlug(chatMatch));
    if (request.method === "GET") {
      const result = await callWorkspace(env, context, "human_chat_view", {
        team: url.searchParams.get("team") || undefined,
        project: url.searchParams.get("project") || null,
        area: url.searchParams.get("area") || null,
      });
      return json({ ok: true, result });
    }
    if (context.principal.kind !== "user") throw new HttpError(403, "FORBIDDEN", "Sign in to send a human message.");
    if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") {
      throw new HttpError(403, "FORBIDDEN", "Send messages from this workspace page.");
    }
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(400, "BAD_REQUEST", "Expected a chat message.");
    const text = await request.text();
    if (text.length > 20000) throw new HttpError(413, "TOO_LARGE", "Message is too large.");
    let input: unknown;
    try { input = JSON.parse(text); } catch { throw new HttpError(400, "BAD_REQUEST", "Invalid chat message."); }
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new HttpError(400, "BAD_REQUEST", "Invalid chat message.");
    return json({ ok: true, result: await callWorkspace(env, context, "human_chat_post", input) }, { status: 201 });
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

  const scopesMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/scopes$/);
  if (scopesMatch && request.method === "GET") {
    const slug = requireSlug(scopesMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const result = await callWorkspace(env, context, "scopes", {});
    return json({ ok: true, result });
  }

  const messagesMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/messages$/);
  if (messagesMatch && request.method === "GET") {
    const slug = requireSlug(messagesMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const team = url.searchParams.get("team") ?? undefined;
    const project = url.searchParams.get("project") ?? undefined;
    const area = url.searchParams.get("area") ?? undefined;
    const before_id = url.searchParams.get("before_id") ? Number(url.searchParams.get("before_id")) : undefined;
    const limit = Number(url.searchParams.get("limit") ?? 50);
    const result = await callWorkspace(env, context, "message_page", { team, project, area, before_id, limit });
    return json({ ok: true, result });
  }

  const metricsMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/metrics$/);
  if (metricsMatch && request.method === "GET") {
    const slug = requireSlug(metricsMatch);
    const context = await resolveWorkspaceContext(env, request, slug);
    const team = url.searchParams.get("team") ?? undefined;
    const hours = Number(url.searchParams.get("hours") ?? 24);
    const result = await callWorkspace(env, context, "timeseries", { team, hours });
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

  const messageThreadMatch = url.pathname.match(/^\/api\/workspaces\/(?<slug>[^/]+)\/messages\/(?<messageId>\\d+)\/thread$/);
  if (messageThreadMatch && request.method === "GET") {
    const slug = requireSlug(messageThreadMatch);
    const messageId = Number(messageThreadMatch.groups?.messageId);
    const context = await resolveWorkspaceContext(env, request, slug);
    const result = await callWorkspace(env, context, "message_thread", { message_id: messageId });
    return json({ ok: true, result });
  }

  return json({ error: { code: "NOT_FOUND", message: "api route not found" } }, { status: 404 });
}
