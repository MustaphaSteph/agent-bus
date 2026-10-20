import OAuthProvider, { AuthorizationError, OAuthError } from "@cloudflare/workers-oauth-provider";
import type { Env, WorkspaceContext } from "../shared/types";
import { HttpError, errorResponse, json } from "../shared/http";
import { currentUser } from "./session";
import { getWorkspaceBySlug, listWorkspaces, requireUser } from "./workspaces";
import { handleMcp } from "../mcp/remote";

const SCOPE = "workspace:access";
const LIFETIME = 30 * 24 * 60 * 60;

function escape(value: string): string {
  return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function sameOrigin(request: Request): void {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") {
    throw new HttpError(403, "FORBIDDEN", "Use the Agent Bus connection page.");
  }
}

// D1 is authoritative for revocation and membership, even if a KV token is cached.
async function connectionContext(env: Env, props: unknown): Promise<WorkspaceContext> {
  if (!props || typeof props !== "object" || !("connectionId" in props) || typeof props.connectionId !== "string") {
    throw new HttpError(401, "UNAUTHORIZED", "Invalid connection.");
  }
  const row = await env.AGENT_BUS_CLOUD_DB.prepare(`
    SELECT c.id, c.workspace_id, c.role, w.slug, m.role AS member_role
    FROM oauth_connections c JOIN workspaces w ON w.id = c.workspace_id
    JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = c.user_id
    WHERE c.id = ? AND c.revoked_at IS NULL AND c.expires_at > ?
  `).bind(props.connectionId, Date.now()).first<{
    id: string; workspace_id: string; role: "agent" | "viewer"; slug: string; member_role: string;
  }>();
  if (!row) throw new HttpError(401, "UNAUTHORIZED", "Connection expired or access was removed. Reconnect the app.");
  const role = row.role === "viewer" || row.member_role === "viewer" ? "viewer" : "agent";
  return { id: row.workspace_id, slug: row.slug, role, principal: { kind: "oauth", id: row.id, workspaceId: row.workspace_id, role } };
}

