import { getDb } from "./db.js";
import { BusError } from "./util/errors.js";
import { runLocalHook } from "./util/hooks.js";
import { now, sleep } from "./util/time.js";

export const MAX_ASK_TIMEOUT_S = 110;
export const MAX_INBOX_WAIT_S = 110;

function readPollInterval(): number {
  const raw = process.env.AGENT_BUS_POLL_MS;
  if (!raw) return 50;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 5) return 50;
  return Math.min(parsed, 5000);
}

export const POLL_INTERVAL_MS = readPollInterval();

export type MessageKind = "msg" | "ask" | "reply";
export type MessageStatus = "pending" | "delivered" | "answered";
export type MessagePriority = "low" | "normal" | "high" | "urgent";
export type AgentRole = "pm" | "worker" | "verifier" | "reviewer" | "listener" | string;
export type AgentStatus = "idle" | "working" | "blocked" | "waiting_review" | "sleeping";
export type TaskMode = "investigate_only" | "propose_patch" | "edit_files" | "test_only";
export type MemoryKind = "summary" | "handoff" | "risk" | "todo" | "fact" | "blocker" | "lesson" | "gotcha" | string;

export const PROJECT_WILDCARD = "*";
export const AREA_WILDCARD = PROJECT_WILDCARD;

export interface Agent {
  name: string;
  capabilities: string[];
  registered_at: number;
  last_seen: number;
  paused: boolean;
  project: string | null;
  area: string | null;
  role: AgentRole | null;
  routing_weight: number;
  status: AgentStatus;
}

export interface Message {
  id: number;
  from_agent: string;
  to_agent: string;
  kind: MessageKind;
  content: string;
  reply_to: number | null;
  status: MessageStatus;
  created_at: number;
  delivered_at: number | null;
  replied_at: number | null;
  thread_id: string;
  claim_deadline: number | null;
  claimed_by: string | null;
  channel: string | null;
  project: string | null;
  area: string | null;
  priority: MessagePriority;
}

export interface Subscription {
  channel: string;
  agent: string;
  subscribed_at: number;
}

interface AgentRow {
  name: string;
  capabilities: string;
  registered_at: number;
  last_seen: number;
  paused: number;
  project: string | null;
  area: string | null;
  role: AgentRole | null;
  routing_weight: number;
  status: AgentStatus;
}

interface MessageRow {
  id: number;
  from_agent: string;
  to_agent: string;
  kind: MessageKind;
  content: string;
  reply_to: number | null;
  status: MessageStatus;
  created_at: number;
  delivered_at: number | null;
  replied_at: number | null;
  thread_id: string | null;
  claim_deadline: number | null;
  claimed_by: string | null;
  channel: string | null;
  project: string | null;
  area: string | null;
  priority: MessagePriority;
}

function toAgent(row: AgentRow): Agent {
  return {
    name: row.name,
    capabilities: JSON.parse(row.capabilities) as string[],
    registered_at: row.registered_at,
    last_seen: row.last_seen,
    paused: row.paused === 1,
    project: row.project,
    area: row.area,
    role: row.role,
    routing_weight: row.routing_weight,
    status: row.status,
  };
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    from_agent: row.from_agent,
    to_agent: row.to_agent,
    kind: row.kind,
    content: row.content,
    reply_to: row.reply_to,
    status: row.status,
    created_at: row.created_at,
    delivered_at: row.delivered_at,
    replied_at: row.replied_at,
    thread_id: row.thread_id ?? "",
    claim_deadline: row.claim_deadline,
    claimed_by: row.claimed_by,
    channel: row.channel,
    project: row.project,
    area: row.area,
    priority: row.priority,
  };
}

function validateScopeName(kind: "project" | "area" | "role", value: string | null | undefined): void {
  if (value === null || value === undefined) return;
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new BusError("INVALID_INPUT", `${kind} must be 1-64 chars or omitted`);
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new BusError(
      "INVALID_INPUT",
      `${kind} may only contain letters, digits, _ . -`,
    );
  }
}

function validateProject(project: string | null | undefined): void {
  validateScopeName("project", project);
}

function validateArea(area: string | null | undefined): void {
  validateScopeName("area", area);
}

function validateRole(role: string | null | undefined): void {
  validateScopeName("role", role);
}

function validatePriority(priority: MessagePriority | undefined): void {
  if (priority === undefined) return;
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    throw new BusError("INVALID_INPUT", "priority must be low, normal, high, or urgent");
  }
}

function validateAgentStatus(status: AgentStatus | undefined): void {
  if (status === undefined) return;
  if (!["idle", "working", "blocked", "waiting_review", "sleeping"].includes(status)) {
    throw new BusError("INVALID_INPUT", "status must be idle, working, blocked, waiting_review, or sleeping");
  }
}

function validateTaskMode(mode: TaskMode | undefined): void {
  if (mode === undefined) return;
  if (!["investigate_only", "propose_patch", "edit_files", "test_only"].includes(mode)) {
    throw new BusError("INVALID_INPUT", "mode must be investigate_only, propose_patch, edit_files, or test_only");
  }
}

function validateMemoryKind(kind: string): void {
  if (typeof kind !== "string" || kind.length === 0 || kind.length > 64) {
    throw new BusError("INVALID_INPUT", "kind must be 1-64 chars");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(kind)) {
    throw new BusError("INVALID_INPUT", "kind may only contain letters, digits, _ . -");
  }
}

function requireAgent(name: string): Agent {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agents WHERE name = ?").get(name) as
    | AgentRow
    | undefined;
  if (!row) throw new BusError("UNKNOWN_AGENT", `agent '${name}' is not registered`);
  return toAgent(row);
}

function validateName(name: string): void {
  if (typeof name !== "string" || name.length === 0 || name.length > 64) {
    throw new BusError("INVALID_INPUT", "name must be 1-64 chars");
  }
  if (!/^[a-zA-Z0-9_.-]+$/.test(name)) {
    throw new BusError("INVALID_INPUT", "name may only contain letters, digits, _ . -");
  }
}

function validateChannel(channel: string): void {
  if (typeof channel !== "string" || channel.length === 0 || channel.length > 64) {
    throw new BusError("INVALID_INPUT", "channel must be 1-64 chars");
  }
  if (!/^[a-zA-Z0-9_.:#-]+$/.test(channel)) {
    throw new BusError(
      "INVALID_INPUT",
      "channel may only contain letters, digits, _ . : # -",
    );
  }
}

function newThreadId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 10);
  return `t_${ts}_${rand}`;
}

export interface RegisterOptions {
  name: string;
  capabilities?: string[];
  replace?: boolean;
  project?: string | null;
  area?: string | null;
  role?: AgentRole | null;
  routing_weight?: number;
  status?: AgentStatus;
}

