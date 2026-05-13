import { getDb } from "./db.js";
import { BusError } from "./util/errors.js";
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

export interface Agent {
  name: string;
  capabilities: string[];
  registered_at: number;
  last_seen: number;
  paused: boolean;
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
}

function toAgent(row: AgentRow): Agent {
  return {
    name: row.name,
    capabilities: JSON.parse(row.capabilities) as string[],
    registered_at: row.registered_at,
    last_seen: row.last_seen,
    paused: row.paused === 1,
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
  };
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
}

export function register(opts: RegisterOptions): Agent {
  validateName(opts.name);
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

  db.prepare(
    `INSERT INTO agents (name, capabilities, registered_at, last_seen, paused)
       VALUES (@name, @capabilities, @ts, @ts, 0)
     ON CONFLICT(name) DO UPDATE SET
       capabilities = excluded.capabilities,
       registered_at = excluded.registered_at,
       last_seen = excluded.last_seen,
       paused = 0`,
  ).run({ name: opts.name, capabilities: JSON.stringify(caps), ts });

  return requireAgent(opts.name);
}

export function heartbeat(name: string): void {
  const db = getDb();
  db.prepare("UPDATE agents SET last_seen = ? WHERE name = ?").run(now(), name);
}

export function whois(): Agent[] {
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM agents ORDER BY last_seen DESC")
    .all() as AgentRow[];
  return rows.map(toAgent);
}

export interface SendOptions {
  from: string;
  to: string;
  content: string;
  kind?: MessageKind;
  reply_to?: number;
  thread_id?: string;
  channel?: string | null;
}

function insertMessage(opts: SendOptions, threadId: string): Message {
  const db = getDb();
  const ts = now();
  const info = db
    .prepare(
      `INSERT INTO messages
         (from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, channel)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
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
    );

  const row = db
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(info.lastInsertRowid as number) as MessageRow;
  return toMessage(row);
}

export function send(opts: SendOptions): Message {
  validateName(opts.from);
  validateName(opts.to);
  if (typeof opts.content !== "string") {
    throw new BusError("INVALID_INPUT", "content must be a string");
  }
  requireAgent(opts.from);
  requireAgent(opts.to);
  heartbeat(opts.from);
  return insertMessage(opts, opts.thread_id ?? newThreadId());
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
         ORDER BY id ASC
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
}

export async function askBest(opts: AskBestOptions): Promise<Message> {
  validateName(opts.from);
  requireAgent(opts.from);

  const db = getDb();
  const ts = now();
  const rows = db
    .prepare(
      `SELECT * FROM agents
         WHERE name != ?
         ORDER BY last_seen DESC`,
    )
    .all(opts.from) as AgentRow[];

  const candidates = rows
    .map(toAgent)
    .filter((a) => !a.paused && a.capabilities.includes(opts.capability));

  if (candidates.length === 0) {
    throw new BusError(
      "UNKNOWN_AGENT",
      `no registered agent has capability '${opts.capability}'`,
    );
  }

  const target = candidates[0]!;
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
  requireAgent(opts.from);
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

export function recentMessages(limit = 100): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages ORDER BY id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 1000)) as MessageRow[];
  return rows.reverse().map(toMessage);
}

export function messagesSince(id: number, limit = 100): Message[] {
  const rows = getDb()
    .prepare("SELECT * FROM messages WHERE id > ? ORDER BY id ASC LIMIT ?")
    .all(id, Math.min(Math.max(limit, 1), 1000)) as MessageRow[];
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
  requireAgent(opts.requested_by);
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
  const info = db
    .prepare(
      `INSERT INTO tasks
         (title, description, thread_id, requested_by, state, priority, cwd, blocked_on_task_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?)`,
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
    );

  return toTask(getTaskRow(info.lastInsertRowid as number));
}

export interface ClaimTaskOptions {
  agent: string;
  task_id: number;
}

export function claimTask(opts: ClaimTaskOptions): Task {
  validateName(opts.agent);
  requireAgent(opts.agent);
  heartbeat(opts.agent);

  const db = getDb();
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

  return toTask(getTaskRow(opts.task_id));
}

export interface UpdateTaskOptions {
  agent: string;
  task_id: number;
  state?: TaskState;
  blocked_reason?: string | null;
  blocked_on_task_id?: number | null;
  result?: string | null;
  priority?: number;
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

  if (sets.length === 1) {
    return toTask(row);
  }

  params.push(opts.task_id);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  return toTask(getTaskRow(opts.task_id));
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
