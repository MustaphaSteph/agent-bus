import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { WORKSPACE_SCHEMA_SQL } from "../src/durable-objects/schema";
import { attachmentOperation, cleanupAttachments } from "../src/durable-objects/attachments";
import { cleanFilename, imageContentType, WORKSPACE_FILE_BYTES } from "../src/shared/attachments";
import type { Env, WorkspaceContext } from "../src/shared/types";

const db = new Database(":memory:");
db.exec(WORKSPACE_SCHEMA_SQL);
db.exec(WORKSPACE_SCHEMA_SQL);
const sql = { exec(query: string, ...values: unknown[]) {
  const statement = db.prepare(query);
  return { toArray: () => statement.reader ? statement.all(...values) : (statement.run(...values), []) };
} };
// Durable Object exec is eager; adapt the in-memory SQLite connection accordingly.
const eagerSql = { exec(query: string, ...values: unknown[]) {
  const result = sql.exec(query, ...values).toArray();
  return { toArray: () => result };
} } as unknown as DurableObjectStorage["sql"];
const alarms: number[] = [];
const storage = { sql: eagerSql, getAlarm: async () => null, setAlarm: async (time: number) => { alarms.push(time); } } as unknown as DurableObjectStorage;
const deleted: string[] = [];
let failDeletion = false;
const env = { CHAT_FILES: { delete: async (key: string) => {
  if (failDeletion) throw new Error("storage unavailable");
  deleted.push(key);
} } } as unknown as Env;
const context: WorkspaceContext = { id: "workspace1", slug: "test", role: "owner", principal: { kind: "user", id: "user1", role: "owner" } };
const reserve = async () => await attachmentOperation(eagerSql, storage, env, context, "attachment_reserve", {
  team: "team", name: "notes.md", size: 12, content_type: "application/octet-stream",
}) as { id: string; object_key: string };

try {
  assert.equal(cleanFilename("../../bad\r\nname.md"), "bad__name.md");
  assert.equal(imageContentType(new TextEncoder().encode("<svg onload='alert(1)'></svg>")), "application/octet-stream");
  const expired = await reserve();
  const sent = await reserve();
  db.prepare("UPDATE chat_attachments SET state = 'attached', expires_at = 0 WHERE id = ?").run(sent.id);
  db.prepare("UPDATE chat_attachments SET expires_at = 0 WHERE id = ?").run(expired.id);
  failDeletion = true;
  await assert.rejects(cleanupAttachments(eagerSql, storage, env), /storage unavailable/);
  assert.equal((db.prepare("SELECT state FROM chat_attachments WHERE id = ?").get(expired.id) as { state: string }).state, "deleting");
  failDeletion = false;
  await cleanupAttachments(eagerSql, storage, env);
  assert.deepEqual(deleted, [expired.object_key]);
  assert(db.prepare("SELECT id FROM chat_attachments WHERE id = ?").get(sent.id), "cleanup removed a sent file");
  assert(alarms.length >= 2, "reservations did not schedule cleanup");
  const pending = await reserve();
  await assert.rejects(attachmentOperation(eagerSql, storage, env, context, "attachment_get", { id: pending.id }), /not found/);
  await attachmentOperation(eagerSql, storage, env, context, "attachment_ready", { id: pending.id });
  await assert.rejects(attachmentOperation(eagerSql, storage, env, { ...context, principal: { ...context.principal, id: "other-user" } }, "attachment_get", { id: pending.id }), /not found/);
  db.prepare("UPDATE chat_attachments SET size = ? WHERE id = ?").run(WORKSPACE_FILE_BYTES, sent.id);
  await assert.rejects(reserve(), /storage is full/);
  console.log("attachment lifecycle passed: idempotent schema, quota, expiry, cleanup retry, sent-file retention, and private drafts");
} finally { db.close(); }