export function register(opts: RegisterOptions): Agent {
  validateName(opts.name);
  validateProject(opts.project);
  validateArea(opts.area);
  validateRole(opts.role);
  validateAgentStatus(opts.status);
  if (opts.routing_weight !== undefined && !Number.isFinite(opts.routing_weight)) {
    throw new BusError("INVALID_INPUT", "routing_weight must be a number");
  }
  const caps = opts.capabilities ?? [];
  const db = getDb();
  const existing = db
    .prepare("SELECT * FROM agents WHERE name = ?")
    .get(opts.name) as AgentRow | undefined;

  const ts = now();
  if (existing && !opts.replace) {
    const ageMs = ts - existing.last_seen;
    if (ageMs < 60_000) {
      throw new BusError(
        "NAME_TAKEN",
        `agent '${opts.name}' is active (last seen ${Math.round(ageMs / 1000)}s ago); pass replace:true to take over`,
      );
    }
  }

  const project = opts.project ?? null;
  const area = opts.area ?? null;
  const role = opts.role ?? null;
  const routingWeight = Math.trunc(opts.routing_weight ?? 0);
  const status = opts.status ?? "idle";
  db.prepare(
    `INSERT INTO agents (name, capabilities, registered_at, last_seen, paused, project, area, role, routing_weight, status)
       VALUES (@name, @capabilities, @ts, @ts, 0, @project, @area, @role, @routingWeight, @status)
     ON CONFLICT(name) DO UPDATE SET
       capabilities = excluded.capabilities,
       registered_at = excluded.registered_at,
       last_seen = excluded.last_seen,
       paused = 0,
       project = excluded.project,
       area = excluded.area,
       role = excluded.role,
       routing_weight = excluded.routing_weight,
       status = excluded.status`,
  ).run({ name: opts.name, capabilities: JSON.stringify(caps), ts, project, area, role, routingWeight, status });

  return requireAgent(opts.name);
}

export function heartbeat(name: string): void {
  const db = getDb();
  db.prepare("UPDATE agents SET last_seen = ? WHERE name = ?").run(now(), name);
}

export interface WhoisOptions {
  project?: string;
  area?: string;
}

export function whois(opts: WhoisOptions = {}): Agent[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
    where.push("(project = ? OR project IS NULL)");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    validateArea(opts.area);
    where.push("(area = ? OR area IS NULL)");
    params.push(opts.area);
  }
  const rows = db
    .prepare(
      `SELECT * FROM agents${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
         ORDER BY last_seen DESC`,
    )
    .all(...params) as AgentRow[];
  return rows.map(toAgent);
}

export interface AgentDirectoryEntry extends Agent {
  presence: "online" | "idle" | "stale" | "paused";
  age_s: number;
  active_task_id: number | null;
}

export function directory(opts: WhoisOptions = {}): AgentDirectoryEntry[] {
  const agents = whois(opts);
  const db = getDb();
  const activeRows = db
    .prepare(
      `SELECT claimed_by, id
         FROM tasks
        WHERE claimed_by IS NOT NULL
          AND state IN ('claimed','working','blocked')
        ORDER BY updated_at DESC`,
    )
    .all() as { claimed_by: string; id: number }[];
  const activeByAgent = new Map<string, number>();
  for (const row of activeRows) {
    if (!activeByAgent.has(row.claimed_by)) activeByAgent.set(row.claimed_by, row.id);
  }
  const ts = now();
  return agents.map((agent) => {
    const age_s = Math.max(0, Math.round((ts - agent.last_seen) / 1000));
    const presence =
      agent.paused
        ? "paused"
        : age_s < 60
          ? "online"
          : age_s < 300
            ? "idle"
            : "stale";
    return {
      ...agent,
      presence,
      age_s,
      active_task_id: activeByAgent.get(agent.name) ?? null,
    };
  });
}

export interface SendOptions {
  from: string;
  to: string;
  content: string;
  kind?: MessageKind;
  reply_to?: number;
  thread_id?: string;
  channel?: string | null;
  priority?: MessagePriority;
}

