import { z } from "zod";
import type { Env, WorkspaceContext } from "../shared/types";
import { validateWebhookUrl } from "./webhooks";
import { scheduleDeliveryAlarm } from "./delivery-alarm";

const NAME = "inbox.message_available";
const scope = z.object({ agent: z.string().regex(/^[a-zA-Z0-9_.-]{1,64}$/), project: z.string().min(1).max(128).optional(), team: z.string().min(1).max(128).optional() }).strict();
export const eventParams = z.object({ name: z.literal(NAME), arguments: scope,
  delivery: z.object({ mode: z.literal("webhook"), url: z.string().max(2048), secret: z.string().max(128).optional() }).strict(),
  cursor: z.null().optional(), ttlMs: z.number().int().positive().nullable().optional(),
}).strict();
type Subscription = { id: string; workspace_id: string; owner_kind: string; owner_id: string; agent: string; project: string | null; team: string | null; url: string; secret: string; previous_secret: string | null; rotation_until: number | null; expires_at: number; verified_at: number };
type Delivery = { id: string; subscription_id: string; message_id: number; created_at: number; attempts: number };

export function eventCatalog() {
  return { events: [{ name: NAME, description: "A new message is queued for a registered Agent Bus agent. Fetch its inbox, handle the message, then acknowledge its receipt. This notification alone does not consume the message.", delivery: ["webhook"],
    inputSchema: z.toJSONSchema(scope), payloadSchema: { type: "object", properties: {
      agent: { type: "string" }, message_id: { type: "integer" }, workspace_id: { type: "string" },
    }, required: ["agent", "message_id", "workspace_id"], additionalProperties: false },
  }] };
}

function signingKey(secret: string): Uint8Array {
  if (!/^whsec_[A-Za-z0-9+/]+={0,2}$/.test(secret)) throw new Error("Invalid webhook signing secret");
  let raw: string;
  try { raw = atob(secret.slice(6)); } catch { throw new Error("Invalid webhook signing secret"); }
  if (raw.length < 24 || raw.length > 64 || btoa(raw) !== secret.slice(6)) throw new Error("Invalid webhook signing secret");
  return Uint8Array.from(raw, c => c.charCodeAt(0));
}

