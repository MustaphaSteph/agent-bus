import type { Env, Principal, WorkspaceContext, WorkspaceRole } from "../shared/types";
import { newId, now, sha256Hex } from "../shared/ids";
import { currentUser, hashPassword, verifyPassword, type AuthUser } from "./session";

interface WorkspaceRow {
  id: string;
  slug: string;
  name: string;
  role?: WorkspaceRole;
}

export interface AgentTokenRow {
  id: string;
  name: string;
  role: WorkspaceRole;
  created_at: number;
  last_used_at: number | null;
}

export interface WorkspaceMemberRow {
  user_id: string;
  email: string;
  name: string | null;
  role: WorkspaceRole;
  created_at: number;
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
  const existing = await env.AGENT_BUS_CLOUD_DB.prepare("SELECT id FROM users WHERE email = ?").bind(normalizedEmail).first<{ id: string }>();
  if (existing) throw new Error("email is already registered");
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
  const existing = await getWorkspaceBySlug(env, slug);
  if (existing) throw new Error(`workspace ${slug} already exists`);
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

export async function listAgentTokens(env: Env, workspaceId: string): Promise<AgentTokenRow[]> {
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT id, name, role, created_at, last_used_at
     FROM agent_tokens
     WHERE workspace_id = ?
     ORDER BY created_at DESC`,
  ).bind(workspaceId).all<AgentTokenRow>();
  return result.results ?? [];
}

export async function listWorkspaceMembers(env: Env, workspaceId: string): Promise<WorkspaceMemberRow[]> {
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT u.id AS user_id, u.email, u.name, m.role, m.created_at
     FROM memberships m
     JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ?
     ORDER BY
       CASE m.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 WHEN 'agent' THEN 2 ELSE 3 END,
       u.email ASC`,
  ).bind(workspaceId).all<WorkspaceMemberRow>();
  return result.results ?? [];
}

export async function addWorkspaceMember(env: Env, workspaceId: string, email: string, role: WorkspaceRole): Promise<WorkspaceMemberRow> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) throw new Error("valid member email is required");
  const user = await env.AGENT_BUS_CLOUD_DB.prepare(
    "SELECT id, email, name FROM users WHERE email = ?",
  ).bind(normalizedEmail).first<{ id: string; email: string; name: string | null }>();
  if (!user) throw new Error("member must create an Agent Bus Cloud account before being added");
  const at = now();
  await env.AGENT_BUS_CLOUD_DB.prepare(
    `INSERT INTO memberships (workspace_id, user_id, role, created_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(workspace_id, user_id) DO UPDATE SET role = excluded.role`,
  ).bind(workspaceId, user.id, role, at).run();
  return { user_id: user.id, email: user.email, name: user.name, role, created_at: at };
}

export async function updateWorkspaceMemberRole(env: Env, workspaceId: string, userId: string, role: WorkspaceRole): Promise<{ updated: boolean }> {
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    "UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?",
  ).bind(role, workspaceId, userId).run();
  return { updated: (result.meta?.changes ?? 0) > 0 };
}

export async function removeWorkspaceMember(env: Env, workspaceId: string, userId: string): Promise<{ removed: boolean }> {
  const ownerCount = await env.AGENT_BUS_CLOUD_DB.prepare(
    "SELECT COUNT(*) AS count FROM memberships WHERE workspace_id = ? AND role = 'owner'",
  ).bind(workspaceId).first<{ count: number }>();
  const target = await env.AGENT_BUS_CLOUD_DB.prepare(
    "SELECT role FROM memberships WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, userId).first<{ role: WorkspaceRole }>();
  if (target?.role === "owner" && (ownerCount?.count ?? 0) <= 1) throw new Error("cannot remove the last workspace owner");
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    "DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?",
  ).bind(workspaceId, userId).run();
  return { removed: (result.meta?.changes ?? 0) > 0 };
}

export async function revokeAgentToken(env: Env, workspaceId: string, tokenId: string): Promise<{ revoked: boolean }> {
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    "DELETE FROM agent_tokens WHERE workspace_id = ? AND id = ?",
  ).bind(workspaceId, tokenId).run();
  return { revoked: (result.meta?.changes ?? 0) > 0 };
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