function insertMessage(
  opts: SendOptions,
  threadId: string,
  senderProject: string | null,
  senderArea: string | null,
): Message {
  validatePriority(opts.priority);
  const db = getDb();
  const ts = now();
  const priority = opts.priority ?? "normal";
  const info = db
    .prepare(
      `INSERT INTO messages
         (from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, channel, project, area, priority)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.from,
      opts.to,
      opts.kind ?? "msg",
      opts.content,
      opts.reply_to ?? null,
      ts,
      threadId,
      opts.channel ?? null,
      senderProject,
      senderArea,
      priority,
    );

  const row = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(info.lastInsertRowid as number) as MessageRow;
  const message = toMessage(row);
  runLocalHook("message.created", message);
  return message;
}

export function send(opts: SendOptions): Message {
  validateName(opts.from);
  validateName(opts.to);
  if (typeof opts.content !== "string") {
    throw new BusError("INVALID_INPUT", "content must be a string");
  }
  const sender = requireAgent(opts.from);
  requireAgent(opts.to);
  heartbeat(opts.from);
  return insertMessage(opts, opts.thread_id ?? newThreadId(), sender.project, sender.area);
}

export interface InboxOptions {
  agent: string;
  since_id?: number;
  mark_delivered?: boolean;
  limit?: number;
  wait_s?: number;
  claim_s?: number;
}

export async function inbox(opts: InboxOptions): Promise<Message[]> {
  validateName(opts.agent);
  const agent = requireAgent(opts.agent);
  heartbeat(opts.agent);
  if (agent.paused) return [];

  const immediate = readInbox(opts);
  if (immediate.length > 0 || !opts.wait_s) return immediate;

  const waitMs = Math.min(opts.wait_s, MAX_INBOX_WAIT_S) * 1000;
  const deadline = now() + waitMs;
  while (now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    heartbeat(opts.agent);
    const fresh = readInbox(opts);
    if (fresh.length > 0) return fresh;
  }
  return [];
}

function readInbox(opts: InboxOptions): Message[] {
  const db = getDb();
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const since = opts.since_id ?? 0;
  const ts = now();

  const rows = db
    .prepare(
      `SELECT * FROM messages
         WHERE to_agent = ?
           AND id > ?
           AND status = 'pending'
           AND (claim_deadline IS NULL OR claim_deadline < ?)
         ORDER BY CASE priority
           WHEN 'urgent' THEN 3
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 1
           ELSE 0
         END DESC, id ASC
         LIMIT ?`,
    )
    .all(opts.agent, since, ts, limit) as MessageRow[];

  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const placeholders = ids.map(() => "?").join(",");

  if (opts.claim_s && opts.claim_s > 0) {
    const claimDeadline = ts + opts.claim_s * 1000;
    db.prepare(
      `UPDATE messages
         SET claim_deadline = ?, claimed_by = ?
         WHERE id IN (${placeholders})`,
    ).run(claimDeadline, opts.agent, ...ids);
    for (const row of rows) {
      row.claim_deadline = claimDeadline;
      row.claimed_by = opts.agent;
    }
  } else if (opts.mark_delivered !== false) {
    db.prepare(
      `UPDATE messages
         SET status = 'delivered', delivered_at = ?
         WHERE id IN (${placeholders}) AND status = 'pending'`,
    ).run(ts, ...ids);
    for (const row of rows) {
      row.status = "delivered";
      row.delivered_at = ts;
    }
  }

  return rows.map(toMessage);
}

export interface AckOptions {
  agent: string;
  message_id: number;
}

export function ack(opts: AckOptions): Message {
  validateName(opts.agent);
  requireAgent(opts.agent);

  const db = getDb();
  const row = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(opts.message_id) as MessageRow | undefined;
  if (!row) {
    throw new BusError("ASK_NOT_FOUND", `no message with id ${opts.message_id}`);
  }
  if (row.to_agent !== opts.agent) {
    throw new BusError(
      "INVALID_INPUT",
      `message ${opts.message_id} is addressed to '${row.to_agent}', not '${opts.agent}'`,
    );
  }

  const ts = now();
  db.prepare(
    `UPDATE messages
       SET status = 'delivered', delivered_at = ?, claim_deadline = NULL, claimed_by = NULL
       WHERE id = ? AND status = 'pending'`,
  ).run(ts, opts.message_id);

  const updated = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(opts.message_id) as MessageRow;
  return toMessage(updated);
}

export interface AskOptions {
  from: string;
  to: string;
  question: string;
  timeout_s?: number;
  thread_id?: string;
}

function hasPendingAsk(from: string, to: string): boolean {
  const db = getDb();
  const row = db
    .prepare(
      `SELECT id FROM messages
         WHERE kind = 'ask'
           AND from_agent = ?
           AND to_agent = ?
           AND status != 'answered'
         LIMIT 1`,
    )
    .get(from, to) as { id: number } | undefined;
  return Boolean(row);
}

export async function ask(opts: AskOptions): Promise<Message> {
  const timeout_s = Math.min(opts.timeout_s ?? 60, MAX_ASK_TIMEOUT_S);

  if (hasPendingAsk(opts.to, opts.from)) {
    throw new BusError(
      "ASK_CYCLE",
      `'${opts.to}' already has a pending ask to '${opts.from}'; would deadlock`,
    );
  }

  const asked = send({
    from: opts.from,
    to: opts.to,
    content: opts.question,
    kind: "ask",
    thread_id: opts.thread_id,
  });

  const deadline = now() + timeout_s * 1000;
  const db = getDb();
  const stmt = db.prepare(
    `SELECT * FROM messages WHERE reply_to = ? AND kind = 'reply' LIMIT 1`,
  );

  while (now() < deadline) {
    const reply = stmt.get(asked.id) as MessageRow | undefined;
    if (reply) return toMessage(reply);
    await sleep(POLL_INTERVAL_MS);
  }

  throw new BusError(
    "ASK_TIMEOUT",
    `no reply from '${opts.to}' within ${timeout_s}s (ask_id=${asked.id})`,
  );
}

export interface ReplyOptions {
  from: string;
  ask_id: number;
  answer: string;
}

export function reply(opts: ReplyOptions): Message {
  const db = getDb();
  const askRow = db
    .prepare("SELECT * FROM messages WHERE id = ? AND kind = 'ask'")
    .get(opts.ask_id) as MessageRow | undefined;
  if (!askRow) {
    throw new BusError("ASK_NOT_FOUND", `no ask with id ${opts.ask_id}`);
  }
  if (askRow.to_agent !== opts.from) {
    throw new BusError(
      "INVALID_INPUT",
      `ask ${opts.ask_id} is addressed to '${askRow.to_agent}', not '${opts.from}'`,
    );
  }

  const threadId = askRow.thread_id ?? newThreadId();
  const replier = requireAgent(opts.from);
  const replyMsg = insertMessage(
    {
      from: opts.from,
      to: askRow.from_agent,
      content: opts.answer,
      kind: "reply",
      reply_to: askRow.id,
      thread_id: threadId,
    },
    threadId,
    replier.project,
    replier.area,
  );
  heartbeat(opts.from);

  db.prepare(
    "UPDATE messages SET status = 'answered', replied_at = ? WHERE id = ?",
  ).run(now(), askRow.id);

  return replyMsg;
}

export interface AskBestOptions {
  from: string;
  capability: string;
  question: string;
  timeout_s?: number;
  thread_id?: string;
  project?: string;
  area?: string;
  role?: AgentRole;
}

export async function askBest(opts: AskBestOptions): Promise<Message> {
  validateName(opts.from);
  const asker = requireAgent(opts.from);

  // Resolve scope: explicit > asker metadata. "*" means no filter on that dimension.
  const projectScope = opts.project !== undefined ? opts.project : asker.project;
  const areaScope = opts.area !== undefined ? opts.area : asker.area;
  if (projectScope !== null && projectScope !== PROJECT_WILDCARD) validateProject(projectScope);
  if (areaScope !== null && areaScope !== AREA_WILDCARD) validateArea(areaScope);
  validateRole(opts.role);

  const db = getDb();
  const ts = now();
  const rows = db
    .prepare(
      `SELECT * FROM agents
         WHERE name != ?
         ORDER BY last_seen DESC`,
    )
    .all(opts.from) as AgentRow[];

  const all = rows
    .map(toAgent)
    .filter((a) => !a.paused && a.capabilities.includes(opts.capability));

  const scoped = all.filter((a) => {
    const projectOk =
      projectScope === null ||
      projectScope === PROJECT_WILDCARD ||
      a.project === projectScope ||
      a.project === null;
    const areaOk =
      areaScope === null ||
      areaScope === AREA_WILDCARD ||
      a.area === areaScope;
    const roleOk = opts.role === undefined || a.role === opts.role;
    return projectOk && areaOk && roleOk;
  }).sort((a, b) => {
    const weightDiff = b.routing_weight - a.routing_weight;
    if (weightDiff !== 0) return weightDiff;
    return b.last_seen - a.last_seen;
  });

  if (scoped.length === 0) {
    const scopedParts = [
      projectScope !== null && projectScope !== PROJECT_WILDCARD ? `project '${projectScope}'` : null,
      areaScope !== null && areaScope !== AREA_WILDCARD ? `area '${areaScope}'` : null,
      opts.role !== undefined ? `role '${opts.role}'` : null,
    ].filter(Boolean);
    const scopeText = scopedParts.length > 0 ? ` in ${scopedParts.join(", ")}` : "";
    const hintParts = [
      projectScope !== null && projectScope !== PROJECT_WILDCARD ? `project="${PROJECT_WILDCARD}"` : null,
      areaScope !== null && areaScope !== AREA_WILDCARD ? `area="${AREA_WILDCARD}"` : null,
    ].filter(Boolean);
    const hint =
      hintParts.length > 0
        ? `; pass ${hintParts.join(" and ")} to search more broadly`
        : "";
    throw new BusError(
      "UNKNOWN_AGENT",
      `no active agent with capability '${opts.capability}'${scopeText}${hint}`,
    );
  }

  const target = scoped[0]!;
  const recencyMs = ts - target.last_seen;
  if (recencyMs > 5 * 60_000) {
    throw new BusError(
      "UNKNOWN_AGENT",
      `best match '${target.name}' is stale (last seen ${Math.round(recencyMs / 1000)}s ago); no active agent for capability '${opts.capability}'`,
    );
  }

  return ask({
    from: opts.from,
    to: target.name,
    question: opts.question,
    timeout_s: opts.timeout_s,
    thread_id: opts.thread_id,
  });
}

export interface SubscribeOptions {
  agent: string;
  channel: string;
}

export function subscribe(opts: SubscribeOptions): Subscription {
  validateName(opts.agent);
  validateChannel(opts.channel);
  requireAgent(opts.agent);

  const db = getDb();
  const ts = now();
  db.prepare(
    `INSERT INTO subscriptions (channel, agent, subscribed_at)
       VALUES (?, ?, ?)
     ON CONFLICT(channel, agent) DO UPDATE SET subscribed_at = excluded.subscribed_at`,
  ).run(opts.channel, opts.agent, ts);

  return { channel: opts.channel, agent: opts.agent, subscribed_at: ts };
}

export function unsubscribe(opts: SubscribeOptions): void {
  validateName(opts.agent);
  validateChannel(opts.channel);
  getDb()
    .prepare("DELETE FROM subscriptions WHERE channel = ? AND agent = ?")
    .run(opts.channel, opts.agent);
}

export function subscribers(channel: string): string[] {
  validateChannel(channel);
  const rows = getDb()
    .prepare("SELECT agent FROM subscriptions WHERE channel = ? ORDER BY agent")
    .all(channel) as { agent: string }[];
  return rows.map((r) => r.agent);
}

export interface SendChannelOptions {
  from: string;
  channel: string;
  content: string;
  thread_id?: string;
}

export function sendChannel(opts: SendChannelOptions): Message[] {
  validateName(opts.from);
  validateChannel(opts.channel);
  if (typeof opts.content !== "string") {
    throw new BusError("INVALID_INPUT", "content must be a string");
  }
  const sender = requireAgent(opts.from);
  heartbeat(opts.from);

  const recipients = subscribers(opts.channel).filter((a) => a !== opts.from);
  if (recipients.length === 0) return [];

  const threadId = opts.thread_id ?? newThreadId();
  const out: Message[] = [];
  for (const recipient of recipients) {
    out.push(
      insertMessage(
        {
          from: opts.from,
          to: recipient,
          content: opts.content,
          kind: "msg",
          channel: opts.channel,
          thread_id: threadId,
        },
        threadId,
        sender.project,
        sender.area,
      ),
    );
  }
  return out;
}

export function setPaused(name: string, paused: boolean): void {
  requireAgent(name);
  getDb()
    .prepare("UPDATE agents SET paused = ? WHERE name = ?")
    .run(paused ? 1 : 0, name);
}

export function setAgentStatus(name: string, status: AgentStatus): Agent {
  validateName(name);
  validateAgentStatus(status);
  requireAgent(name);
  getDb()
    .prepare("UPDATE agents SET status = ?, last_seen = ? WHERE name = ?")
    .run(status, now(), name);
  return requireAgent(name);
}

export function sleepAgent(name: string): Agent {
  return setAgentStatus(name, "sleeping");
}

export function wakeAgent(name: string): Agent {
  return setAgentStatus(name, "idle");
}

export interface RecentMessagesOptions {
  limit?: number;
  project?: string;
  area?: string;
}

export function recentMessages(arg: number | RecentMessagesOptions = 100): Message[] {
  const opts: RecentMessagesOptions = typeof arg === "number" ? { limit: arg } : arg;
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000);

  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
    where.push("(project = ? OR project IS NULL)");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    validateArea(opts.area);
    where.push("(area = ? OR area IS NULL)");
    params.push(opts.area);
  }
  const rows = db
    .prepare(
      `SELECT * FROM messages${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as MessageRow[];
  return rows.reverse().map(toMessage);
}

export function messagesSince(id: number, limit = 100, project?: string, area?: string): Message[] {
  const boundedLimit = Math.min(Math.max(limit, 1), 1000);
  const where: string[] = ["id > ?"];
  const params: unknown[] = [id];
  if (project !== undefined && project !== PROJECT_WILDCARD) {
    validateProject(project);
    where.push("(project = ? OR project IS NULL)");
    params.push(project);
  }
  if (area !== undefined && area !== AREA_WILDCARD) {
    validateArea(area);
    where.push("(area = ? OR area IS NULL)");
    params.push(area);
  }

  const rows = getDb()
    .prepare(`SELECT * FROM messages WHERE ${where.join(" AND ")} ORDER BY id ASC LIMIT ?`)
    .all(...params, boundedLimit) as MessageRow[];
  return rows.map(toMessage);
}

export function threadMessages(threadId: string, limit = 200): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC LIMIT ?")
    .all(threadId, Math.min(Math.max(limit, 1), 1000)) as MessageRow[];
  return rows.map(toMessage);
}

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

export type TaskState =
  | "open"
  | "claimed"
  | "working"
  | "blocked"
  | "completed"
  | "failed"
  | "canceled";

export const TERMINAL_TASK_STATES: TaskState[] = ["completed", "failed", "canceled"];

export interface Task {
  id: number;
  title: string;
  description: string | null;
  thread_id: string;
  requested_by: string;
  claimed_by: string | null;
  state: TaskState;
  priority: number;
  cwd: string | null;
  blocked_reason: string | null;
  blocked_on_task_id: number | null;
  result: string | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  finished_at: number | null;
  project: string | null;
  area: string | null;
  required_capability: string | null;
  mode: TaskMode;
  expected_output: string | null;
  deadline_at: number | null;
  checkin_at: number | null;
  final_answer: string | null;
  manager_reviewed: boolean;
  file_scope: string[];
  stale?: boolean;
}

interface TaskRow {
  id: number;
  title: string;
  description: string | null;
  thread_id: string;
  requested_by: string;
  claimed_by: string | null;
  state: TaskState;
  priority: number;
  cwd: string | null;
  blocked_reason: string | null;
  blocked_on_task_id: number | null;
  result: string | null;
  created_at: number;
  updated_at: number;
  claimed_at: number | null;
  finished_at: number | null;
  project: string | null;
  area: string | null;
  required_capability: string | null;
  mode: TaskMode;
  expected_output: string | null;
  deadline_at: number | null;
  checkin_at: number | null;
  final_answer: string | null;
  manager_reviewed: number;
  file_scope: string;
}

function readTaskStaleThresholdMs(): number {
  const raw = process.env.AGENT_BUS_TASK_STALE_MS;
  if (!raw) return 5 * 60 * 1000;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1000) return 5 * 60 * 1000;
  return parsed;
}

