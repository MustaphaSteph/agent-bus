import type { WorkspaceContext } from "../shared/types";
import { attachmentIds } from "../shared/attachments";
import { scopeFrom, type ChatScope as Scope } from "../shared/chat-scope";
import { findAttachment, publicAttachment } from "./attachments";

type Sql = DurableObjectStorage["sql"];
type Member = { name: string; last_seen: number; paused: number; listening_until: number | null };
const scopeSql = "team = ? AND project IS ? AND area IS ?";
const humanPrefix = "human.";

export function humanIdentity(context: WorkspaceContext): string {
  return humanPrefix + context.principal.id;
}

function members(sql: Sql, scope: Scope): Member[] {
  return sql.exec<Member>(`SELECT name, last_seen, paused, listening_until FROM agents WHERE removed_at IS NULL AND ${scopeSql} ORDER BY name`,
    scope.team, scope.project, scope.area).toArray();
}

function presence(member: Member) {
  return member.paused ? "paused" : (member.listening_until ?? 0) > Date.now() ? "listening"
    : Date.now() - member.last_seen > 300000 ? "offline" : "online";
}

export function humanChatView(sql: Sql, context: WorkspaceContext, input: Record<string, unknown>) {
  const groups = sql.exec<Scope>(`SELECT DISTINCT team, project, area FROM agents WHERE removed_at IS NULL AND team IS NOT NULL
    UNION SELECT DISTINCT team, project, area FROM messages WHERE team IS NOT NULL ORDER BY project, area, team`).toArray();
  const scope = input.team ? scopeFrom(input) : groups[0] ?? null;
  const messages = scope ? sql.exec(`SELECT * FROM messages WHERE ${scopeSql} ORDER BY id DESC LIMIT 100`, scope.team, scope.project, scope.area).toArray().reverse() : [];
  return {
    groups, scope, members: scope ? members(sql, scope).map(member => ({ name: member.name, presence: presence(member) })) : [],
    messages: messages.map(({ content, ...message }) => ({ ...message,
      attachments: JSON.parse(String(message.attachments || "[]")),
      content_preview: String(content).slice(0, 4000), truncated: String(content).length > 4000,
      sender_kind: String(message.from_agent).startsWith(humanPrefix) ? "human" : "agent",
      sender_name: message.sender_name || message.from_agent,
    })),
    human: { id: humanIdentity(context), name: context.principal.displayName || "Workspace member" },
    can_post: context.principal.kind === "user" && context.role !== "viewer",
  };
}

export function postHumanChat(sql: Sql, storage: DurableObjectStorage, context: WorkspaceContext, input: Record<string, unknown>) {
  if (context.principal.kind !== "user" || context.role === "viewer") throw new Error("Only signed-in members with write access can send messages.");
  const allowed = new Set(["team", "project", "area", "content", "reply_to", "request_id", "attachment_ids"]);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new Error("Unexpected chat field.");
  const scope = scopeFrom(input);
  const content = typeof input.content === "string" ? input.content.trim() : "";
  const fileIds = attachmentIds(input.attachment_ids);
  if ((!content && !fileIds.length) || content.length > 12000) throw new Error("Add a message or file. Messages can contain up to 12000 characters.");
  if (typeof input.request_id !== "string" || !/^[a-zA-Z0-9_-]{16,80}$/.test(input.request_id)) throw new Error("A valid request_id is required.");
  const replyTo = input.reply_to == null ? null : input.reply_to;
  if (replyTo !== null && (!Number.isSafeInteger(replyTo) || Number(replyTo) < 1)) throw new Error("Invalid reply target.");
  const author = humanIdentity(context);
  const signature = JSON.stringify({ ...scope, content, replyTo, ...(fileIds.length ? { attachment_ids: fileIds } : {}) });
  return storage.transactionSync(() => {
    const previous = sql.exec<{ payload: string; result: string }>("SELECT payload, result FROM human_chat_requests WHERE user_id = ? AND request_id = ?", context.principal.id, input.request_id as string).toArray()[0];
    if (previous) {
      if (previous.payload !== signature) throw new Error("This request was already used for a different message.");
      return JSON.parse(previous.result);
    }
    const attachments = fileIds.map(id => {
      const file = findAttachment(sql, id);
      if (file.uploader !== context.principal.id || file.state !== "ready" || file.expires_at <= Date.now() ||
          file.team !== scope.team || file.project !== scope.project || file.area !== scope.area) throw new Error("Attachment is unavailable in this conversation. Attach it again.");
      return publicAttachment(file, context.slug);
    });
    const roster = members(sql, scope);
    const names = new Set(roster.map(member => member.name));
    const mentions = [...new Set([...content.matchAll(/(?:^|[\s(])@([a-zA-Z0-9_.-]+)(?=$|[\s,!?;:)])/g)].map(match => match[1]!))];
    for (const name of mentions) if (!names.has(name)) throw new Error(`@${name} is not a member of this team. No message was sent.`);
    let threadId = `t_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
    let defaultTarget: string | null = null;
    if (replyTo !== null) {
      const parent = sql.exec(`SELECT * FROM messages WHERE id = ? AND ${scopeSql}`, Number(replyTo), scope.team, scope.project, scope.area).toArray()[0];
      if (!parent) throw new Error("Reply target is outside this conversation.");
      threadId = String(parent.thread_id || threadId);
      defaultTarget = String(parent.from_agent).startsWith(humanPrefix) ? String(parent.to_agent) : String(parent.from_agent);
    }
    const targets = mentions.length ? mentions : defaultTarget ? [defaultTarget] : [...names];
    if (!targets.length) throw new Error("No agents have joined this team yet.");
    if (targets.length > 50) throw new Error("Tag specific agents; a message can reach at most 50 agents.");
    for (const target of targets) if (!names.has(target)) throw new Error("The reply recipient is no longer in this team.");
    sql.exec("INSERT INTO human_participants (name, display_name) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET display_name = excluded.display_name", author, context.principal.displayName || "Workspace member");
    const ids: number[] = [];
    for (const target of targets) {
      sql.exec(`INSERT INTO messages (from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, project, area, team, priority, sender_name, human_post_id, attachments)
        VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'normal', ?, ?, ?)`, author, target, replyTo ? "reply" : "msg", content, replyTo as number | null,
        Date.now(), threadId, scope.project, scope.area, scope.team, context.principal.displayName || "Workspace member", input.request_id as string, JSON.stringify(attachments));
      ids.push(Number(sql.exec<{ id: number }>("SELECT last_insert_rowid() AS id").toArray()[0]!.id));
    }
    for (const id of fileIds) sql.exec("UPDATE chat_attachments SET state = 'attached' WHERE id = ?", id);
    if (replyTo !== null) sql.exec("UPDATE messages SET status = 'answered', replied_at = ? WHERE id = ? AND to_agent = ?", Date.now(), Number(replyTo), author);
    const result = { ids, thread_id: threadId, sender: author, recipients: targets.map(name => ({ name, presence: presence(roster.find(member => member.name === name)!), status: "queued" })) };
    sql.exec("INSERT INTO human_chat_requests (user_id, request_id, payload, result) VALUES (?, ?, ?, ?)", context.principal.id, input.request_id as string, signature, JSON.stringify(result));
    return result;
  });
}
