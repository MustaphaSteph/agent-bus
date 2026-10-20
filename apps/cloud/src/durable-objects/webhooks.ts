import type { WorkspaceContext } from "../shared/types";
import { scheduleDeliveryAlarm } from "./delivery-alarm";

type Sql = DurableObjectStorage["sql"];
type Hook = { id: string; agent: string; url: string; secret: string; created_at: number };
type Delivery = { id: string; webhook_id: string; message_id: number; created_at: number; attempts: number };
const MAX_ATTEMPTS = 8;

export function validateWebhookUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 2048) throw new Error("A public HTTPS receiving URL is required.");
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  // IP literals and local names are rejected here; Workers' strictly-public fetch
  // additionally rejects DNS resolutions to private addresses. Never follow redirects.
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.search ||
      (url.port && url.port !== "443") || !host.includes(".") || host.endsWith(".") ||
      /^[\d.]+$/.test(host) || host.includes(":") ||
      /(?:^|\.)(?:localhost|local|internal|lan|home|test|invalid)$/.test(host)) {
    throw new Error("Use a public HTTPS receiving URL without credentials, query parameters, fragments or a custom port.");
  }
  return url.href;
}

export function webhookOperation(sql: Sql, context: WorkspaceContext, op: string, input: Record<string, unknown>): unknown {
  if (context.role !== "owner" && context.role !== "manager") throw new Error("Only workspace owners or managers can configure webhooks.");
  if (op === "webhook_list") {
    return {
      webhooks: sql.exec("SELECT id, agent, url, created_at FROM outbound_webhooks ORDER BY created_at").toArray(),
      deliveries: sql.exec("SELECT * FROM webhook_deliveries ORDER BY created_at DESC, id DESC LIMIT 100").toArray(),
      automatic_model_wakeup: false,
    };
  }
  if (op === "webhook_create") {
    const agent = String(input.agent ?? "");
    if (!sql.exec("SELECT name FROM agents WHERE name = ? AND removed_at IS NULL", agent).toArray()[0]) throw new Error("Register the receiving agent first.");
    if (sql.exec("SELECT id FROM outbound_webhooks WHERE agent = ?", agent).toArray()[0]) throw new Error("Agent webhook already exists; delete it before replacing it.");
    const count = sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM outbound_webhooks").toArray()[0]!.count;
    if (count >= 20) throw new Error("Workspace webhook limit reached (20).");
    const hook: Hook = { id: crypto.randomUUID(), agent, url: validateWebhookUrl(input.url),
      secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, "0")).join(""), created_at: Date.now() };
    sql.exec("INSERT INTO outbound_webhooks (id, agent, url, secret, created_at) VALUES (?, ?, ?, ?, ?)", hook.id, hook.agent, hook.url, hook.secret, hook.created_at);
    return { webhook: hook, automatic_model_wakeup: false };
  }
  const id = String(input.id ?? "");
  if (op !== "webhook_delete" || !sql.exec("SELECT id FROM outbound_webhooks WHERE id = ?", id).toArray()[0]) throw new Error("Webhook not found.");
  sql.exec("DELETE FROM webhook_deliveries WHERE webhook_id = ?", id);
  sql.exec("DELETE FROM outbound_webhooks WHERE id = ?", id);
  return { deleted: true, id };
}

export async function deliverWebhooks(storage: DurableObjectStorage): Promise<void> {
  const sql = storage.sql;
  const pending = sql.exec<Delivery>("SELECT * FROM webhook_deliveries WHERE state = 'pending' AND next_attempt_at <= ? ORDER BY next_attempt_at LIMIT 10", Date.now()).toArray();
  for (const delivery of pending) {
    const hook = sql.exec<Hook>("SELECT * FROM outbound_webhooks WHERE id = ?", delivery.webhook_id).toArray()[0];
    if (!hook) continue;
    const agent = sql.exec<{ removed_at: number | null }>("SELECT removed_at FROM agents WHERE name = ?", hook.agent).toArray()[0];
    if (!agent || agent.removed_at !== null || delivery.attempts >= MAX_ATTEMPTS) {
      sql.exec("UPDATE webhook_deliveries SET state = 'failed' WHERE id = ?", delivery.id);
      continue;
    }
    const attempt = delivery.attempts + 1;
    // Persist a retry deadline before I/O. Eviction can cause a duplicate, never
    // an acknowledgement or silent loss. Receivers must deduplicate event IDs.
    sql.exec("UPDATE webhook_deliveries SET attempts = ?, next_attempt_at = ? WHERE id = ?", attempt, Date.now() + Math.min(3600000, 10000 * 2 ** (attempt - 1)), delivery.id);
    await scheduleDeliveryAlarm(storage);
    let status = 0;
    try {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = JSON.stringify({ id: delivery.id, type: "inbox.message_available", agent: hook.agent,
        message_id: delivery.message_id, created_at: delivery.created_at });
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey("raw", encoder.encode(hook.secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${body}`));
      const hex = Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, "0")).join("");
      // A manager may revoke the destination while signing is in flight.
      if (!sql.exec("SELECT id FROM outbound_webhooks WHERE id = ?", hook.id).toArray()[0]) continue;
      const response = await fetch(validateWebhookUrl(hook.url), {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(5000),
        headers: { "content-type": "application/json", "Agent-Bus-Event-Id": delivery.id,
          "Agent-Bus-Signature": `t=${timestamp},v1=${hex}` }, body,
      });
      status = response.status;
      await response.body?.cancel();
    } catch {
      // Never persist exception text: it can contain a destination secret or URL.
    }
    sql.exec("UPDATE webhook_deliveries SET state = ?, http_status = ? WHERE id = ?",
      status >= 200 && status < 300 ? "delivered" : attempt >= MAX_ATTEMPTS ? "failed" : "pending", status || null, delivery.id);
  }
  sql.exec("DELETE FROM webhook_deliveries WHERE state <> 'pending' AND created_at < ?", Date.now() - 7 * 86400000);
  await scheduleDeliveryAlarm(storage);
}