export const TASK_STALE_THRESHOLD_MS = readTaskStaleThresholdMs();

const ACTIVE_TASK_STATES: TaskState[] = ["claimed", "working", "blocked"];

// Exported so tests and tooling can mirror the state machine without
// re-declaring it. Terminal states (completed/failed/canceled) have no
// successors. `claimed -> open` exists for releaseTask-style flows.
export const ALLOWED_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  open: ["claimed", "canceled"],
  claimed: ["working", "open", "canceled", "failed"],
  working: ["blocked", "completed", "failed", "canceled"],
  blocked: ["working", "completed", "failed", "canceled"],
  completed: [],
  failed: [],
  canceled: [],
};

function toTask(row: TaskRow, lastSeenByAgent?: Map<string, number>): Task {
  const task: Task = {
    id: row.id,
    title: row.title,
    description: row.description,
    thread_id: row.thread_id,
    requested_by: row.requested_by,
    claimed_by: row.claimed_by,
    state: row.state,
    priority: row.priority,
    cwd: row.cwd,
    blocked_reason: row.blocked_reason,
    blocked_on_task_id: row.blocked_on_task_id,
    result: row.result,
    created_at: row.created_at,
    updated_at: row.updated_at,
    claimed_at: row.claimed_at,
    finished_at: row.finished_at,
    project: row.project,
    area: row.area,
    required_capability: row.required_capability,
    mode: row.mode,
    expected_output: row.expected_output,
    deadline_at: row.deadline_at,
    checkin_at: row.checkin_at,
    final_answer: row.final_answer,
    manager_reviewed: row.manager_reviewed === 1,
    file_scope: JSON.parse(row.file_scope) as string[],
  };
  if (
    lastSeenByAgent &&
    row.claimed_by &&
    ACTIVE_TASK_STATES.includes(row.state)
  ) {
    const lastSeen = lastSeenByAgent.get(row.claimed_by);
    if (lastSeen !== undefined) {
      task.stale = now() - lastSeen > TASK_STALE_THRESHOLD_MS;
    }
  }
  return task;
}