async function interactive(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const helpers = env.OAUTH_PROVIDER;
  if (!helpers) throw new Error("OAuth provider unavailable");
  if (url.pathname === "/oauth/authorize" && request.method === "GET") {
    const auth = await helpers.parseAuthRequest(request);
    if (auth.codeChallengeMethod !== "S256" || !auth.codeChallenge) throw new HttpError(400, "INVALID_REQUEST", "PKCE S256 is required.");
    if (auth.scope.some(scope => ![SCOPE, "offline_access"].includes(scope))) throw new HttpError(400, "INVALID_SCOPE", "Unsupported permission.");
    const user = await currentUser(env, request);
    if (!user) return Response.redirect(`${url.origin}/app?returnTo=${encodeURIComponent(url.pathname + url.search)}`, 302);
    const details = await helpers.describeConsent(auth);
    const redirectOrigin = new URL(details.redirectUri).origin;
    if (!/^https?:\/\/[a-z0-9.[\]:-]+$/i.test(redirectOrigin)) throw new HttpError(400, "INVALID_REQUEST", "Unsupported return address.");
    const transaction = await helpers.beginConsent(auth);
    const workspaces = await listWorkspaces(env, user.id);
    const headers = transaction.headers;
    headers.set("content-type", "text/html; charset=utf-8");
    headers.set("cache-control", "no-store");
    headers.set("referrer-policy", "same-origin");
    // Chromium applies form-action to the post-consent redirect as well as the POST.
    headers.set("content-security-policy", `default-src 'none'; style-src 'unsafe-inline'; form-action 'self' ${redirectOrigin}; frame-ancestors 'none'; base-uri 'none'`);
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connect an app | Agent Bus</title>
      <style>body{margin:0;background:#080b0e;color:#f4f6f8;font:16px/1.6 system-ui}main{max-width:520px;margin:8vh auto;padding:24px}h1{font-size:30px;overflow-wrap:anywhere}label{display:block;margin:20px 0}select,button{font:inherit;padding:12px;border-radius:6px}select{display:block;width:100%;margin-top:8px}button{cursor:pointer;border:0;margin:12px 8px 0 0;background:#00c8ec;color:#071016}button[value=deny]{background:#282e34;color:white}small,p{color:#b5c0ca}strong,code{overflow-wrap:anywhere}a{color:#00c8ec}</style>
      <main><a href="/">Agent Bus</a><h1>Connect ${escape(details.clientName)}</h1>
      <p>Signed in as <strong>${escape(user.email)}</strong>.</p>
      <p>${details.clientDomain ? `Published identity: <strong>${escape(details.clientDomain)}</strong>.` : "This app's name is supplied by its developer, not verified by Agent Bus."}
      Return address: <strong>${escape(details.redirectHost)}</strong>.</p>
      ${details.redirectIsLoopback ? "<p>A local app will receive this connection. Any local process could be listening.</p>" : ""}
      <form method="post" action="/oauth/authorize"><input type="hidden" name="handle" value="${escape(transaction.handle)}"><input type="hidden" name="user" value="${escape(user.id)}">
      <label>Workspace<select name="workspace" required>${workspaces.map(w => `<option value="${escape(w.slug)}">${escape(w.name)}</option>`).join("")}</select></label>
      <label>Permission<select name="role"><option value="viewer">Read only</option><option value="agent">Read and collaborate</option></select></label>
      <p>Read only shares workspace conversations, tasks and memories. Collaborate also allows sending messages, registering agents, and updating tasks and memories. Neither permission manages members or tokens.</p>
      <p>The connection lasts up to 30 days. You can disconnect it at any time in Connect agents.</p>
      ${workspaces.length ? '<button name="decision" value="allow">Allow connection</button>' : '<p><a href="/app#new-workspace">Create a workspace</a>, then restart this connection.</p>'}
      <button name="decision" value="deny" formnovalidate>Cancel</button></form></main></html>`, { headers });
  }
  if (url.pathname === "/oauth/authorize" && request.method === "POST") {
    sameOrigin(request);
    const user = await requireUser(env, request);
    const form = await request.formData();
    if (form.get("user") !== user.id) throw new HttpError(403, "FORBIDDEN", "Account changed. Restart the connection.");
    const handle = String(form.get("handle") ?? "");
    if (form.get("decision") === "deny") {
      const denied = await helpers.denyConsent(request, handle);
      return new Response(null, { status: 303, headers: denied.headers });
    }
    if (form.get("decision") !== "allow") throw new HttpError(400, "BAD_REQUEST", "Choose allow or cancel.");
    const workspace = await getWorkspaceBySlug(env, String(form.get("workspace") ?? ""), user.id);
    if (!workspace) throw new HttpError(403, "FORBIDDEN", "Workspace is not accessible.");
    const requestedRole = form.get("role");
    if (requestedRole !== "agent" && requestedRole !== "viewer") throw new HttpError(400, "BAD_REQUEST", "Invalid permission.");
    if (requestedRole === "agent" && workspace.role === "viewer") throw new HttpError(403, "FORBIDDEN", "Your workspace membership is read only.");
    const approved = await helpers.approveConsent(request, handle, { scope: [SCOPE, "offline_access"] });
    const details = await helpers.describeConsent(approved.request);
    const id = crypto.randomUUID();
    await env.AGENT_BUS_CLOUD_DB.prepare("INSERT INTO oauth_connections (id,user_id,workspace_id,client_id,client_name,role,created_at,expires_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, user.id, workspace.id, approved.request.clientId, details.clientName, requestedRole, Date.now(), Date.now() + LIFETIME * 1000).run();
    try {
      const completed = await helpers.completeAuthorization({ request: approved.request, userId: user.id, scope: [SCOPE, "offline_access"], metadata: { connectionId: id }, props: { connectionId: id }, revokeExistingGrants: false });
      approved.headers.set("location", completed.redirectTo);
      approved.headers.set("cache-control", "no-store");
      return new Response(null, { status: 303, headers: approved.headers });
    } catch (error) {
      await env.AGENT_BUS_CLOUD_DB.prepare("DELETE FROM oauth_connections WHERE id = ?").bind(id).run();
      throw error;
    }
  }
  if (url.pathname === "/api/connections" && request.method === "GET") {
    const user = await requireUser(env, request);
    const workspace = await getWorkspaceBySlug(env, url.searchParams.get("workspace") ?? "", user.id);
    if (!workspace) throw new HttpError(403, "FORBIDDEN", "Workspace is not accessible.");
    const rows = await env.AGENT_BUS_CLOUD_DB.prepare("SELECT id,client_name,role,created_at,expires_at FROM oauth_connections WHERE user_id=? AND workspace_id=? AND revoked_at IS NULL AND expires_at > ? ORDER BY created_at DESC")
      .bind(user.id, workspace.id, Date.now()).all();
    return json({ connections: rows.results }, { headers: { "cache-control": "no-store" } });
  }
  const revoke = url.pathname.match(/^\/api\/connections\/([a-f0-9-]+)$/);
  if (revoke && request.method === "DELETE") {
    sameOrigin(request);
    const user = await requireUser(env, request);
    await env.AGENT_BUS_CLOUD_DB.prepare("UPDATE oauth_connections SET revoked_at=? WHERE id=? AND user_id=?").bind(Date.now(), revoke[1], user.id).run();
    return json({ ok: true });
  }
  return json({ error: "not_found" }, { status: 404 });
}

export function isOAuthRoute(path: string): boolean {
  return path === "/mcp" || path.startsWith("/oauth/") || path.startsWith("/.well-known/") || path === "/api/connections" || path.startsWith("/api/connections/");
}

export async function handleOAuth(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const origin = new URL(request.url).origin;
  const provider = new OAuthProvider<Env>({
    apiRoute: "/mcp",
    apiHandler: { async fetch(req, bindings, execution) {
      try {
        const auth = "auth" in execution ? execution.auth : null;
        if (!auth || typeof auth !== "object" || !("scope" in auth) || !Array.isArray(auth.scope) || !auth.scope.includes(SCOPE)) {
          return json({ error: "insufficient_scope" }, { status: 403, headers: { "www-authenticate": `Bearer error="insufficient_scope", scope="${SCOPE}"` } });
        }
        const context = await connectionContext(bindings, execution.props);
        return await handleMcp(req, bindings, context.slug, execution, context);
      } catch (error) {
        const response = errorResponse(error);
        if (response.status === 401) response.headers.set("www-authenticate", `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`);
        return response;
      }
    } },
    defaultHandler: { async fetch(req, bindings) {
      try { return await interactive(req, bindings); } catch (error) {
        if (error instanceof AuthorizationError) return json({ error: "invalid_request", error_description: error.message }, { status: 400, headers: { "cache-control": "no-store" } });
        return errorResponse(error);
      }
    } },
    authorizeEndpoint: "/oauth/authorize", tokenEndpoint: "/oauth/token", clientRegistrationEndpoint: "/oauth/register",
    resourceMetadata: { resource: `${origin}/mcp`, resource_name: "Agent Bus Cloud" },
    scopesSupported: [SCOPE, "offline_access"], requiredScopes: [SCOPE],
    accessTokenTTL: 900, refreshTokenTTL: LIFETIME,
    clientIdMetadataDocumentEnabled: true,
    async tokenExchangeCallback(options) {
      try { await connectionContext(options.env, options.props); }
      catch (error) {
        if (error instanceof HttpError && error.status === 401) throw new OAuthError("invalid_grant", { description: "Connection expired or access was removed." });
        throw new OAuthError("temporarily_unavailable", { description: "Unable to verify workspace access. Try again shortly.", statusCode: 503 });
      }
    },
  });
  return provider.fetch(request, env, ctx);
}
