// Attachments and webhook retries share the Durable Object's single alarm.
const scheduling = new WeakMap<DurableObjectStorage, Promise<void>>();
export async function scheduleDeliveryAlarm(storage: DurableObjectStorage, deadline?: number): Promise<void> {
  const previous = scheduling.get(storage) ?? Promise.resolve();
  const scheduled = previous.catch(() => {}).then(() => schedule(storage, deadline));
  scheduling.set(storage, scheduled);
  try { await scheduled; } finally {
    if (scheduling.get(storage) === scheduled) scheduling.delete(storage);
  }
}

async function schedule(storage: DurableObjectStorage, deadline?: number): Promise<void> {
  const row = storage.sql.exec<{ deadline: number | null }>(`
    SELECT MIN(deadline) AS deadline FROM (
      SELECT MIN(expires_at) AS deadline FROM chat_attachments WHERE state <> 'attached'
      UNION ALL
      SELECT MIN(next_attempt_at) AS deadline FROM webhook_deliveries WHERE state = 'pending'
      UNION ALL
      SELECT MIN(next_attempt_at) AS deadline FROM mcp_event_deliveries WHERE state = 'pending'
      UNION ALL
      SELECT MIN(expires_at) AS deadline FROM mcp_event_subscriptions
    )`).toArray()[0];
  const next = Math.min(row?.deadline ?? Infinity, deadline ?? Infinity);
  if (!Number.isFinite(next)) return;
  const at = Math.max(Date.now() + 1000, next);
  const current = await storage.getAlarm();
  if (current === null || at < current) await storage.setAlarm(at);
}