function lastSeenMap(): Map<string, number> {
  const rows = getDb()
    .prepare("SELECT name, last_seen FROM agents")
    .all() as { name: string; last_seen: number }[];
  return new Map(rows.map((r) => [r.name, r.last_seen]));
}

function getTaskRow(id: number): TaskRow {
  const row = getDb()
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .get(id) as TaskRow | undefined;
  if (!row) throw new BusError("TASK_NOT_FOUND", `no task with id ${id}`);
  return row;
}

export interface CreateTaskOptions {
  requested_by: string;
  title: string;
  description?: string;
  thread_id?: string;
  priority?: number;
  cwd?: string;
  blocked_on_task_id?: number;
  project?: string | null;
  area?: string | null;
  required_capability?: string | null;
  mode?: TaskMode;
  expected_output?: string | null;
  deadline_at?: number | null;
  checkin_at?: number | null;
  final_answer?: string | null;
  manager_reviewed?: boolean;
  file_scope?: string[];
}

export function createTask(opts: CreateTaskOptions): Task {
  validateName(opts.requested_by);
  if (typeof opts.title !== "string" || opts.title.length === 0 || opts.title.length > 200) {
    throw new BusError("INVALID_INPUT", "title must be 1-200 chars");
  }
  if (opts.description !== undefined && typeof opts.description !== "string") {
    throw new BusError("INVALID_INPUT", "description must be a string");
  }
  if (opts.priority !== undefined && !Number.isFinite(opts.priority)) {
    throw new BusError("INVALID_INPUT", "priority must be a number");
  }
  validateProject(opts.project);
  validateArea(opts.area);
  validateTaskMode(opts.mode);
  if (opts.required_capability !== undefined && opts.required_capability !== null && opts.required_capability.length === 0) {
    throw new BusError("INVALID_INPUT", "required_capability must be non-empty or null");
  }
  if (opts.file_scope !== undefined && !opts.file_scope.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "file_scope must be an array of strings");
  }
  const requester = requireAgent(opts.requested_by);
  heartbeat(opts.requested_by);

  const db = getDb();
  if (opts.blocked_on_task_id !== undefined) {
    const exists = db
      .prepare("SELECT 1 FROM tasks WHERE id = ?")
      .get(opts.blocked_on_task_id);
    if (!exists) {
      throw new BusError(
        "TASK_NOT_FOUND",
        `blocked_on_task_id ${opts.blocked_on_task_id} does not exist`,
      );
    }
  }

  const ts = now();
  const threadId = opts.thread_id ?? newThreadId();
  const project = opts.project !== undefined ? opts.project : requester.project;
  const area = opts.area !== undefined ? opts.area : requester.area;
  const requiredCapability = opts.required_capability ?? null;
  const mode = opts.mode ?? "edit_files";
  const fileScope = JSON.stringify(opts.file_scope ?? []);
  const info = db
    .prepare(
      `INSERT INTO tasks
         (title, description, thread_id, requested_by, state, priority, cwd, blocked_on_task_id, created_at, updated_at, project, area, required_capability, mode, expected_output, deadline_at, checkin_at, final_answer, manager_reviewed, file_scope)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.title,
      opts.description ?? null,
      threadId,
      opts.requested_by,
      opts.priority ?? 0,
      opts.cwd ?? null,
      opts.blocked_on_task_id ?? null,
      ts,
      ts,
      project,
      area,
      requiredCapability,
      mode,
      opts.expected_output ?? null,
      opts.deadline_at ?? null,
      opts.checkin_at ?? null,
      opts.final_answer ?? null,
      opts.manager_reviewed === true ? 1 : 0,
      fileScope,
    );

  const task = toTask(getTaskRow(info.lastInsertRowid as number));
  runLocalHook("task.created", task);
  return task;
}

export interface ClaimTaskOptions {
  agent: string;
  task_id: number;
}

export function claimTask(opts: ClaimTaskOptions): Task {
  validateName(opts.agent);
  const agent = requireAgent(opts.agent);
  heartbeat(opts.agent);

  const db = getDb();
  const row = getTaskRow(opts.task_id);
  if (row.required_capability !== null && !agent.capabilities.includes(row.required_capability)) {
    throw new BusError(
      "TASK_FORBIDDEN",
      `task ${opts.task_id} requires capability '${row.required_capability}'`,
    );
  }
  if (row.project !== null && agent.project !== null && row.project !== agent.project) {
    throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} belongs to project '${row.project}'`);
  }
  if (row.area !== null && agent.area !== null && row.area !== agent.area) {
    throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} belongs to area '${row.area}'`);
  }
  const ts = now();
  const info = db
    .prepare(
      `UPDATE tasks
         SET state = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'open' AND claimed_by IS NULL`,
    )
    .run(opts.agent, ts, ts, opts.task_id);

  if (info.changes === 0) {
    const existing = db
      .prepare("SELECT * FROM tasks WHERE id = ?")
      .get(opts.task_id) as TaskRow | undefined;
    if (!existing) throw new BusError("TASK_NOT_FOUND", `no task with id ${opts.task_id}`);
    throw new BusError(
      "TASK_NOT_CLAIMABLE",
      `task ${opts.task_id} is in state '${existing.state}'${existing.claimed_by ? `, held by '${existing.claimed_by}'` : ""}`,
    );
  }

  const task = toTask(getTaskRow(opts.task_id));
  runLocalHook("task.claimed", task);
  return task;
}

export interface UpdateTaskOptions {
  agent: string;
  task_id: number;
  state?: TaskState;
  blocked_reason?: string | null;
  blocked_on_task_id?: number | null;
  result?: string | null;
  priority?: number;
  expected_output?: string | null;
  deadline_at?: number | null;
  checkin_at?: number | null;
  final_answer?: string | null;
  manager_reviewed?: boolean;
  file_scope?: string[];
  mode?: TaskMode;
}

export function updateTask(opts: UpdateTaskOptions): Task {
  validateName(opts.agent);
  requireAgent(opts.agent);
  heartbeat(opts.agent);

  const db = getDb();
  const row = getTaskRow(opts.task_id);

  if (row.claimed_by !== null && row.claimed_by !== opts.agent && row.requested_by !== opts.agent) {
    throw new BusError(
      "TASK_FORBIDDEN",
      `task ${opts.task_id} is held by '${row.claimed_by}'; only the holder or requester can update it`,
    );
  }
  if (row.claimed_by === null && row.requested_by !== opts.agent && opts.state !== undefined) {
    throw new BusError(
      "TASK_FORBIDDEN",
      `task ${opts.task_id} is unclaimed; only the requester can change state until someone claims it`,
    );
  }

  const ts = now();
  const sets: string[] = ["updated_at = ?"];
  const params: unknown[] = [ts];

  if (opts.state !== undefined) {
    const allowed = ALLOWED_TRANSITIONS[row.state];
    if (!allowed.includes(opts.state)) {
      throw new BusError(
        "TASK_INVALID_TRANSITION",
        `cannot transition task ${opts.task_id} from '${row.state}' to '${opts.state}'`,
      );
    }
    sets.push("state = ?");
    params.push(opts.state);

    if (opts.state === "open") {
      sets.push("claimed_by = NULL", "claimed_at = NULL");
    }
    if (TERMINAL_TASK_STATES.includes(opts.state)) {
      sets.push("finished_at = ?");
      params.push(ts);
    }
  }
  if (opts.blocked_reason !== undefined) {
    sets.push("blocked_reason = ?");
    params.push(opts.blocked_reason);
  }
  if (opts.blocked_on_task_id !== undefined) {
    if (opts.blocked_on_task_id !== null) {
      const exists = db
        .prepare("SELECT 1 FROM tasks WHERE id = ?")
        .get(opts.blocked_on_task_id);
      if (!exists) {
        throw new BusError(
          "TASK_NOT_FOUND",
          `blocked_on_task_id ${opts.blocked_on_task_id} does not exist`,
        );
      }
    }
    sets.push("blocked_on_task_id = ?");
    params.push(opts.blocked_on_task_id);
  }
  if (opts.result !== undefined) {
    sets.push("result = ?");
    params.push(opts.result);
  }
  if (opts.priority !== undefined) {
    if (!Number.isFinite(opts.priority)) {
      throw new BusError("INVALID_INPUT", "priority must be a number");
    }
    sets.push("priority = ?");
    params.push(opts.priority);
  }
  if (opts.mode !== undefined) {
    validateTaskMode(opts.mode);
    sets.push("mode = ?");
    params.push(opts.mode);
  }
  if (opts.expected_output !== undefined) {
    sets.push("expected_output = ?");
    params.push(opts.expected_output);
  }
  if (opts.deadline_at !== undefined) {
    sets.push("deadline_at = ?");
    params.push(opts.deadline_at);
  }
  if (opts.checkin_at !== undefined) {
    sets.push("checkin_at = ?");
    params.push(opts.checkin_at);
  }
  if (opts.final_answer !== undefined) {
    sets.push("final_answer = ?");
    params.push(opts.final_answer);
  }
  if (opts.manager_reviewed !== undefined) {
    sets.push("manager_reviewed = ?");
    params.push(opts.manager_reviewed ? 1 : 0);
  }
  if (opts.file_scope !== undefined) {
    if (!opts.file_scope.every((value) => typeof value === "string")) {
      throw new BusError("INVALID_INPUT", "file_scope must be an array of strings");
    }
    sets.push("file_scope = ?");
    params.push(JSON.stringify(opts.file_scope));
  }

  if (sets.length === 1) {
    return toTask(row);
  }

  params.push(opts.task_id);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const task = toTask(getTaskRow(opts.task_id));
  runLocalHook(`task.${task.state}`, task);
  return task;
}

export interface ReleaseTaskOptions {
  agent: string;
  task_id: number;
}

export function releaseTask(opts: ReleaseTaskOptions): Task {
  validateName(opts.agent);
  requireAgent(opts.agent);
  heartbeat(opts.agent);

  const db = getDb();
  const row = getTaskRow(opts.task_id);

  if (row.claimed_by !== opts.agent && row.requested_by !== opts.agent) {
    throw new BusError(
      "TASK_FORBIDDEN",
      `task ${opts.task_id} is held by '${row.claimed_by}'; only the holder or requester can release it`,
    );
  }
  if (TERMINAL_TASK_STATES.includes(row.state)) {
    throw new BusError(
      "TASK_INVALID_TRANSITION",
      `task ${opts.task_id} is already in terminal state '${row.state}'`,
    );
  }

  const ts = now();
  db.prepare(
    `UPDATE tasks
       SET state = 'open', claimed_by = NULL, claimed_at = NULL, updated_at = ?
     WHERE id = ?`,
  ).run(ts, opts.task_id);

  return toTask(getTaskRow(opts.task_id));
}

export interface ListTasksOptions {
  state?: TaskState | TaskState[];
  claimed_by?: string;
  requested_by?: string;
  thread_id?: string;
  include_terminal?: boolean;
  limit?: number;
  project?: string;
  area?: string;
  required_capability?: string;
  mode?: TaskMode;
  manager_reviewed?: boolean;
}

export function listTasks(opts: ListTasksOptions = {}): Task[] {
  const db = getDb();
  const where: string[] = [];
  const params: unknown[] = [];

  if (opts.state !== undefined) {
    const states = Array.isArray(opts.state) ? opts.state : [opts.state];
    if (states.length === 0) return [];
    where.push(`state IN (${states.map(() => "?").join(",")})`);
    params.push(...states);
  } else if (opts.include_terminal !== true) {
    where.push(`state NOT IN ('completed','failed','canceled')`);
  }
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
    // Scoped: only this project. NULL tasks are hidden until project='*'.
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    validateArea(opts.area);
    // Scoped: only this area. NULL-area tasks are hidden until area='*'.
    where.push("area = ?");
    params.push(opts.area);
  }
  if (opts.required_capability !== undefined) {
    where.push("required_capability = ?");
    params.push(opts.required_capability);
  }
  if (opts.mode !== undefined) {
    validateTaskMode(opts.mode);
    where.push("mode = ?");
    params.push(opts.mode);
  }
  if (opts.manager_reviewed !== undefined) {
    where.push("manager_reviewed = ?");
    params.push(opts.manager_reviewed ? 1 : 0);
  }
  if (opts.claimed_by !== undefined) {
    where.push("claimed_by = ?");
    params.push(opts.claimed_by);
  }
  if (opts.requested_by !== undefined) {
    where.push("requested_by = ?");
    params.push(opts.requested_by);
  }
  if (opts.thread_id !== undefined) {
    where.push("thread_id = ?");
    params.push(opts.thread_id);
  }

  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const sql = `SELECT * FROM tasks${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
                ORDER BY priority DESC, created_at ASC
                LIMIT ?`;
  const rows = db.prepare(sql).all(...params, limit) as TaskRow[];
  const seen = lastSeenMap();
  return rows.map((r) => toTask(r, seen));
}

export interface AssignTaskOptions {
  task_id: number;
  to_agent: string;
}

export function assignTask(opts: AssignTaskOptions): Task {
  validateName(opts.to_agent);
  const agent = requireAgent(opts.to_agent);
  const row = getTaskRow(opts.task_id);
  if (row.state !== "open" || row.claimed_by !== null) {
    throw new BusError("TASK_NOT_CLAIMABLE", `task ${opts.task_id} is in state '${row.state}'`);
  }
  if (row.required_capability !== null && !agent.capabilities.includes(row.required_capability)) {
    throw new BusError("TASK_FORBIDDEN", `agent '${opts.to_agent}' lacks capability '${row.required_capability}'`);
  }
  const ts = now();
  getDb()
    .prepare(
      `UPDATE tasks
         SET state = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'open' AND claimed_by IS NULL`,
    )
    .run(opts.to_agent, ts, ts, opts.task_id);
  heartbeat(opts.to_agent);
  const task = toTask(getTaskRow(opts.task_id));
  runLocalHook("task.claimed", task);
  return task;
}

export interface ClaimBestTaskOptions {
  agent: string;
  project?: string;
  area?: string;
}

export function claimBestTask(opts: ClaimBestTaskOptions): Task | null {
  const agent = requireAgent(opts.agent);
  heartbeat(opts.agent);
  const project = opts.project !== undefined ? opts.project : agent.project;
  const area = opts.area !== undefined ? opts.area : agent.area;
  const tasks = listTasks({
    state: "open",
    include_terminal: false,
    project: project ?? undefined,
    area: area ?? undefined,
    limit: 100,
  }).filter((task) => task.required_capability === null || agent.capabilities.includes(task.required_capability));
  const task = tasks[0];
  if (!task) return null;
  return claimTask({ agent: opts.agent, task_id: task.id });
}

export function getTask(id: number): Task {
  const row = getTaskRow(id);
  return toTask(row, lastSeenMap());
}

export function tasksUpdatedSince(timestamp: number, limit = 100): Task[] {
  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?")
    .all(timestamp, Math.min(Math.max(limit, 1), 500)) as TaskRow[];
  const seen = lastSeenMap();
  return rows.map((r) => toTask(r, seen));
}

// ---------------------------------------------------------------------------
// Decisions and reports
// ---------------------------------------------------------------------------

export interface Decision {
  id: number;
  by_agent: string;
  decision: string;
  rationale: string | null;
  implemented: boolean;
  project: string | null;
  area: string | null;
  created_at: number;
  updated_at: number;
}

interface DecisionRow {
  id: number;
  by_agent: string;
  decision: string;
  rationale: string | null;
  implemented: number;
  project: string | null;
  area: string | null;
  created_at: number;
  updated_at: number;
}

function toDecision(row: DecisionRow): Decision {
  return {
    ...row,
    implemented: row.implemented === 1,
  };
}

export interface RecordDecisionOptions {
  by_agent: string;
  decision: string;
  rationale?: string | null;
  implemented?: boolean;
  project?: string | null;
  area?: string | null;
}

export function recordDecision(opts: RecordDecisionOptions): Decision {
  validateName(opts.by_agent);
  validateProject(opts.project);
  validateArea(opts.area);
  const agent = requireAgent(opts.by_agent);
  if (opts.decision.trim().length === 0) {
    throw new BusError("INVALID_INPUT", "decision must be non-empty");
  }
  const ts = now();
  const project = opts.project !== undefined ? opts.project : agent.project;
  const area = opts.area !== undefined ? opts.area : agent.area;
  const info = getDb()
    .prepare(
      `INSERT INTO decisions
         (by_agent, decision, rationale, implemented, project, area, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.by_agent,
      opts.decision,
      opts.rationale ?? null,
      opts.implemented === true ? 1 : 0,
      project,
      area,
      ts,
      ts,
    );
  return toDecision(
    getDb().prepare("SELECT * FROM decisions WHERE id = ?").get(info.lastInsertRowid as number) as DecisionRow,
  );
}

