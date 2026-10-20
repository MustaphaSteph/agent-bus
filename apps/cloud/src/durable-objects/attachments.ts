import type { Env, WorkspaceContext } from "../shared/types";
import { DRAFT_FILE_TTL, MAX_FILE_BYTES, WORKSPACE_FILE_BYTES, type ChatAttachment } from "../shared/attachments";
import { scopeFrom } from "../shared/chat-scope";
import { scheduleDeliveryAlarm } from "./delivery-alarm";

type Sql = DurableObjectStorage["sql"];
export type AttachmentRow = {
  id: string; uploader: string; name: string; size: number; content_type: string; object_key: string;
  project: string | null; area: string | null; team: string;
  state: string; expires_at: number;
};

export function publicAttachment(row: AttachmentRow, slug: string): ChatAttachment {
  return { id: row.id, name: row.name, size: row.size, content_type: row.content_type,
    url: `/api/workspaces/${encodeURIComponent(slug)}/files/${row.id}` };
}

export function findAttachment(sql: Sql, id: string): AttachmentRow {
  const row = sql.exec<AttachmentRow>("SELECT * FROM chat_attachments WHERE id = ?", id).toArray()[0];
  if (!row) throw new Error("Attachment not found.");
  return row;
}

export async function scheduleAttachmentCleanup(sql: Sql, storage: DurableObjectStorage): Promise<void> {
  await scheduleDeliveryAlarm(storage);
}

export async function attachmentOperation(sql: Sql, storage: DurableObjectStorage, env: Env, context: WorkspaceContext, op: string, input: Record<string, unknown>) {
  if (op === "attachment_reserve") {
    if (context.principal.kind !== "user" || context.role === "viewer") throw new Error("Write access required.");
    const scope = scopeFrom(input);
    const size = Number(input.size);
    if (!Number.isSafeInteger(size) || size < 1 || size > MAX_FILE_BYTES) throw new Error("File must be between 1 byte and 10 MB.");
    const total = sql.exec<{ bytes: number; count: number }>("SELECT COALESCE(SUM(size), 0) AS bytes, COUNT(*) AS count FROM chat_attachments").toArray()[0]!;
    if (total.bytes + size > WORKSPACE_FILE_BYTES || total.count >= 10000) throw new Error("Workspace file storage is full.");
    const id = crypto.randomUUID();
    const objectKey = `${context.id}/${id}`;
    sql.exec("INSERT INTO chat_attachments (id, uploader, name, size, content_type, object_key, project, area, team, state, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'uploading', ?)",
      id, context.principal.id, String(input.name), size, String(input.content_type), objectKey, scope.project, scope.area, scope.team, Date.now() + DRAFT_FILE_TTL);
    await scheduleAttachmentCleanup(sql, storage);
    return findAttachment(sql, id);
  }
  const row = findAttachment(sql, String(input.id));
  if (op === "attachment_get") {
    if (row.state !== "attached" && (row.state !== "ready" || row.uploader !== context.principal.id || row.expires_at <= Date.now())) throw new Error("Attachment not found.");
    return row;
  }
  if (context.principal.kind !== "user" || context.role === "viewer" || row.uploader !== context.principal.id) throw new Error("Only the uploader can change a draft file.");
  if (op === "attachment_ready") {
    if (row.state !== "uploading" || row.expires_at <= Date.now()) throw new Error("Upload expired. Attach the file again.");
    sql.exec("UPDATE chat_attachments SET state = 'ready' WHERE id = ?", row.id);
    return publicAttachment(row, context.slug);
  }
  if (op !== "attachment_delete" || row.state === "attached") throw new Error("Sent attachments cannot be removed from a draft.");
  // Change state before awaiting storage so a concurrent send cannot attach a deleted object.
  sql.exec("UPDATE chat_attachments SET state = 'deleting', expires_at = ? WHERE id = ?", Date.now(), row.id);
  await scheduleAttachmentCleanup(sql, storage);
  await env.CHAT_FILES.delete(row.object_key);
  sql.exec("DELETE FROM chat_attachments WHERE id = ? AND state = 'deleting'", row.id);
  return { deleted: true };
}

export async function cleanupAttachments(sql: Sql, storage: DurableObjectStorage, env: Env): Promise<void> {
  const expired = sql.exec<AttachmentRow>("SELECT * FROM chat_attachments WHERE state <> 'attached' AND expires_at <= ? LIMIT 100", Date.now()).toArray();
  for (const row of expired) {
    sql.exec("UPDATE chat_attachments SET state = 'deleting' WHERE id = ? AND state <> 'attached'", row.id);
    await env.CHAT_FILES.delete(row.object_key);
    sql.exec("DELETE FROM chat_attachments WHERE id = ? AND state = 'deleting'", row.id);
  }
  await scheduleAttachmentCleanup(sql, storage);
}
