import type { Env, Principal, WorkspaceContext, WorkspaceRole } from "../shared/types";
import { newId, now, sha256Hex } from "../shared/ids";
import { currentUser, hashPassword, verifyPassword, type AuthUser } from "./session";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  role?: WorkspaceRole;
}

export async function ensureDevUser(env: Env): Promise<string> {
  const id = "dev_user";
  const at = now();
  await env.AGENT_BUS_CLOUD_DB.prepare(
    `INSERT INTO users (id, email, name, password_hash, created_at, updated_at)
     VALUES (?, 'dev@agentbus.cloud', 'Local Dev', NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  ).bind(id, at, at).run();
  return id;
}

export async function createUser(env: Env, email: string, password: string, name?: string): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("valid email is required");
  const id = newId("usr");
  const at = now();
  const passwordHash = await hashPassword(password);
  await env.AGENT_BUS_CLOUD_DB.prepare(
    "INSERT INTO users (id, email, name, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, normalizedEmail, name ?? null, passwordHash, at, at).run();
  return { id, email: normalizedEmail, name: name ?? null };
}

export async function verifyUserLogin(env: Env, email: string, password: string): Promise<AuthUser> {
  const normalizedEmail = email.trim().toLowerCase();
  const row = await env.AGENT_BUS_CLOUD_DB.prepare(
    "SELECT id, email, name, password_hash FROM users WHERE email = ?",
  ).bind(normalizedEmail).first<AuthUser & { password_hash: string | null }>();
  if (!row || !(await verifyPassword(password, row.password_hash))) throw new Error("invalid email or password");
  return { id: row.id, email: row.email, name: row.name };
}

export async function requireUser(env: Env, request: Request): Promise<AuthUser> {
  const user = await currentUser(env, request);
  if (!user) throw new Error("login required");
  return user;
}

export async function createWorkspace(env: Env, userId: string, slug: string, name: string): Promise<WorkspaceRow> {
  const id = newId("ws");
  const at = now();
  await env.AGENT_BUS_CLOUD_DB.batch([
    env.AGENT_BUS_CLOUD_DB.prepare(
      "INSERT INTO workspaces (id, slug, name, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).bind(id, slug, name, userId, at, at),
    env.AGENT_BUS_CLOUD_DB.prepare(
      "INSERT INTO memberships (workspace_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)",
    ).bind(id, userId, at),
  ]);
  return { id, slug, name, role: "owner" };
}

export async function listWorkspaces(env: Env, userId: string): Promise<WorkspaceRow[]> {
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT w.id, w.slug, w.name, m.role
     FROM workspaces w
     JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = ?
     ORDER BY w.created_at DESC`,
  ).bind(userId).all<WorkspaceRow>();
  return result.results ?? [];
}

export async function getWorkspaceBySlug(env: Env, slug: string, userId?: string): Promise<WorkspaceRow | null> {
  if (!userId) {
    const row = await env.AGENT_BUS_CLOUD_DB.prepare(
      "SELECT id, slug, name FROM workspaces WHERE slug = ?",
    ).bind(slug).first<WorkspaceRow>();
    return row ?? null;
  }
  const row = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT w.id, w.slug, w.name, m.role
     FROM workspaces w
     JOIN memberships m ON m.workspace_id = w.id
     WHERE w.slug = ? AND m.user_id = ?`,
  ).bind(slug, userId).first<WorkspaceRow>();
  return row ?? null;
}

export async function createAgentToken(env: Env, workspaceId: string, name: string, role: WorkspaceRole): Promise<{ token: string; id: string }> {
  const token = `ab_cloud_${crypto.randomUUID().replaceAll("-", "")}`;
  const id = newId("tok");
  const hash = await sha256Hex(token);
  await env.AGENT_BUS_CLOUD_DB.prepare(
    "INSERT INTO agent_tokens (id, workspace_id, name, token_hash, role, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(id, workspaceId, name, hash, role, now()).run();
  return { token, id };
}

export async function resolveWorkspaceContext(env: Env, request: Request, slug: string): Promise<WorkspaceContext> {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const workspace = await getWorkspaceBySlug(env, slug);
    if (!workspace) throw new Error(`workspace ${slug} not found`);
    const token = auth.slice("Bearer ".length);
    const hash = await sha256Hex(token);
    const row = await env.AGENT_BUS_CLOUD_DB.prepare(
      "SELECT id, workspace_id, role FROM agent_tokens WHERE token_hash = ?",
    ).bind(hash).first<{ id: string; workspace_id: string; role: WorkspaceRole }>();
    if (!row || row.workspace_id !== workspace.id) throw new Error("invalid workspace token");
    const principal: Principal = { kind: "agent_token", id: row.id, workspaceId: row.workspace_id, role: row.role };
    await env.AGENT_BUS_CLOUD_DB.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?").bind(now(), row.id).run();
    return {
      id: workspace.id,
      slug: workspace.slug,
      role: principal.role,
      principal,
    };
  }

  const user = await requireUser(env, request);
  const workspace = await getWorkspaceBySlug(env, slug, user.id);
  if (!workspace) throw new Error(`workspace ${slug} not found or not accessible`);
  const principal: Principal = { kind: "user", id: user.id, role: workspace.role ?? "viewer", workspaceId: workspace.id };
  return {
    id: workspace.id,
    slug: workspace.slug,
    role: principal.role,
    principal,
  };
}