export interface ListDecisionsOptions {
  project?: string;
  area?: string;
  implemented?: boolean;
  limit?: number;
}

export function listDecisions(opts: ListDecisionsOptions = {}): Decision[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
    where.push("(project = ? OR project IS NULL)");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    validateArea(opts.area);
    where.push("(area = ? OR area IS NULL)");
    params.push(opts.area);
  }
  if (opts.implemented !== undefined) {
    where.push("implemented = ?");
    params.push(opts.implemented ? 1 : 0);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT * FROM decisions${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as DecisionRow[];
  return rows.reverse().map(toDecision);
}

export interface Memory {
  id: number;
  by_agent: string;
  agent: string | null;
  kind: MemoryKind;
  content: string;
  project: string | null;
  area: string | null;
  task_id: number | null;
  thread_id: string | null;
  pinned: boolean;
  supersedes_id: number | null;
  created_at: number;
  updated_at: number;
}

interface MemoryRow {
  id: number;
  by_agent: string;
  agent: string | null;
  kind: MemoryKind;
  content: string;
  project: string | null;
  area: string | null;
  task_id: number | null;
  thread_id: string | null;
  pinned: number;
  supersedes_id: number | null;
  created_at: number;
  updated_at: number;
}

function toMemory(row: MemoryRow): Memory {
  return {
    ...row,
    pinned: row.pinned === 1,
  };
}

export interface RememberOptions {
  by_agent: string;
  kind: MemoryKind;
  content: string;
  agent?: string | null;
  project?: string | null;
  area?: string | null;
  task_id?: number | null;
  thread_id?: string | null;
  pinned?: boolean;
  supersedes_id?: number | null;
}

export function remember(opts: RememberOptions): Memory {
  validateName(opts.by_agent);
  validateMemoryKind(opts.kind);
  validateProject(opts.project);
  validateArea(opts.area);
  const byAgent = requireAgent(opts.by_agent);
  if (opts.agent !== undefined && opts.agent !== null) validateName(opts.agent);
  if (opts.content.trim().length === 0) {
    throw new BusError("INVALID_INPUT", "content must be non-empty");
  }
  if (opts.task_id !== undefined && opts.task_id !== null) {
    getTaskRow(opts.task_id);
  }
  if (opts.supersedes_id !== undefined && opts.supersedes_id !== null) {
    const exists = getDb()
      .prepare("SELECT 1 FROM memories WHERE id = ?")
      .get(opts.supersedes_id);
    if (!exists) throw new BusError("INVALID_INPUT", `supersedes_id ${opts.supersedes_id} does not exist`);
  }
  const ts = now();
  const project = opts.project !== undefined ? opts.project : byAgent.project;
  const area = opts.area !== undefined ? opts.area : byAgent.area;
  const info = getDb()
    .prepare(
      `INSERT INTO memories
         (by_agent, agent, kind, content, project, area, task_id, thread_id, pinned, supersedes_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.by_agent,
      opts.agent ?? null,
      opts.kind,
      opts.content,
      project,
      area,
      opts.task_id ?? null,
      opts.thread_id ?? null,
      opts.pinned === true ? 1 : 0,
      opts.supersedes_id ?? null,
      ts,
      ts,
    );
  return toMemory(
    getDb().prepare("SELECT * FROM memories WHERE id = ?").get(info.lastInsertRowid as number) as MemoryRow,
  );
}

export interface ListMemoriesOptions {
  project?: string;
  area?: string;
  agent?: string;
  kind?: MemoryKind;
  task_id?: number;
  thread_id?: string;
  pinned?: boolean;
  since?: number;
  limit?: number;
}

export function listMemories(opts: ListMemoriesOptions = {}): Memory[] {
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
    where.push("(project = ? OR project IS NULL)");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    validateArea(opts.area);
    where.push("(area = ? OR area IS NULL)");
    params.push(opts.area);
  }
  if (opts.agent !== undefined) {
    validateName(opts.agent);
    where.push("(agent = ? OR by_agent = ?)");
    params.push(opts.agent, opts.agent);
  }
  if (opts.kind !== undefined) {
    validateMemoryKind(opts.kind);
    where.push("kind = ?");
    params.push(opts.kind);
  }
  if (opts.task_id !== undefined) {
    where.push("task_id = ?");
    params.push(opts.task_id);
  }
  if (opts.thread_id !== undefined) {
    where.push("thread_id = ?");
    params.push(opts.thread_id);
  }
  if (opts.pinned !== undefined) {
    where.push("pinned = ?");
    params.push(opts.pinned ? 1 : 0);
  }
  if (opts.since !== undefined) {
    where.push("created_at >= ?");
    params.push(opts.since);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = getDb()
    .prepare(
      `SELECT * FROM memories${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
         ORDER BY id DESC
         LIMIT ?`,
    )
    .all(...params, limit) as MemoryRow[];
  return rows.reverse().map(toMemory);
}

export function pinMemory(id: number, pinned: boolean): Memory {
  const ts = now();
  const info = getDb()
    .prepare("UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?")
    .run(pinned ? 1 : 0, ts, id);
  if (info.changes === 0) {
    throw new BusError("INVALID_INPUT", `memory ${id} does not exist`);
  }
  return toMemory(getDb().prepare("SELECT * FROM memories WHERE id = ?").get(id) as MemoryRow);
}

export interface SessionBriefOptions {
  project?: string;
  area?: string;
  agent?: string;
  limit?: number;
}

export interface SessionBrief {
  project: string | null;
  area: string | null;
  agent: string | null;
  active_agents: AgentDirectoryEntry[];
  open_tasks: Task[];
  blocked_tasks: Task[];
  stale_tasks: Task[];
  recent_decisions: Decision[];
  pinned_memories: Memory[];
  recent_memories: Memory[];
  recent_messages: Message[];
  suggested_next_actions: string[];
}

export function sessionBrief(opts: SessionBriefOptions = {}): SessionBrief {
  if (opts.agent !== undefined) validateName(opts.agent);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const scope = { project: opts.project, area: opts.area };
  const activeAgents = directory(scope).filter((agent) => agent.presence !== "stale");
  const tasks = listTasks({ ...scope, include_terminal: false, limit: 500 });
  const openTasks = tasks.filter((task) => task.state === "open").slice(0, limit);
  const blockedTasks = tasks.filter((task) => task.state === "blocked").slice(0, limit);
  const staleTasks = tasks.filter((task) => task.stale === true).slice(0, limit);
  const recentDecisions = listDecisions({ ...scope, limit });
  const pinnedMemories = listMemories({ ...scope, agent: opts.agent, pinned: true, limit: 10 });
  const recentMemories = listMemories({ ...scope, agent: opts.agent, pinned: false, limit });
  const recent = recentMessages({ ...scope, limit });
  const suggested: string[] = [];
  if (blockedTasks.length > 0) suggested.push("Review blocked tasks and record the unblocker or release/reassign ownership.");
  if (staleTasks.length > 0) suggested.push("Check stale task holders before continuing or reassigning their work.");
  if (openTasks.length > 0) suggested.push("Assign or claim the highest-priority open task with an explicit mode and file scope.");
  if (pinnedMemories.length === 0 && recentMemories.length === 0) suggested.push("Record a handoff, risk, or todo memory before ending the session.");
  if (activeAgents.length === 0) suggested.push("Register or wake the agents needed for this project/area.");

  return {
    project: opts.project ?? null,
    area: opts.area ?? null,
    agent: opts.agent ?? null,
    active_agents: activeAgents.slice(0, limit),
    open_tasks: openTasks,
    blocked_tasks: blockedTasks,
    stale_tasks: staleTasks,
    recent_decisions: recentDecisions,
    pinned_memories: pinnedMemories,
    recent_memories: recentMemories,
    recent_messages: recent,
    suggested_next_actions: suggested,
  };
}

export interface FinalReport {
  implemented: string[];
  not_implemented: string[];
  known_risks: string[];
  tests_passed: string[];
  manual_tests_needed: string[];
  safe_to_commit: boolean;
  safe_to_push: boolean;
  safe_to_deploy: false;
}

export function finalReport(opts: ListTasksOptions = {}): FinalReport {
  const tasks = listTasks({ ...opts, include_terminal: true, limit: opts.limit ?? 500 });
  const implemented = tasks
    .filter((task) => task.state === "completed")
    .map((task) => task.title);
  const notImplemented = tasks
    .filter((task) => task.state !== "completed" && task.state !== "canceled")
    .map((task) => task.title);
  const knownRisks = tasks
    .filter((task) => task.blocked_reason !== null || task.state === "failed" || task.stale === true)
    .map((task) => `#${task.id} ${task.title}${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
  const testsPassed = tasks
    .filter((task) => task.mode === "test_only" && task.state === "completed")
    .map((task) => task.final_answer ?? task.result ?? task.title);
  const manualTestsNeeded = tasks
    .filter((task) => task.state !== "completed" || task.manager_reviewed === false)
    .map((task) => task.title);
  const safe = notImplemented.length === 0 && knownRisks.length === 0 && manualTestsNeeded.length === 0;
  return {
    implemented,
    not_implemented: notImplemented,
    known_risks: knownRisks,
    tests_passed: testsPassed,
    manual_tests_needed: manualTestsNeeded,
    safe_to_commit: safe,
    safe_to_push: safe,
    safe_to_deploy: false,
  };
}