export async function eventHeaders(subscription: Pick<Subscription, "id" | "secret" | "previous_secret" | "rotation_until">, id: string, body: string): Promise<Record<string, string>> {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const sign = async (secret: string) => {
    const key = await crypto.subtle.importKey("raw", signingKey(secret).slice().buffer, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const value = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`));
    return "v1," + btoa(String.fromCharCode(...new Uint8Array(value)));
  };
  let signature = await sign(subscription.secret);
  if (subscription.previous_secret && (subscription.rotation_until ?? 0) > Date.now()) signature += " " + await sign(subscription.previous_secret);
  return { "Content-Type": "application/json", "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": signature, "X-MCP-Subscription-Id": subscription.id };
}

// Recheck authoritative membership/token/connection state, not a cached role.
export async function eventAccess(env: Env, sub: Pick<Subscription, "workspace_id" | "owner_kind" | "owner_id">): Promise<boolean> {
  let query: string;
  if (sub.owner_kind === "agent_token") query = "SELECT id FROM agent_tokens WHERE workspace_id = ? AND id = ? AND role <> 'viewer'";
  else if (sub.owner_kind === "user") query = "SELECT user_id FROM memberships WHERE workspace_id = ? AND user_id = ? AND role <> 'viewer'";
  else if (sub.owner_kind === "oauth") {
    return Boolean(await env.AGENT_BUS_CLOUD_DB.prepare(`SELECT c.id FROM oauth_connections c
      JOIN memberships m ON m.workspace_id = c.workspace_id AND m.user_id = c.user_id
      WHERE c.workspace_id = ? AND c.id = ? AND c.revoked_at IS NULL AND c.expires_at > ? AND c.role <> 'viewer' AND m.role <> 'viewer'`)
      .bind(sub.workspace_id, sub.owner_id, Date.now()).first());
  } else return false;
  return Boolean(await env.AGENT_BUS_CLOUD_DB.prepare(query).bind(sub.workspace_id, sub.owner_id).first());
}

async function subscriptionId(context: WorkspaceContext, url: string, args: z.infer<typeof scope>): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify([context.id, context.principal.kind, context.principal.id, NAME, url, args.agent, args.project ?? null, args.team ?? null]));
  return "sub_" + Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), b => b.toString(16).padStart(2, "0")).join("");
}

async function verify(sub: Subscription): Promise<void> {
  const challenge = crypto.randomUUID();
  const body = JSON.stringify({ type: "verification", challenge });
  let stage = "sign";
  try {
    const headers = await eventHeaders(sub, "verify_" + crypto.randomUUID(), body);
    stage = "request";
    const response = await fetch(validateWebhookUrl(sub.url), { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
      headers, body });
    stage = "response";
    if (!response.ok || !response.body) { await response.body?.cancel(); throw new Error("challenge_failed"); }
    const reader = response.body.getReader(); let text = ""; let size = 0;
    try {
      while (true) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.length; if (size > 4096) throw new Error("challenge_failed"); text += new TextDecoder().decode(chunk.value); }
    } finally { await reader.cancel(); }
    const echoed = (JSON.parse(text) as { challenge?: unknown }).challenge;
    stage = "compare";
    const a = new TextEncoder().encode(challenge); const b = new TextEncoder().encode(typeof echoed === "string" ? echoed : "");
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
    const signature = await crypto.subtle.sign("HMAC", key, a);
    if (!await crypto.subtle.verify("HMAC", key, signature, b)) throw new Error("challenge_failed");
  } catch (error) {
    throw new Error(error instanceof DOMException && error.name === "TimeoutError" ? "MCP_CALLBACK_TIMEOUT" : `MCP_CALLBACK_FAILED_${stage}`);
  }
}

export async function eventOperation(storage: DurableObjectStorage, env: Env, context: WorkspaceContext, op: string, input: Record<string, unknown>): Promise<unknown> {
  if (context.role === "viewer" || context.principal.kind === "anonymous") throw new Error("Collaboration access required for event subscriptions");
  const sql = storage.sql;
  if (op === "mcp_events_list") return eventCatalog();
  if (!["mcp_events_subscribe", "mcp_events_unsubscribe"].includes(op)) throw new Error("Unknown event operation");
  const parsed = eventParams.parse(input);
  const url = validateWebhookUrl(parsed.delivery.url);
  const id = await subscriptionId(context, url, parsed.arguments);
  if (op === "mcp_events_unsubscribe") {
    sql.exec("DELETE FROM mcp_event_deliveries WHERE subscription_id = ?", id);
    sql.exec("DELETE FROM mcp_event_generations WHERE id = ?", id);
    sql.exec("UPDATE mcp_event_subscriptions SET expires_at = 0, secret = '', previous_secret = NULL, verified_at = 0 WHERE id = ?", id);
    return {};
  }
  if (!parsed.delivery.secret) throw new Error("Signing secret required");
  signingKey(parsed.delivery.secret);
  if (!sql.exec("SELECT name FROM agents WHERE name = ? AND removed_at IS NULL", parsed.arguments.agent).toArray()[0]) throw new Error("Register the receiving agent first");
  const count = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE expires_at > ?", Date.now()).toArray()[0]!.n;
  const old = sql.exec<Subscription>("SELECT * FROM mcp_event_subscriptions WHERE id = ?", id).toArray()[0];
  if (count >= 100 && (!old || old.expires_at <= Date.now())) throw new Error("Workspace event subscription limit reached");
  const at = Date.now();
  const sub: Subscription = { id, workspace_id: context.id, owner_kind: context.principal.kind, owner_id: context.principal.id,
    agent: parsed.arguments.agent, project: parsed.arguments.project ?? null, team: parsed.arguments.team ?? null, url, secret: parsed.delivery.secret,
    previous_secret: old?.secret && old.secret !== parsed.delivery.secret ? old.secret : old?.previous_secret ?? null,
    rotation_until: old?.secret && old.secret !== parsed.delivery.secret ? at + 300000 : old?.rotation_until ?? null,
    expires_at: at + Math.max(60000, Math.min(86400000, parsed.ttlMs ?? 3600000)), verified_at: at };
  if (!await eventAccess(env, sub)) throw new Error("Subscription access revoked");
  // Reserve a generation before network I/O: unsubscribe wins a verify race.
  const generation = crypto.randomUUID();
  sql.exec("INSERT INTO mcp_event_generations (id, generation) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET generation = excluded.generation", id, generation);
  try {
    if (!old || old.secret !== sub.secret || old.verified_at < at - 300000 || old.expires_at <= at) await verify(sub);
    if (!await eventAccess(env, sub)) throw new Error("Subscription access revoked");
    const current = sql.exec<{ generation: string }>("SELECT generation FROM mcp_event_generations WHERE id = ?", id).toArray()[0];
    if (current?.generation !== generation) throw new Error("Subscription changed during verification; retry explicitly");
    if (!sql.exec("SELECT name FROM agents WHERE name = ? AND removed_at IS NULL", sub.agent).toArray()[0]) throw new Error("Receiving agent removed");
    const active = sql.exec<{ n: number }>("SELECT COUNT(*) AS n FROM mcp_event_subscriptions WHERE expires_at > ? AND id <> ?", Date.now(), id).toArray()[0]!.n;
    if (active >= 100) throw new Error("Workspace event subscription limit reached");
    sql.exec(`INSERT INTO mcp_event_subscriptions (id, workspace_id, owner_kind, owner_id, agent, project, team, url, secret, previous_secret, rotation_until, expires_at, verified_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET secret=excluded.secret, previous_secret=excluded.previous_secret, rotation_until=excluded.rotation_until, expires_at=excluded.expires_at, verified_at=excluded.verified_at`,
      sub.id, sub.workspace_id, sub.owner_kind, sub.owner_id, sub.agent, sub.project, sub.team, sub.url, sub.secret, sub.previous_secret, sub.rotation_until, sub.expires_at, sub.verified_at);
    await scheduleDeliveryAlarm(storage, sub.expires_at);
    return { id, refreshBefore: new Date(sub.expires_at).toISOString(), cursor: null, truncated: false };
  } finally {
    sql.exec("DELETE FROM mcp_event_generations WHERE id = ? AND generation = ?", id, generation);
  }
}

export async function deliverMcpEvents(storage: DurableObjectStorage, env: Env): Promise<void> {
  const sql = storage.sql;
  sql.exec("DELETE FROM mcp_event_deliveries WHERE subscription_id IN (SELECT id FROM mcp_event_subscriptions WHERE expires_at <= ?)", Date.now());
  sql.exec("DELETE FROM mcp_event_subscriptions WHERE expires_at <= ?", Date.now());
  const pending = sql.exec<Delivery>("SELECT * FROM mcp_event_deliveries WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 10", Date.now()).toArray();
  for (const event of pending) {
    const sub = sql.exec<Subscription>("SELECT * FROM mcp_event_subscriptions WHERE id = ?", event.subscription_id).toArray()[0];
    if (!sub) continue;
    if (!await eventAccess(env, sub) || !sql.exec("SELECT name FROM agents WHERE name = ? AND removed_at IS NULL", sub.agent).toArray()[0]) {
      sql.exec("DELETE FROM mcp_event_deliveries WHERE subscription_id = ?", sub.id);
      sql.exec("DELETE FROM mcp_event_subscriptions WHERE id = ?", sub.id); continue;
    }
    if (sql.exec<{ paused: number }>("SELECT paused FROM agents WHERE name = ?", sub.agent).toArray()[0]?.paused) {
      sql.exec("UPDATE mcp_event_deliveries SET next_attempt_at = ? WHERE id = ?", Date.now() + 60000, event.id);
      continue;
    }
    if (event.attempts >= 8) {
      sql.exec("UPDATE mcp_event_deliveries SET state = 'failed' WHERE id = ?", event.id);
      continue;
    }
    const attempt = event.attempts + 1;
    sql.exec("UPDATE mcp_event_deliveries SET attempts = ?, next_attempt_at = ? WHERE id = ?", attempt, Date.now() + Math.min(3600000, 10000 * 2 ** (attempt - 1)), event.id);
    await scheduleDeliveryAlarm(storage);
    let status = 0;
    try {
      const body = JSON.stringify({ eventId: event.id, name: NAME, timestamp: new Date(event.created_at).toISOString(),
        data: { agent: sub.agent, message_id: event.message_id, workspace_id: sub.workspace_id }, cursor: null });
      const headers = await eventHeaders(sub, event.id, body);
      const live = sql.exec<Subscription>("SELECT * FROM mcp_event_subscriptions WHERE id = ? AND expires_at > ?", sub.id, Date.now()).toArray()[0];
      if (!live || live.secret !== sub.secret) continue;
      const response = await fetch(validateWebhookUrl(sub.url), { method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000), headers, body });
      status = response.status; await response.body?.cancel();
    } catch { /* Never log callback URLs, secrets or exception bodies. */ }
    const terminal = status === 410 || status === 413 || (status >= 400 && status < 500 && ![408, 429].includes(status));
    sql.exec("UPDATE mcp_event_deliveries SET state = ?, http_status = ? WHERE id = ?",
      status >= 200 && status < 300 ? "delivered" : terminal || attempt >= 8 ? "failed" : "pending", status || null, event.id);
    if (status === 410) {
      sql.exec("DELETE FROM mcp_event_deliveries WHERE subscription_id = ?", sub.id);
      sql.exec("DELETE FROM mcp_event_subscriptions WHERE id = ?", sub.id);
    }
  }
  sql.exec("UPDATE mcp_event_subscriptions SET previous_secret = NULL, rotation_until = NULL WHERE rotation_until <= ?", Date.now());
  sql.exec("DELETE FROM mcp_event_deliveries WHERE state <> 'pending' AND created_at < ?", Date.now() - 7 * 86400000);
}
