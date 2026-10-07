import type { Env, Principal, WorkspaceContext, WorkspaceRole } from "../shared/types";
import { newId, now, sha256Hex } from "../shared/ids";

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
    `INSERT INTO users (id, email, name, created_at, updated_at)
     VALUES (?, 'dev@agentbus.cloud', 'Local Dev', ?, ?)
     ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at`,
  ).bind(id, at, at).run();
  return id;
}

export async function createWorkspace(env: Env, slug: string, name: string): Promise<WorkspaceRow> {
  const userId = await ensureDevUser(env);
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

export async function listWorkspaces(env: Env): Promise<WorkspaceRow[]> {
  await ensureDevUser(env);
  const result = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT w.id, w.slug, w.name, m.role
     FROM workspaces w
     JOIN memberships m ON m.workspace_id = w.id
     WHERE m.user_id = 'dev_user'
     ORDER BY w.created_at DESC`,
  ).all<WorkspaceRow>();
  return result.results ?? [];
}

export async function getWorkspaceBySlug(env: Env, slug: string): Promise<WorkspaceRow | null> {
  const row = await env.AGENT_BUS_CLOUD_DB.prepare(
    `SELECT w.id, w.slug, w.name, m.role
     FROM workspaces w
     LEFT JOIN memberships m ON m.workspace_id = w.id AND m.user_id = 'dev_user'
     WHERE w.slug = ?`,
  ).bind(slug).first<WorkspaceRow>();
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
  const workspace = await getWorkspaceBySlug(env, slug);
  if (!workspace) throw new Error(`workspace ${slug} not found`);
  const auth = request.headers.get("authorization");
  let principal: Principal = { kind: "user", id: "dev_user", role: workspace.role ?? "owner", workspaceId: workspace.id };
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length);
    const hash = await sha256Hex(token);
    const row = await env.AGENT_BUS_CLOUD_DB.prepare(
      "SELECT id, workspace_id, role FROM agent_tokens WHERE token_hash = ?",
    ).bind(hash).first<{ id: string; workspace_id: string; role: WorkspaceRole }>();
    if (!row || row.workspace_id !== workspace.id) throw new Error("invalid workspace token");
    principal = { kind: "agent_token", id: row.id, workspaceId: row.workspace_id, role: row.role };
    await env.AGENT_BUS_CLOUD_DB.prepare("UPDATE agent_tokens SET last_used_at = ? WHERE id = ?").bind(now(), row.id).run();
  }
  return {
    id: workspace.id,
    slug: workspace.slug,
    role: principal.role,
    principal,
  };
}
