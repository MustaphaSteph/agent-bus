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
export type TaskReviewState = "none" | "pending" | "approved" | "changes_requested";
export type TaskAckResponse = "claimed" | "declined" | "blocked";
export type TestResultStatus = "passed" | "failed" | "skipped";
export type TaskEventType = "note" | "phase" | "progress" | "log" | "result" | "cancel";

export const PROJECT_WILDCARD = "*";
export const AREA_WILDCARD = PROJECT_WILDCARD;
export const TEAM_WILDCARD = PROJECT_WILDCARD;

export interface Agent {
  name: string;
  capabilities: string[];
  registered_at: number;
  last_seen: number;
  paused: boolean;
  project: string | null;
  area: string | null;
  team: string | null;
  role: AgentRole | null;
  routing_weight: number;
  status: AgentStatus;
  session_id: string | null;
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
  team: string | null;
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
  team: string | null;
  role: AgentRole | null;
  routing_weight: number;
  status: AgentStatus;
  session_id: string | null;
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
  team: string | null;
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
    team: row.team,
    role: row.role,
    routing_weight: row.routing_weight,
    status: row.status,
    session_id: row.session_id,
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
    team: row.team,
    priority: row.priority,
  };
}

function getMessageRow(id: number): MessageRow {
  const row = getDb()
    .prepare("SELECT * FROM messages WHERE id = ?")
    .get(id) as MessageRow | undefined;
  if (!row) throw new BusError("MESSAGE_NOT_FOUND", `no message with id ${id}`);
  return row;
}

function validateScopeName(kind: "project" | "area" | "team" | "role", value: string | null | undefined): void {
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
  if (area === AREA_WILDCARD) return;
  validateScopeName("area", area);
}

function validateTeam(team: string | null | undefined): void {
  if (team === TEAM_WILDCARD) return;
  validateScopeName("team", team);
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

function validateReviewState(state: TaskReviewState | undefined): void {
  if (state === undefined) return;
  if (!["none", "pending", "approved", "changes_requested"].includes(state)) {
    throw new BusError("INVALID_INPUT", "review_state must be none, pending, approved, or changes_requested");
  }
}

function validateTestResultStatus(status: TestResultStatus | undefined): void {
  if (status === undefined) return;
  if (!["passed", "failed", "skipped"].includes(status)) {
    throw new BusError("INVALID_INPUT", "status must be passed, failed, or skipped");
  }
}

function validateTaskEventType(eventType: TaskEventType | undefined): void {
  if (eventType === undefined) return;
  if (!["note", "phase", "progress", "log", "result", "cancel"].includes(eventType)) {
    throw new BusError("INVALID_INPUT", "event_type must be note, phase, progress, log, result, or cancel");
  }
}

function validateSessionId(sessionId: string | null | undefined): void {
  if (sessionId === undefined || sessionId === null) return;
  if (typeof sessionId !== "string" || sessionId.length === 0 || sessionId.length > 128) {
    throw new BusError("INVALID_INPUT", "session_id must be 1-128 chars");
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
  team?: string | null;
  role?: AgentRole | null;
  routing_weight?: number;
  status?: AgentStatus;
  session_id?: string | null;
}

export function register(opts: RegisterOptions): Agent {
  validateName(opts.name);
  validateProject(opts.project);
  validateArea(opts.area);
  validateTeam(opts.team);
  validateRole(opts.role);
  validateAgentStatus(opts.status);
  validateSessionId(opts.session_id);
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
  const team = opts.team ?? null;
  const role = opts.role ?? null;
  const routingWeight = Math.trunc(opts.routing_weight ?? 0);
  const status = opts.status ?? "idle";
  const sessionId = opts.session_id ?? null;
  db.prepare(
    `INSERT INTO agents (name, capabilities, registered_at, last_seen, paused, project, area, team, role, routing_weight, status, session_id)
       VALUES (@name, @capabilities, @ts, @ts, 0, @project, @area, @team, @role, @routingWeight, @status, @sessionId)
     ON CONFLICT(name) DO UPDATE SET
       capabilities = excluded.capabilities,
       registered_at = excluded.registered_at,
       last_seen = excluded.last_seen,
       paused = 0,
       project = excluded.project,
       area = excluded.area,
       team = excluded.team,
       role = excluded.role,
       routing_weight = excluded.routing_weight,
       status = excluded.status,
       session_id = excluded.session_id`,
  ).run({ name: opts.name, capabilities: JSON.stringify(caps), ts, project, area, team, role, routingWeight, status, sessionId });

  const agent = requireAgent(opts.name);
  notifyPendingAssignments(agent.name);
  return agent;
}

function notifyPendingAssignments(name: string): void {
  const rows = getDb()
    .prepare("SELECT * FROM tasks WHERE pending_assignee = ? AND state = 'open' ORDER BY priority DESC, created_at ASC LIMIT 50")
    .all(name) as TaskRow[];
  for (const row of rows) {
    send({
      from: row.requested_by,
      to: name,
      content: `pending assignment task #${row.id}: ${row.title}. Claim with claim_task then acknowledge_task.`,
      thread_id: row.thread_id,
    });
  }
}

export function heartbeat(name: string): void {
  const db = getDb();
  db.prepare("UPDATE agents SET last_seen = ? WHERE name = ?").run(now(), name);
}

export interface WhoisOptions {
  project?: string;
  area?: string;
  team?: string;
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
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    validateTeam(opts.team);
    where.push("team = ?");
    params.push(opts.team);
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

export interface WaitForAgentsOptions extends WhoisOptions {
  names: string[];
  timeout_s?: number;
}

export interface WaitForAgentsResult {
  ready: AgentDirectoryEntry[];
  missing: string[];
  stale: AgentDirectoryEntry[];
  wrong_scope: Array<{
    name: string;
    project: string | null;
    area: string | null;
    team: string | null;
    expected_project: string | null;
    expected_area: string | null;
    expected_team: string | null;
  }>;
}

export async function waitForAgents(opts: WaitForAgentsOptions): Promise<WaitForAgentsResult> {
  if (!Array.isArray(opts.names) || opts.names.length === 0) {
    throw new BusError("INVALID_INPUT", "names must be a non-empty array");
  }
  for (const name of opts.names) validateName(name);
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) validateProject(opts.project);
  validateArea(opts.area);
  validateTeam(opts.team);
  const timeout = Math.min(Math.max(opts.timeout_s ?? 60, 0), MAX_INBOX_WAIT_S);
  const deadline = now() + timeout * 1000;
  let latest = inspectAgents(opts);
  while ((latest.missing.length > 0 || latest.stale.length > 0 || latest.wrong_scope.length > 0) && now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    latest = inspectAgents(opts);
  }
  return latest;
}

function inspectAgents(opts: WaitForAgentsOptions): WaitForAgentsResult {
  const expected = new Set(opts.names);
  const all = directory({ project: PROJECT_WILDCARD, area: AREA_WILDCARD, team: TEAM_WILDCARD }).filter((agent) => expected.has(agent.name));
  const byName = new Map(all.map((agent) => [agent.name, agent]));
  const missing = opts.names.filter((name) => !byName.has(name));
  const wrong_scope: WaitForAgentsResult["wrong_scope"] = [];
  const stale: AgentDirectoryEntry[] = [];
  const ready: AgentDirectoryEntry[] = [];
  for (const agent of all) {
    const projectWrong = opts.project !== undefined && opts.project !== PROJECT_WILDCARD && agent.project !== opts.project;
    const areaWrong = opts.area !== undefined && opts.area !== AREA_WILDCARD && agent.area !== opts.area;
    const teamWrong = opts.team !== undefined && opts.team !== TEAM_WILDCARD && agent.team !== opts.team;
    if (projectWrong || areaWrong || teamWrong) {
      wrong_scope.push({
        name: agent.name,
        project: agent.project,
        area: agent.area,
        team: agent.team,
        expected_project: opts.project === undefined || opts.project === PROJECT_WILDCARD ? null : opts.project,
        expected_area: opts.area === undefined || opts.area === AREA_WILDCARD ? null : opts.area,
        expected_team: opts.team === undefined || opts.team === TEAM_WILDCARD ? null : opts.team,
      });
    } else if (agent.presence === "stale" || agent.presence === "paused") {
      stale.push(agent);
    } else {
      ready.push(agent);
    }
  }
  return { ready, missing, stale, wrong_scope };
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
  senderTeam: string | null,
): Message {
  validatePriority(opts.priority);
  const db = getDb();
  const ts = now();
  const priority = opts.priority ?? "normal";
  const info = db
    .prepare(
      `INSERT INTO messages
         (from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, channel, project, area, team, priority)
       VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?, ?)`,
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
      senderTeam,
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
  return insertMessage(opts, opts.thread_id ?? newThreadId(), sender.project, sender.area, sender.team);
}

export interface InboxOptions {
  agent: string;
  team?: string;
  since_id?: number;
  mark_delivered?: boolean;
  limit?: number;
  wait_s?: number;
  claim_s?: number;
}

export async function inbox(opts: InboxOptions): Promise<Message[]> {
  validateName(opts.agent);
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) validateTeam(opts.team);
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
  const teamFilter = opts.team !== undefined && opts.team !== TEAM_WILDCARD ? opts.team : null;
  const where = [
    "to_agent = ?",
    "id > ?",
    "status = 'pending'",
    "(claim_deadline IS NULL OR claim_deadline < ?)",
  ];
  const params: unknown[] = [opts.agent, since, ts];
  if (teamFilter !== null) {
    where.push("team = ?");
    params.push(teamFilter);
  }

  const rows = db
    .prepare(
      `SELECT * FROM messages
         WHERE ${where.join("\n           AND ")}
         ORDER BY CASE priority
           WHEN 'urgent' THEN 3
           WHEN 'high' THEN 2
           WHEN 'normal' THEN 1
           ELSE 0
         END DESC, id ASC
         LIMIT ?`,
    )
    .all(...params, limit) as MessageRow[];

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
  const row = getMessageRow(opts.message_id);
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

export interface InboxStatusOptions {
  agent: string;
  team?: string;
  limit?: number;
}

export interface InboxStatus {
  agent: string;
  unread: Message[];
  in_flight: Message[];
  delivered_recent: Message[];
  last_message: Message | null;
  next_claim_deadline: number | null;
  summary: string;
}

export function inboxStatus(opts: InboxStatusOptions): InboxStatus {
  validateName(opts.agent);
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) validateTeam(opts.team);
  requireAgent(opts.agent);
  heartbeat(opts.agent);
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const ts = now();
  const teamFilter = opts.team !== undefined && opts.team !== TEAM_WILDCARD ? opts.team : null;
  const teamWhere = teamFilter === null ? "" : " AND team = ?";
  const unreadParams = teamFilter === null ? [opts.agent, ts, limit] : [opts.agent, ts, teamFilter, limit];
  const deliveredParams = teamFilter === null ? [opts.agent, limit] : [opts.agent, teamFilter, limit];
  const lastParams = teamFilter === null ? [opts.agent] : [opts.agent, teamFilter];
  const unread = getDb()
    .prepare(
      `SELECT * FROM messages
        WHERE to_agent = ?
          AND status = 'pending'
          AND (claim_deadline IS NULL OR claim_deadline < ?)
          ${teamWhere}
        ORDER BY id ASC
        LIMIT ?`,
    )
    .all(...unreadParams) as MessageRow[];
  const inFlight = getDb()
    .prepare(
      `SELECT * FROM messages
        WHERE to_agent = ?
          AND status = 'pending'
          AND claim_deadline IS NOT NULL
          AND claim_deadline >= ?
          ${teamWhere}
        ORDER BY claim_deadline ASC, id ASC
        LIMIT ?`,
    )
    .all(...unreadParams) as MessageRow[];
  const delivered = getDb()
    .prepare(
      `SELECT * FROM messages
        WHERE to_agent = ?
          AND status IN ('delivered','answered')
          ${teamWhere}
        ORDER BY id DESC
        LIMIT ?`,
    )
    .all(...deliveredParams) as MessageRow[];
  const last = getDb()
    .prepare(`SELECT * FROM messages WHERE to_agent = ?${teamWhere} ORDER BY id DESC LIMIT 1`)
    .get(...lastParams) as MessageRow | undefined;
  const nextClaim = inFlight.reduce<number | null>(
    (best, row) => row.claim_deadline !== null && (best === null || row.claim_deadline < best) ? row.claim_deadline : best,
    null,
  );
  const summary =
    unread.length > 0
      ? `${unread.length} unread message(s)`
      : inFlight.length > 0
        ? `no unread messages; ${inFlight.length} message(s) currently claimed/in-flight`
        : last
          ? `no unread messages; last message #${last.id} was ${last.status}`
          : "no messages for this agent";
  return {
    agent: opts.agent,
    unread: unread.map(toMessage),
    in_flight: inFlight.map(toMessage),
    delivered_recent: delivered.reverse().map(toMessage),
    last_message: last ? toMessage(last) : null,
    next_claim_deadline: nextClaim,
    summary,
  };
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

async function askWithScope(
  opts: AskOptions,
  scope?: { project: string | null; area: string | null; team: string | null },
): Promise<Message> {
  const timeout_s = Math.min(opts.timeout_s ?? 60, MAX_ASK_TIMEOUT_S);
  const sender = requireAgent(opts.from);
  requireAgent(opts.to);

  if (hasPendingAsk(opts.to, opts.from)) {
    throw new BusError(
      "ASK_CYCLE",
      `'${opts.to}' already has a pending ask to '${opts.from}'; would deadlock`,
    );
  }

  heartbeat(opts.from);
  const asked = insertMessage(
    {
      from: opts.from,
      to: opts.to,
      content: opts.question,
      kind: "ask",
      thread_id: opts.thread_id,
    },
    opts.thread_id ?? newThreadId(),
    scope?.project ?? sender.project,
    scope?.area ?? sender.area,
    scope?.team ?? sender.team,
  );

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

export async function ask(opts: AskOptions): Promise<Message> {
  return askWithScope(opts);
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
    replier.team,
  );
  heartbeat(opts.from);

  db.prepare(
    "UPDATE messages SET status = 'answered', replied_at = ? WHERE id = ?",
  ).run(now(), askRow.id);

  return replyMsg;
}

export interface ReplyThreadOptions {
  from: string;
  thread_id: string;
  message: string;
}

export function replyThread(opts: ReplyThreadOptions): Message {
  validateName(opts.from);
  requireAgent(opts.from);
  if (typeof opts.thread_id !== "string" || opts.thread_id.length === 0) {
    throw new BusError("INVALID_INPUT", "thread_id is required");
  }
  if (typeof opts.message !== "string") {
    throw new BusError("INVALID_INPUT", "message must be a string");
  }
  const rows = threadMessages(opts.thread_id, 500);
  if (rows.length === 0) {
    throw new BusError("THREAD_NOT_FOUND", `no messages in thread '${opts.thread_id}'`);
  }
  const target = [...rows]
    .reverse()
    .find((message) => message.from_agent !== opts.from && message.to_agent === opts.from)?.from_agent
    ?? [...rows].reverse().find((message) => message.from_agent !== opts.from)?.from_agent;
  if (!target) {
    throw new BusError("UNKNOWN_AGENT", `could not infer another participant in thread '${opts.thread_id}'`);
  }
  return send({
    from: opts.from,
    to: target,
    content: opts.message,
    thread_id: opts.thread_id,
  });
}

export interface MessageStatusOptions {
  message_id: number;
}

export interface MessageStatusResult {
  message: Message;
  reply: Message | null;
  recipient: AgentDirectoryEntry | null;
  related_task: Task | null;
  diagnostics: string[];
  suggested_next_actions: string[];
}

export function messageStatus(opts: MessageStatusOptions): MessageStatusResult {
  const message = toMessage(getMessageRow(opts.message_id));
  const replyRow = getDb()
    .prepare("SELECT * FROM messages WHERE reply_to = ? AND kind = 'reply' ORDER BY id ASC LIMIT 1")
    .get(message.id) as MessageRow | undefined;
  const recipient = directory({ project: PROJECT_WILDCARD, area: AREA_WILDCARD })
    .find((agent) => agent.name === message.to_agent) ?? null;
  const taskRow = getDb()
    .prepare("SELECT * FROM tasks WHERE thread_id = ? ORDER BY updated_at DESC LIMIT 1")
    .get(message.thread_id) as TaskRow | undefined;
  const relatedTask = taskRow ? toTask(taskRow, lastSeenMap()) : null;
  const diagnostics: string[] = [];
  const suggested: string[] = [];
  const ts = now();
  if (message.kind === "ask" && !replyRow) {
    diagnostics.push("ask has no reply yet");
    suggested.push(`check inbox_status for ${message.to_agent}`);
  }
  if (message.status === "pending" && message.claim_deadline !== null && message.claim_deadline >= ts) {
    diagnostics.push(`message is claimed by ${message.claimed_by ?? "unknown"} until ${message.claim_deadline}`);
    suggested.push("wait for the claim to expire, or inspect the claiming session");
  } else if (message.status === "pending") {
    diagnostics.push("message is unread or claim has expired");
    suggested.push(`ask ${message.to_agent} to check inbox`);
  }
  if (message.status === "delivered" && message.kind === "ask" && !replyRow) {
    diagnostics.push("ask was delivered but not answered");
  }
  if (message.status === "answered") diagnostics.push("ask was answered");
  if (recipient === null) {
    diagnostics.push(`recipient ${message.to_agent} is not registered`);
    suggested.push("check directory or register/start the recipient agent");
  } else {
    diagnostics.push(`recipient is ${recipient.status}/${recipient.presence}, seen ${recipient.age_s}s ago`);
    if (recipient.paused) suggested.push(`resume ${recipient.name}`);
    if (recipient.presence === "stale") suggested.push(`start or wake ${recipient.name}, or reassign related work`);
  }
  if (relatedTask) {
    diagnostics.push(`thread is linked to task #${relatedTask.id} (${relatedTask.state})`);
    suggested.push(`check task_result for task #${relatedTask.id}`);
  }
  if (suggested.length === 0) suggested.push("read the thread for context");
  return {
    message,
    reply: replyRow ? toMessage(replyRow) : null,
    recipient,
    related_task: relatedTask,
    diagnostics,
    suggested_next_actions: [...new Set(suggested)],
  };
}

export function whyNoReply(messageId: number): MessageStatusResult {
  const result = messageStatus({ message_id: messageId });
  if (result.reply !== null) return result;
  if (result.message.kind !== "ask") {
    result.diagnostics.push("message is not an ask; no reply is expected by protocol");
  }
  return result;
}

export interface AskBestOptions {
  from: string;
  capability: string;
  question: string;
  timeout_s?: number;
  thread_id?: string;
  project?: string;
  area?: string;
  team?: string;
  role?: AgentRole;
}

export async function askBest(opts: AskBestOptions): Promise<Message> {
  validateName(opts.from);
  const asker = requireAgent(opts.from);

  // Resolve scope: explicit > asker metadata. "*" means no filter on that dimension.
  const projectScope = opts.project !== undefined ? opts.project : asker.project;
  const areaScope = opts.area !== undefined ? opts.area : asker.area;
  const teamScope = opts.team !== undefined ? opts.team : asker.team;
  if (projectScope !== null && projectScope !== PROJECT_WILDCARD) validateProject(projectScope);
  if (areaScope !== null && areaScope !== AREA_WILDCARD) validateArea(areaScope);
  if (teamScope !== null && teamScope !== TEAM_WILDCARD) validateTeam(teamScope);
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
    const teamOk =
      teamScope === null ||
      teamScope === TEAM_WILDCARD ||
      a.team === teamScope;
    const roleOk = opts.role === undefined || a.role === opts.role;
    return projectOk && areaOk && teamOk && roleOk;
  }).sort((a, b) => {
    const weightDiff = b.routing_weight - a.routing_weight;
    if (weightDiff !== 0) return weightDiff;
    return b.last_seen - a.last_seen;
  });

  if (scoped.length === 0) {
    const scopedParts = [
      projectScope !== null && projectScope !== PROJECT_WILDCARD ? `project '${projectScope}'` : null,
      areaScope !== null && areaScope !== AREA_WILDCARD ? `area '${areaScope}'` : null,
      teamScope !== null && teamScope !== TEAM_WILDCARD ? `team '${teamScope}'` : null,
      opts.role !== undefined ? `role '${opts.role}'` : null,
    ].filter(Boolean);
    const scopeText = scopedParts.length > 0 ? ` in ${scopedParts.join(", ")}` : "";
    const hintParts = [
      projectScope !== null && projectScope !== PROJECT_WILDCARD ? `project="${PROJECT_WILDCARD}"` : null,
      areaScope !== null && areaScope !== AREA_WILDCARD ? `area="${AREA_WILDCARD}"` : null,
      teamScope !== null && teamScope !== TEAM_WILDCARD ? `team="${TEAM_WILDCARD}"` : null,
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
        sender.team,
      ),
    );
  }
  return out;
}

export interface SendTeamOptions {
  from: string;
  team?: string;
  content: string;
  thread_id?: string;
  project?: string;
  area?: string;
  include_self?: boolean;
}

interface TeamSelectionOptions {
  from: string;
  team?: string;
  project?: string;
  area?: string;
  include_self?: boolean;
  capability?: string;
  role?: AgentRole;
}

interface TeamSelection {
  team: string;
  candidates: AgentDirectoryEntry[];
  recipients: AgentDirectoryEntry[];
  skipped: Array<{
    agent: string;
    reason: "self" | "paused" | "stale" | "capability_mismatch" | "role_mismatch" | "over_limit";
    presence: AgentDirectoryEntry["presence"];
    age_s: number;
  }>;
}

function selectTeamRecipients(opts: TeamSelectionOptions): TeamSelection {
  validateName(opts.from);
  const sender = requireAgent(opts.from);
  const team = opts.team !== undefined ? opts.team : sender.team;
  if (!team || team === TEAM_WILDCARD) {
    throw new BusError("INVALID_INPUT", "team is required for team routing");
  }
  validateTeam(team);
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) validateProject(opts.project);
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) validateArea(opts.area);
  validateRole(opts.role);
  const candidates = directory({ project: opts.project ?? sender.project ?? undefined, area: opts.area ?? sender.area ?? undefined, team });
  const recipients: AgentDirectoryEntry[] = [];
  const skipped: TeamSelection["skipped"] = [];
  for (const agent of candidates) {
    let reason: TeamSelection["skipped"][number]["reason"] | null = null;
    if (opts.include_self !== true && agent.name === opts.from) reason = "self";
    else if (agent.paused) reason = "paused";
    else if (agent.presence === "stale") reason = "stale";
    else if (opts.capability !== undefined && !agent.capabilities.includes(opts.capability)) reason = "capability_mismatch";
    else if (opts.role !== undefined && agent.role !== opts.role) reason = "role_mismatch";
    if (reason) {
      skipped.push({ agent: agent.name, reason, presence: agent.presence, age_s: agent.age_s });
    } else {
      recipients.push(agent);
    }
  }
  recipients.sort((a, b) => {
      const weightDiff = b.routing_weight - a.routing_weight;
      if (weightDiff !== 0) return weightDiff;
      return b.last_seen - a.last_seen;
  });
  return { team, candidates, recipients, skipped };
}

function teamRecipients(opts: TeamSelectionOptions): Agent[] {
  return selectTeamRecipients(opts).recipients;
}

export function sendTeam(opts: SendTeamOptions): Message[] {
  if (typeof opts.content !== "string") {
    throw new BusError("INVALID_INPUT", "content must be a string");
  }
  requireAgent(opts.from);
  heartbeat(opts.from);
  const recipients = teamRecipients(opts);
  if (recipients.length === 0) return [];
  const threadId = opts.thread_id ?? newThreadId();
  return recipients.map((recipient) =>
    insertMessage(
      {
        from: opts.from,
        to: recipient.name,
        content: opts.content,
        kind: "msg",
        thread_id: threadId,
      },
      threadId,
      recipient.project,
      recipient.area,
      recipient.team,
    ),
  );
}

export interface AskTeamOptions {
  from: string;
  team?: string;
  question: string;
  timeout_s?: number;
  thread_id?: string;
  project?: string;
  area?: string;
  capability?: string;
  role?: AgentRole;
}

export async function askTeam(opts: AskTeamOptions): Promise<Message> {
  if (typeof opts.question !== "string") {
    throw new BusError("INVALID_INPUT", "question must be a string");
  }
  const recipients = teamRecipients(opts);
  if (recipients.length === 0) {
    throw new BusError("UNKNOWN_AGENT", `no active agent in team '${opts.team ?? requireAgent(opts.from).team ?? ""}' matches the request`);
  }
  const recipient = recipients[0]!;
  return askWithScope(
    {
      from: opts.from,
      to: recipient.name,
      question: opts.question,
      timeout_s: opts.timeout_s,
      thread_id: opts.thread_id,
    },
    { project: recipient.project, area: recipient.area, team: recipient.team },
  );
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
  team?: string;
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
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    validateTeam(opts.team);
    where.push("team = ?");
    params.push(opts.team);
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

export function messagesSince(id: number, limit = 100, project?: string, area?: string, team?: string): Message[] {
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
  if (team !== undefined && team !== TEAM_WILDCARD) {
    validateTeam(team);
    where.push("team = ?");
    params.push(team);
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
  team: string | null;
  required_capability: string | null;
  mode: TaskMode;
  expected_output: string | null;
  deadline_at: number | null;
  checkin_at: number | null;
  final_answer: string | null;
  manager_reviewed: boolean;
  file_scope: string[];
  edit_scope: string[];
  read_scope: string[];
  ack_required: boolean;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  review_required: boolean;
  review_state: TaskReviewState;
  reviewed_by: string | null;
  review_notes: string | null;
  changed_files: string[];
  pending_assignee: string | null;
  phase: string | null;
  session_id: string | null;
  scope_conflicts?: ScopeConflict[];
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
  team: string | null;
  required_capability: string | null;
  mode: TaskMode;
  expected_output: string | null;
  deadline_at: number | null;
  checkin_at: number | null;
  final_answer: string | null;
  manager_reviewed: number;
  file_scope: string;
  edit_scope: string;
  read_scope: string;
  ack_required: number;
  acknowledged_at: number | null;
  acknowledged_by: string | null;
  review_required: number;
  review_state: TaskReviewState;
  reviewed_by: string | null;
  review_notes: string | null;
  changed_files: string;
  pending_assignee: string | null;
  phase: string | null;
  session_id: string | null;
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
    team: row.team,
    required_capability: row.required_capability,
    mode: row.mode,
    expected_output: row.expected_output,
    deadline_at: row.deadline_at,
    checkin_at: row.checkin_at,
    final_answer: row.final_answer,
    manager_reviewed: row.manager_reviewed === 1,
    file_scope: JSON.parse(row.file_scope) as string[],
    edit_scope: JSON.parse(row.edit_scope) as string[],
    read_scope: JSON.parse(row.read_scope) as string[],
    ack_required: row.ack_required === 1,
    acknowledged_at: row.acknowledged_at,
    acknowledged_by: row.acknowledged_by,
    review_required: row.review_required === 1,
    review_state: row.review_state,
    reviewed_by: row.reviewed_by,
    review_notes: row.review_notes,
    changed_files: JSON.parse(row.changed_files) as string[],
    pending_assignee: row.pending_assignee,
    phase: row.phase,
    session_id: row.session_id,
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

function notifyTaskRequester(task: Task, from: string, content: string): Message | null {
  if (task.requested_by === from) return null;
  return send({
    from,
    to: task.requested_by,
    content,
    thread_id: task.thread_id,
  });
}

export interface ScopeConflict {
  task_id: number;
  title: string;
  claimed_by: string | null;
  state: TaskState;
  overlapping_scope: string;
}

function scopeBase(pattern: string): string {
  const trimmed = pattern.trim().replace(/^\.\/+/, "");
  const wildcard = trimmed.search(/[*?[{]/);
  const raw = wildcard >= 0 ? trimmed.slice(0, wildcard) : trimmed;
  const slash = raw.lastIndexOf("/");
  if (wildcard >= 0) return raw.slice(0, slash + 1);
  return raw.endsWith("/") ? raw : raw;
}

function scopesOverlap(a: string, b: string): boolean {
  const left = scopeBase(a);
  const right = scopeBase(b);
  if (!left || !right) return false;
  return left === right || left.startsWith(right) || right.startsWith(left);
}

function fileMatchesScope(file: string, pattern: string): boolean {
  const normalizedFile = file.trim().replace(/^\.\/+/, "");
  const base = scopeBase(pattern);
  if (!base) return false;
  if (pattern.includes("*")) return normalizedFile.startsWith(base);
  return normalizedFile === base || normalizedFile.startsWith(base.endsWith("/") ? base : `${base}/`);
}

function filesOutsideScope(files: string[], scope: string[]): string[] {
  if (scope.length === 0 || files.length === 0) return [];
  return files.filter((file) => !scope.some((pattern) => fileMatchesScope(file, pattern)));
}

export interface CheckScopeConflictsOptions {
  file_scope?: string[];
  edit_scope?: string[];
  project?: string | null;
  area?: string | null;
  team?: string | null;
  exclude_task_id?: number;
}

export function checkScopeConflicts(opts: CheckScopeConflictsOptions): ScopeConflict[] {
  if (opts.project !== undefined && opts.project !== null && opts.project !== PROJECT_WILDCARD) {
    validateProject(opts.project);
  }
  validateArea(opts.area);
  validateTeam(opts.team);
  const requestedScope = opts.edit_scope ?? opts.file_scope ?? [];
  if (!requestedScope.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "edit_scope/file_scope must be an array of strings");
  }
  const scope = requestedScope.filter((value) => value.trim().length > 0);
  if (scope.length === 0) return [];

  const where = ["state IN ('claimed','working','blocked')", "mode IN ('edit_files','propose_patch')", "edit_scope != '[]'"];
  const params: unknown[] = [];
  if (opts.project !== undefined && opts.project !== null && opts.project !== PROJECT_WILDCARD) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== null && opts.area !== AREA_WILDCARD) {
    where.push("area = ?");
    params.push(opts.area);
  }
  if (opts.team !== undefined && opts.team !== null && opts.team !== TEAM_WILDCARD) {
    where.push("team = ?");
    params.push(opts.team);
  }
  if (opts.exclude_task_id !== undefined) {
    where.push("id != ?");
    params.push(opts.exclude_task_id);
  }
  const rows = getDb()
    .prepare(`SELECT * FROM tasks WHERE ${where.join(" AND ")} ORDER BY updated_at DESC`)
    .all(...params) as TaskRow[];
  const conflicts: ScopeConflict[] = [];
  for (const row of rows) {
    const otherScope = JSON.parse(row.edit_scope) as string[];
    for (const requested of scope) {
      const overlap = otherScope.find((existing) => scopesOverlap(requested, existing));
      if (overlap) {
        conflicts.push({
          task_id: row.id,
          title: row.title,
          claimed_by: row.claimed_by,
          state: row.state,
          overlapping_scope: overlap,
        });
        break;
      }
    }
  }
  return conflicts;
}

function assertNoScopeConflicts(editScope: string[], project: string | null, area: string | null, excludeTaskId?: number, team?: string | null): void {
  const conflicts = checkScopeConflicts({
    edit_scope: editScope,
    project,
    area,
    team,
    exclude_task_id: excludeTaskId,
  });
  if (conflicts.length > 0) {
    const first = conflicts[0]!;
    throw new BusError(
      "TASK_SCOPE_CONFLICT",
      `file_scope overlaps active task #${first.task_id} (${first.overlapping_scope})`,
    );
  }
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
  team?: string | null;
  required_capability?: string | null;
  mode?: TaskMode;
  expected_output?: string | null;
  deadline_at?: number | null;
  checkin_at?: number | null;
  final_answer?: string | null;
  manager_reviewed?: boolean;
  file_scope?: string[];
  edit_scope?: string[];
  read_scope?: string[];
  ack_required?: boolean;
  review_required?: boolean;
  changed_files?: string[];
  phase?: string | null;
  session_id?: string | null;
  allow_conflicts?: boolean;
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
  validateTeam(opts.team);
  validateTaskMode(opts.mode);
  if (opts.required_capability !== undefined && opts.required_capability !== null && opts.required_capability.length === 0) {
    throw new BusError("INVALID_INPUT", "required_capability must be non-empty or null");
  }
  if (opts.file_scope !== undefined && !opts.file_scope.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "file_scope must be an array of strings");
  }
  if (opts.edit_scope !== undefined && !opts.edit_scope.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "edit_scope must be an array of strings");
  }
  if (opts.read_scope !== undefined && !opts.read_scope.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "read_scope must be an array of strings");
  }
  if (opts.changed_files !== undefined && !opts.changed_files.every((value) => typeof value === "string")) {
    throw new BusError("INVALID_INPUT", "changed_files must be an array of strings");
  }
  validateSessionId(opts.session_id);
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
  const team = opts.team !== undefined ? opts.team : requester.team;
  const requiredCapability = opts.required_capability ?? null;
  const mode = opts.mode ?? "edit_files";
  const rawFileScope = opts.file_scope ?? [];
  const rawEditScope = opts.edit_scope ?? ((mode === "edit_files" || mode === "propose_patch") ? rawFileScope : []);
  const rawReadScope = opts.read_scope ?? rawFileScope;
  const sessionId = opts.session_id !== undefined ? opts.session_id : requester.session_id;
  if (opts.allow_conflicts !== true && (mode === "edit_files" || mode === "propose_patch")) {
    assertNoScopeConflicts(rawEditScope, project, area, undefined, team);
  }
  const fileScope = JSON.stringify(rawFileScope);
  const editScope = JSON.stringify(rawEditScope);
  const readScope = JSON.stringify(rawReadScope);
  const changedFiles = JSON.stringify(opts.changed_files ?? []);
  const reviewRequired = opts.review_required === true;
  const info = db
    .prepare(
      `INSERT INTO tasks
         (title, description, thread_id, requested_by, state, priority, cwd, blocked_on_task_id, created_at, updated_at, project, area, team, required_capability, mode, expected_output, deadline_at, checkin_at, final_answer, manager_reviewed, file_scope, edit_scope, read_scope, ack_required, review_required, review_state, changed_files, phase, session_id)
       VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      team,
      requiredCapability,
      mode,
      opts.expected_output ?? null,
      opts.deadline_at ?? null,
      opts.checkin_at ?? null,
      opts.final_answer ?? null,
      opts.manager_reviewed === true ? 1 : 0,
      fileScope,
      editScope,
      readScope,
      opts.ack_required === true ? 1 : 0,
      reviewRequired ? 1 : 0,
      reviewRequired ? "pending" : "none",
      changedFiles,
      opts.phase ?? null,
      sessionId,
    );

  const task = toTask(getTaskRow(info.lastInsertRowid as number));
  runLocalHook("task.created", task);
  return task;
}

export interface ClaimTaskOptions {
  agent: string;
  task_id: number;
  allow_conflicts?: boolean;
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
    if (row.area !== AREA_WILDCARD && agent.area !== AREA_WILDCARD) {
      throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} belongs to area '${row.area}'`);
    }
  }
  if (row.team !== null && agent.team !== null && row.team !== agent.team) {
    if (row.team !== TEAM_WILDCARD && agent.team !== TEAM_WILDCARD) {
      throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} belongs to team '${row.team}'`);
    }
  }
  if (row.pending_assignee !== null && row.pending_assignee !== opts.agent) {
    throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} is reserved for '${row.pending_assignee}'`);
  }
  const rowScope = JSON.parse(row.edit_scope) as string[];
  if (opts.allow_conflicts !== true && (row.mode === "edit_files" || row.mode === "propose_patch")) {
    assertNoScopeConflicts(rowScope, row.project, row.area, opts.task_id, row.team);
  }
  const ts = now();
  const info = db
    .prepare(
      `UPDATE tasks
         SET state = 'claimed', claimed_by = ?, pending_assignee = NULL, claimed_at = ?, updated_at = ?
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
  if (task.requested_by !== opts.agent) {
    send({
      from: opts.agent,
      to: task.requested_by,
      content: `claimed task #${task.id}: ${task.title}`,
      thread_id: task.thread_id,
    });
  }
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
  edit_scope?: string[];
  read_scope?: string[];
  mode?: TaskMode;
  ack_required?: boolean;
  review_required?: boolean;
  review_state?: TaskReviewState;
  reviewed_by?: string | null;
  review_notes?: string | null;
  changed_files?: string[];
  phase?: string | null;
  session_id?: string | null;
  allow_conflicts?: boolean;
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
      sets.push("claimed_by = NULL", "pending_assignee = NULL", "claimed_at = NULL");
    }
    if (TERMINAL_TASK_STATES.includes(opts.state)) {
      if (opts.state === "completed" && row.review_required === 1 && row.review_state !== "approved") {
        throw new BusError("TASK_REVIEW_REQUIRED", `task ${opts.task_id} requires approved review before completion`);
      }
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
  if (opts.phase !== undefined) {
    sets.push("phase = ?");
    params.push(opts.phase);
  }
  if (opts.session_id !== undefined) {
    validateSessionId(opts.session_id);
    sets.push("session_id = ?");
    params.push(opts.session_id);
  }
  if (opts.file_scope !== undefined) {
    if (!opts.file_scope.every((value) => typeof value === "string")) {
      throw new BusError("INVALID_INPUT", "file_scope must be an array of strings");
    }
    sets.push("file_scope = ?");
    params.push(JSON.stringify(opts.file_scope));
  }
  if (opts.edit_scope !== undefined) {
    if (!opts.edit_scope.every((value) => typeof value === "string")) {
      throw new BusError("INVALID_INPUT", "edit_scope must be an array of strings");
    }
    if (opts.allow_conflicts !== true && (opts.mode ?? row.mode) !== "investigate_only" && (opts.mode ?? row.mode) !== "test_only") {
      assertNoScopeConflicts(opts.edit_scope, row.project, row.area, opts.task_id, row.team);
    }
    sets.push("edit_scope = ?");
    params.push(JSON.stringify(opts.edit_scope));
  } else if (opts.file_scope !== undefined && opts.allow_conflicts !== true && (opts.mode ?? row.mode) !== "investigate_only" && (opts.mode ?? row.mode) !== "test_only") {
    assertNoScopeConflicts(opts.file_scope, row.project, row.area, opts.task_id, row.team);
    sets.push("edit_scope = ?");
    params.push(JSON.stringify(opts.file_scope));
  }
  if (opts.read_scope !== undefined) {
    if (!opts.read_scope.every((value) => typeof value === "string")) {
      throw new BusError("INVALID_INPUT", "read_scope must be an array of strings");
    }
    sets.push("read_scope = ?");
    params.push(JSON.stringify(opts.read_scope));
  }
  if (opts.ack_required !== undefined) {
    sets.push("ack_required = ?");
    params.push(opts.ack_required ? 1 : 0);
  }
  if (opts.review_required !== undefined) {
    sets.push("review_required = ?");
    params.push(opts.review_required ? 1 : 0);
    if (opts.review_required && row.review_state === "none" && opts.review_state === undefined) {
      sets.push("review_state = ?");
      params.push("pending");
    }
  }
  if (opts.review_state !== undefined) {
    validateReviewState(opts.review_state);
    sets.push("review_state = ?");
    params.push(opts.review_state);
  }
  if (opts.reviewed_by !== undefined) {
    if (opts.reviewed_by !== null) validateName(opts.reviewed_by);
    sets.push("reviewed_by = ?");
    params.push(opts.reviewed_by);
  }
  if (opts.review_notes !== undefined) {
    sets.push("review_notes = ?");
    params.push(opts.review_notes);
  }
  if (opts.changed_files !== undefined) {
    if (!opts.changed_files.every((value) => typeof value === "string")) {
      throw new BusError("INVALID_INPUT", "changed_files must be an array of strings");
    }
    const editScope = JSON.parse(row.edit_scope) as string[];
    const fallbackScope = JSON.parse(row.file_scope) as string[];
    const outside = filesOutsideScope(opts.changed_files, editScope.length > 0 ? editScope : fallbackScope);
    if (outside.length > 0 && opts.allow_conflicts !== true) {
      throw new BusError("TASK_SCOPE_CONFLICT", `changed_files outside file_scope: ${outside.join(", ")}`);
    }
    sets.push("changed_files = ?");
    params.push(JSON.stringify(opts.changed_files));
  }

  if (sets.length === 1) {
    return toTask(row);
  }

  params.push(opts.task_id);
  db.prepare(`UPDATE tasks SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  const task = toTask(getTaskRow(opts.task_id));
  if (opts.state !== undefined && task.requested_by !== opts.agent && ["working", "blocked", "completed", "failed"].includes(opts.state)) {
    notifyTaskRequester(task, opts.agent, `task #${task.id} ${opts.state}: ${task.title}${opts.final_answer ? ` - ${opts.final_answer}` : opts.result ? ` - ${opts.result}` : ""}`);
  }
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
       SET state = 'open', claimed_by = NULL, pending_assignee = NULL, claimed_at = NULL, updated_at = ?
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
  team?: string;
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
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    validateTeam(opts.team);
    where.push("team = ?");
    params.push(opts.team);
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
  allow_conflicts?: boolean;
  allow_pending_agent?: boolean;
}

export function assignTask(opts: AssignTaskOptions): Task {
  validateName(opts.to_agent);
  let agent: Agent | null = null;
  try {
    agent = requireAgent(opts.to_agent);
  } catch (error) {
    if (!(error instanceof BusError) || error.code !== "UNKNOWN_AGENT" || opts.allow_pending_agent !== true) throw error;
  }
  const row = getTaskRow(opts.task_id);
  if (row.state !== "open" || row.claimed_by !== null) {
    throw new BusError("TASK_NOT_CLAIMABLE", `task ${opts.task_id} is in state '${row.state}'`);
  }
  if (agent !== null && row.required_capability !== null && !agent.capabilities.includes(row.required_capability)) {
    throw new BusError("TASK_FORBIDDEN", `agent '${opts.to_agent}' lacks capability '${row.required_capability}'`);
  }
  const rowScope = JSON.parse(row.edit_scope) as string[];
  if (opts.allow_conflicts !== true && (row.mode === "edit_files" || row.mode === "propose_patch")) {
    assertNoScopeConflicts(rowScope, row.project, row.area, opts.task_id, row.team);
  }
  const ts = now();
  if (agent === null) {
    getDb()
      .prepare(
        `UPDATE tasks
           SET pending_assignee = ?, updated_at = ?
         WHERE id = ? AND state = 'open' AND claimed_by IS NULL`,
      )
      .run(opts.to_agent, ts, opts.task_id);
    const task = toTask(getTaskRow(opts.task_id));
    runLocalHook("task.assigned_pending", task);
    return task;
  }
  getDb()
    .prepare(
      `UPDATE tasks
         SET state = 'claimed', claimed_by = ?, pending_assignee = NULL, claimed_at = ?, updated_at = ?
       WHERE id = ? AND state = 'open' AND claimed_by IS NULL`,
    )
    .run(opts.to_agent, ts, ts, opts.task_id);
  heartbeat(opts.to_agent);
  const task = toTask(getTaskRow(opts.task_id));
  send({
    from: task.requested_by,
    to: opts.to_agent,
    content: `assigned task #${task.id}: ${task.title}. Please acknowledge with acknowledge_task.`,
    thread_id: task.thread_id,
  });
  runLocalHook("task.claimed", task);
  return task;
}

export interface DelegateOptions extends Omit<CreateTaskOptions, "requested_by"> {
  from: string;
  to_agent: string;
  allow_pending_agent?: boolean;
}

export interface DelegateResult {
  task: Task;
  event: TaskEvent;
  assigned: boolean;
  pending: boolean;
  suggested_next_actions: string[];
}

export function delegate(opts: DelegateOptions): DelegateResult {
  validateName(opts.from);
  validateName(opts.to_agent);
  const task = createTask({
    ...opts,
    requested_by: opts.from,
    ack_required: opts.ack_required ?? true,
  });
  const assigned = assignTask({
    task_id: task.id,
    to_agent: opts.to_agent,
    allow_conflicts: opts.allow_conflicts,
    allow_pending_agent: opts.allow_pending_agent,
  });
  const event = recordTaskEvent({
    by_agent: opts.from,
    task_id: assigned.id,
    event_type: "progress",
    phase: "delegated",
    message: `Delegated to ${opts.to_agent}`,
    metadata: {
      to_agent: opts.to_agent,
      pending: assigned.pending_assignee !== null,
    },
  });
  return {
    task: assigned,
    event,
    assigned: assigned.claimed_by === opts.to_agent,
    pending: assigned.pending_assignee === opts.to_agent,
    suggested_next_actions: [
      assigned.pending_assignee === opts.to_agent
        ? `start or register ${opts.to_agent}; pending assignment is reserved`
        : `wait_for_task ${assigned.id} or watch project_board`,
      assigned.ack_required && assigned.acknowledged_at === null
        ? `wait for ${opts.to_agent} to acknowledge task #${assigned.id}`
        : `track task #${assigned.id}`,
    ],
  };
}

export interface DelegateTeamOptions extends Omit<DelegateOptions, "to_agent" | "allow_pending_agent"> {
  team?: string;
  capability?: string;
  role?: AgentRole;
  include_self?: boolean;
  max_recipients?: number;
}

export interface DelegateTeamResult {
  team: string;
  thread_id: string;
  expected_count: number;
  delegated_count: number;
  tasks: DelegateResult[];
  skipped: TeamSelection["skipped"];
  suggested_next_actions: string[];
}

export function delegateTeam(opts: DelegateTeamOptions): DelegateTeamResult {
  validateName(opts.from);
  const selection = selectTeamRecipients({
    ...opts,
    project: opts.project ?? undefined,
    area: opts.area ?? undefined,
  });
  if (selection.recipients.length === 0) {
    throw new BusError("UNKNOWN_AGENT", `no active agent in team '${selection.team}' matches the delegation`);
  }
  const maxRecipients = Math.trunc(opts.max_recipients ?? 50);
  if (!Number.isFinite(maxRecipients) || maxRecipients < 1 || maxRecipients > 100) {
    throw new BusError("INVALID_INPUT", "max_recipients must be between 1 and 100");
  }
  const recipients = selection.recipients.slice(0, maxRecipients);
  const threadId = opts.thread_id ?? newThreadId();
  const tasks = recipients.map((recipient) =>
    delegate({
      ...opts,
      to_agent: recipient.name,
      thread_id: threadId,
      project: opts.project === undefined ? recipient.project : opts.project,
      area: opts.area === undefined ? recipient.area : opts.area,
      team: opts.team === undefined ? recipient.team : opts.team,
      allow_pending_agent: false,
    }),
  );
  const overflow = selection.recipients.slice(maxRecipients).map((agent) => ({
    agent: agent.name,
    reason: "over_limit" as const,
    presence: agent.presence,
    age_s: agent.age_s,
  }));
  const skipped = [...selection.skipped, ...overflow];
  return {
    team: selection.team,
    thread_id: threadId,
    expected_count: selection.candidates.length,
    delegated_count: tasks.length,
    tasks,
    skipped,
    suggested_next_actions: [
      `created ${tasks.length} tracked task(s) on team '${selection.team}'`,
      skipped.length > 0
        ? `inspect skipped recipients before assuming full-team coverage: ${skipped.map((s) => `${s.agent}:${s.reason}`).join(", ")}`
        : "all matching active team members received tracked tasks",
      `watch team_board(team="${selection.team}") or agent-bus team-board --team ${selection.team}`,
    ],
  };
}

export interface ClaimBestTaskOptions {
  agent: string;
  project?: string;
  area?: string;
  team?: string;
}

export function claimBestTask(opts: ClaimBestTaskOptions): Task | null {
  const agent = requireAgent(opts.agent);
  heartbeat(opts.agent);
  const project = opts.project !== undefined ? opts.project : agent.project;
  const area = opts.area !== undefined ? opts.area : agent.area;
  const team = opts.team !== undefined ? opts.team : agent.team;
  const tasks = listTasks({
    state: "open",
    include_terminal: false,
    project: project ?? undefined,
    area: area ?? undefined,
    team: team ?? undefined,
    limit: 100,
  }).filter((task) => task.required_capability === null || agent.capabilities.includes(task.required_capability));
  const task = tasks.find((candidate) => candidate.pending_assignee === null || candidate.pending_assignee === opts.agent);
  if (!task) return null;
  return claimTask({ agent: opts.agent, task_id: task.id });
}

export interface AcknowledgeTaskOptions {
  agent: string;
  task_id: number;
  response: TaskAckResponse;
  note?: string | null;
}

export function acknowledgeTask(opts: AcknowledgeTaskOptions): Task {
  validateName(opts.agent);
  requireAgent(opts.agent);
  if (!["claimed", "declined", "blocked"].includes(opts.response)) {
    throw new BusError("INVALID_INPUT", "response must be claimed, declined, or blocked");
  }
  heartbeat(opts.agent);
  const row = getTaskRow(opts.task_id);
  if (row.claimed_by !== opts.agent && row.requested_by !== opts.agent) {
    throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} is held by '${row.claimed_by}'`);
  }
  const ts = now();
  if (opts.response === "declined") {
    getDb()
      .prepare(
        `UPDATE tasks
           SET state = 'open', claimed_by = NULL, pending_assignee = NULL, claimed_at = NULL, acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(ts, opts.agent, ts, opts.task_id);
  } else if (opts.response === "blocked") {
    getDb()
      .prepare(
        `UPDATE tasks
           SET state = 'blocked', blocked_reason = ?, acknowledged_at = ?, acknowledged_by = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(opts.note ?? "acknowledged blocked", ts, opts.agent, ts, opts.task_id);
  } else {
    getDb()
      .prepare("UPDATE tasks SET acknowledged_at = ?, acknowledged_by = ?, updated_at = ? WHERE id = ?")
      .run(ts, opts.agent, ts, opts.task_id);
  }
  const task = toTask(getTaskRow(opts.task_id));
  if (task.requested_by !== opts.agent) {
    send({
      from: opts.agent,
      to: task.requested_by,
      content: `acknowledged task #${task.id}: ${opts.response}${opts.note ? ` - ${opts.note}` : ""}`,
      thread_id: task.thread_id,
    });
  }
  return task;
}

export interface SubmitReviewOptions {
  reviewer: string;
  task_id: number;
  approved: boolean;
  notes?: string | null;
}

export function submitReview(opts: SubmitReviewOptions): Task {
  validateName(opts.reviewer);
  requireAgent(opts.reviewer);
  heartbeat(opts.reviewer);
  const row = getTaskRow(opts.task_id);
  const ts = now();
  const reviewState: TaskReviewState = opts.approved ? "approved" : "changes_requested";
  getDb()
    .prepare(
      `UPDATE tasks
         SET review_required = 1, review_state = ?, reviewed_by = ?, review_notes = ?, manager_reviewed = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(reviewState, opts.reviewer, opts.notes ?? null, opts.approved ? 1 : 0, ts, opts.task_id);
  const task = toTask(getTaskRow(opts.task_id));
  const recipient = row.claimed_by ?? row.requested_by;
  if (recipient !== opts.reviewer) {
    send({
      from: opts.reviewer,
      to: recipient,
      content: `review ${reviewState} for task #${task.id}${opts.notes ? `: ${opts.notes}` : ""}`,
      thread_id: task.thread_id,
    });
  }
  notifyTaskRequester(task, opts.reviewer, `review ${reviewState} for task #${task.id}${opts.notes ? `: ${opts.notes}` : ""}`);
  return task;
}

export interface HandoffTaskOptions {
  from_agent: string;
  task_id: number;
  to_agent?: string | null;
  reason: string;
  memory?: string | null;
}

export function handoffTask(opts: HandoffTaskOptions): { task: Task; memory: Memory | null; message: Message | null } {
  validateName(opts.from_agent);
  requireAgent(opts.from_agent);
  if (opts.to_agent !== undefined && opts.to_agent !== null) validateName(opts.to_agent);
  if (opts.reason.trim().length === 0) throw new BusError("INVALID_INPUT", "reason must be non-empty");
  const task = getTask(opts.task_id);
  if (task.claimed_by !== opts.from_agent && task.requested_by !== opts.from_agent) {
    throw new BusError("TASK_FORBIDDEN", `task ${opts.task_id} is held by '${task.claimed_by}'`);
  }
  const memory = opts.memory === null
    ? null
    : remember({
        by_agent: opts.from_agent,
        agent: opts.to_agent ?? task.claimed_by,
        kind: "handoff",
        content: opts.memory ?? `Task #${task.id} handoff: ${opts.reason}`,
        task_id: task.id,
        thread_id: task.thread_id,
        pinned: true,
        project: task.project,
        area: task.area,
      });
  let updated = task;
  let message: Message | null = null;
  if (opts.to_agent) {
    if (task.claimed_by !== null) {
      releaseTask({ agent: opts.from_agent, task_id: task.id });
    }
    updated = assignTask({ task_id: task.id, to_agent: opts.to_agent, allow_conflicts: true });
    message = send({
      from: opts.from_agent,
      to: opts.to_agent,
      content: `handoff task #${task.id}: ${opts.reason}`,
      thread_id: task.thread_id,
    });
  } else if (task.claimed_by !== null) {
    updated = releaseTask({ agent: opts.from_agent, task_id: task.id });
  }
  return { task: updated, memory, message };
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

export interface TaskEvent {
  id: number;
  task_id: number;
  by_agent: string;
  event_type: TaskEventType;
  message: string;
  phase: string | null;
  metadata: Record<string, unknown>;
  project: string | null;
  area: string | null;
  team: string | null;
  created_at: number;
}

interface TaskEventRow {
  id: number;
  task_id: number;
  by_agent: string;
  event_type: TaskEventType;
  message: string;
  phase: string | null;
  metadata: string;
  project: string | null;
  area: string | null;
  team: string | null;
  created_at: number;
}

function toTaskEvent(row: TaskEventRow): TaskEvent {
  return {
    ...row,
    metadata: JSON.parse(row.metadata) as Record<string, unknown>,
  };
}

export interface RecordTaskEventOptions {
  by_agent: string;
  task_id: number;
  event_type?: TaskEventType;
  message: string;
  phase?: string | null;
  metadata?: Record<string, unknown>;
}

export function recordTaskEvent(opts: RecordTaskEventOptions): TaskEvent {
  validateName(opts.by_agent);
  validateTaskEventType(opts.event_type);
  requireAgent(opts.by_agent);
  heartbeat(opts.by_agent);
  const task = getTask(opts.task_id);
  if (opts.message.trim().length === 0) throw new BusError("INVALID_INPUT", "message must be non-empty");
  if (opts.phase !== undefined && opts.phase !== null && opts.phase.trim().length === 0) {
    throw new BusError("INVALID_INPUT", "phase must be non-empty or null");
  }
  const eventType = opts.event_type ?? (opts.phase ? "phase" : "note");
  const metadata = opts.metadata ?? {};
  if (metadata === null || typeof metadata !== "object" || Array.isArray(metadata)) {
    throw new BusError("INVALID_INPUT", "metadata must be an object");
  }
  const ts = now();
  const info = getDb()
    .prepare(
      `INSERT INTO task_events (task_id, by_agent, event_type, message, phase, metadata, project, area, team, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(opts.task_id, opts.by_agent, eventType, opts.message, opts.phase ?? null, JSON.stringify(metadata), task.project, task.area, task.team, ts);
  if (opts.phase !== undefined) {
    getDb().prepare("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?").run(opts.phase, ts, opts.task_id);
  }
  const row = getDb().prepare("SELECT * FROM task_events WHERE id = ?").get(info.lastInsertRowid) as TaskEventRow;
  return toTaskEvent(row);
}

export interface ListTaskEventsOptions {
  task_id?: number;
  by_agent?: string;
  event_type?: TaskEventType;
  project?: string;
  area?: string;
  team?: string;
  limit?: number;
}

export function listTaskEvents(opts: ListTaskEventsOptions = {}): TaskEvent[] {
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) validateProject(opts.project);
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) validateArea(opts.area);
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) validateTeam(opts.team);
  validateTaskEventType(opts.event_type);
  if (opts.by_agent !== undefined) validateName(opts.by_agent);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.task_id !== undefined) {
    where.push("task_id = ?");
    params.push(opts.task_id);
  }
  if (opts.by_agent !== undefined) {
    where.push("by_agent = ?");
    params.push(opts.by_agent);
  }
  if (opts.event_type !== undefined) {
    where.push("event_type = ?");
    params.push(opts.event_type);
  }
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    where.push("area = ?");
    params.push(opts.area);
  }
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    where.push("team = ?");
    params.push(opts.team);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = getDb()
    .prepare(`SELECT * FROM task_events${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY id DESC LIMIT ?`)
    .all(...params, limit) as TaskEventRow[];
  return rows.reverse().map(toTaskEvent);
}

export interface TaskResult {
  task: Task;
  events: TaskEvent[];
  test_results: TestResult[];
  memories: Memory[];
  messages: Message[];
}

export function taskResult(taskId: number, limit = 100): TaskResult {
  const task = getTask(taskId);
  const bounded = Math.min(Math.max(limit, 1), 500);
  return {
    task,
    events: listTaskEvents({ task_id: taskId, limit: bounded }),
    test_results: listTestResults({ task_id: taskId, limit: bounded }),
    memories: listMemories({ task_id: taskId, limit: bounded }),
    messages: threadMessages(task.thread_id, bounded),
  };
}

export interface WaitForTaskOptions {
  task_id: number;
  wait_s?: number;
  since_updated_at?: number;
  limit?: number;
}

export interface WaitForTaskResult extends TaskResult {
  timed_out: boolean;
  holder: AgentDirectoryEntry | null;
  latest_event: TaskEvent | null;
  latest_message: Message | null;
  latest_test_result: TestResult | null;
  suggested_next_actions: string[];
}

export async function waitForTask(opts: WaitForTaskOptions): Promise<WaitForTaskResult> {
  const waitMs = Math.min(Math.max(opts.wait_s ?? 110, 0), MAX_INBOX_WAIT_S) * 1000;
  const startTask = getTask(opts.task_id);
  const since = opts.since_updated_at ?? startTask.updated_at;
  const deadline = now() + waitMs;
  let timedOut = false;

  while (true) {
    const current = getTask(opts.task_id);
    const result = taskResult(opts.task_id, opts.limit ?? 50);
    const latestEvent = result.events.at(-1) ?? null;
    const latestMessage = result.messages.at(-1) ?? null;
    const latestTestResult = result.test_results.at(-1) ?? null;
    const hasActivity =
      current.updated_at > since ||
      (latestEvent !== null && latestEvent.created_at > since) ||
      (latestMessage !== null && latestMessage.created_at > since) ||
      (latestTestResult !== null && latestTestResult.created_at > since) ||
      TERMINAL_TASK_STATES.includes(current.state);
    if (hasActivity || waitMs === 0) {
      return decorateWaitForTask(result, timedOut);
    }
    if (now() >= deadline) {
      timedOut = true;
      return decorateWaitForTask(result, timedOut);
    }
    await sleep(POLL_INTERVAL_MS);
  }
}

function decorateWaitForTask(result: TaskResult, timedOut: boolean): WaitForTaskResult {
  const holder = result.task.claimed_by
    ? directory({ project: PROJECT_WILDCARD, area: AREA_WILDCARD }).find((agent) => agent.name === result.task.claimed_by) ?? null
    : null;
  const latestEvent = result.events.at(-1) ?? null;
  const latestMessage = result.messages.at(-1) ?? null;
  const latestTestResult = result.test_results.at(-1) ?? null;
  const suggested: string[] = [];
  if (timedOut) suggested.push("No task update before timeout; check holder presence or project_board.");
  if (result.task.pending_assignee) suggested.push(`Start/register ${result.task.pending_assignee}; assignment is pending.`);
  if (result.task.ack_required && result.task.acknowledged_at === null) suggested.push("Task still needs acknowledgement.");
  if (result.task.state === "blocked") suggested.push("Resolve blocker or reassign/release the task.");
  if (result.task.stale === true) suggested.push("Holder appears stale; consider handoff_task or release_task.");
  if (result.task.review_required && result.task.review_state !== "approved") suggested.push("Task requires approved review before completion.");
  if (TERMINAL_TASK_STATES.includes(result.task.state)) suggested.push("Task is terminal; inspect task_result/final_report.");
  if (suggested.length === 0) suggested.push("Continue waiting or inspect latest task events.");
  return {
    ...result,
    timed_out: timedOut,
    holder,
    latest_event: latestEvent,
    latest_message: latestMessage,
    latest_test_result: latestTestResult,
    suggested_next_actions: suggested,
  };
}

export interface CancelTaskOptions {
  agent: string;
  task_id: number;
  reason?: string | null;
}

export interface CancelTaskResult {
  task: Task;
  event: TaskEvent;
}

export function cancelTask(opts: CancelTaskOptions): CancelTaskResult {
  validateName(opts.agent);
  requireAgent(opts.agent);
  heartbeat(opts.agent);
  const row = getTaskRow(opts.task_id);
  if (row.requested_by !== opts.agent && row.claimed_by !== opts.agent) {
    throw new BusError("TASK_FORBIDDEN", "only the requester or current holder can cancel a task");
  }
  if (TERMINAL_TASK_STATES.includes(row.state)) {
    throw new BusError("TASK_INVALID_TRANSITION", `task ${opts.task_id} is already in terminal state '${row.state}'`);
  }
  const ts = now();
  getDb()
    .prepare(
      `UPDATE tasks
         SET state = 'canceled', phase = 'canceled', result = COALESCE(?, result), finished_at = ?, updated_at = ?
       WHERE id = ?`,
    )
    .run(opts.reason ?? null, ts, ts, opts.task_id);
  const event = recordTaskEvent({
    by_agent: opts.agent,
    task_id: opts.task_id,
    event_type: "cancel",
    phase: "canceled",
    message: opts.reason ?? "Task canceled",
  });
  const task = getTask(opts.task_id);
  if (task.claimed_by && task.claimed_by !== opts.agent) {
    send({ from: opts.agent, to: task.claimed_by, content: `canceled task #${task.id}: ${task.title}`, thread_id: task.thread_id });
  }
  if (task.requested_by !== opts.agent) {
    send({ from: opts.agent, to: task.requested_by, content: `canceled task #${task.id}: ${task.title}`, thread_id: task.thread_id });
  }
  runLocalHook("task.canceled", task);
  return { task, event };
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
  team: string | null;
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
  team: string | null;
  created_at: number;
  updated_at: number;
}

function toDecision(row: DecisionRow): Decision {
  return {
    ...row,
    implemented: row.implemented === 1,
  };
}

export interface TestResult {
  id: number;
  by_agent: string;
  task_id: number | null;
  command: string;
  status: TestResultStatus;
  output_summary: string | null;
  project: string | null;
  area: string | null;
  team: string | null;
  created_at: number;
}

interface TestResultRow {
  id: number;
  by_agent: string;
  task_id: number | null;
  command: string;
  status: TestResultStatus;
  output_summary: string | null;
  project: string | null;
  area: string | null;
  team: string | null;
  created_at: number;
}

function toTestResult(row: TestResultRow): TestResult {
  return { ...row };
}

export interface RecordDecisionOptions {
  by_agent: string;
  decision: string;
  rationale?: string | null;
  implemented?: boolean;
  project?: string | null;
  area?: string | null;
  team?: string | null;
}

export function recordDecision(opts: RecordDecisionOptions): Decision {
  validateName(opts.by_agent);
  validateProject(opts.project);
  validateArea(opts.area);
  validateTeam(opts.team);
  const agent = requireAgent(opts.by_agent);
  if (opts.decision.trim().length === 0) {
    throw new BusError("INVALID_INPUT", "decision must be non-empty");
  }
  const ts = now();
  const project = opts.project !== undefined ? opts.project : agent.project;
  const area = opts.area !== undefined ? opts.area : agent.area;
  const team = opts.team !== undefined ? opts.team : agent.team;
  const info = getDb()
    .prepare(
      `INSERT INTO decisions
         (by_agent, decision, rationale, implemented, project, area, team, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.by_agent,
      opts.decision,
      opts.rationale ?? null,
      opts.implemented === true ? 1 : 0,
      project,
      area,
      team,
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
  team?: string;
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
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    validateTeam(opts.team);
    where.push("team = ?");
    params.push(opts.team);
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

export interface RecordTestResultOptions {
  by_agent: string;
  task_id?: number | null;
  command: string;
  status: TestResultStatus;
  output_summary?: string | null;
  project?: string | null;
  area?: string | null;
  team?: string | null;
}

export function recordTestResult(opts: RecordTestResultOptions): TestResult {
  validateName(opts.by_agent);
  validateTestResultStatus(opts.status);
  validateProject(opts.project);
  validateArea(opts.area);
  validateTeam(opts.team);
  const agent = requireAgent(opts.by_agent);
  if (opts.command.trim().length === 0) throw new BusError("INVALID_INPUT", "command must be non-empty");
  let project = opts.project !== undefined ? opts.project : agent.project;
  let area = opts.area !== undefined ? opts.area : agent.area;
  let team = opts.team !== undefined ? opts.team : agent.team;
  if (opts.task_id !== undefined && opts.task_id !== null) {
    const task = getTask(opts.task_id);
    project = opts.project !== undefined ? opts.project : task.project;
    area = opts.area !== undefined ? opts.area : task.area;
    team = opts.team !== undefined ? opts.team : task.team;
  }
  const ts = now();
  const info = getDb()
    .prepare(
      `INSERT INTO test_results (by_agent, task_id, command, status, output_summary, project, area, team, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(opts.by_agent, opts.task_id ?? null, opts.command, opts.status, opts.output_summary ?? null, project, area, team, ts);
  const row = getDb().prepare("SELECT * FROM test_results WHERE id = ?").get(info.lastInsertRowid) as TestResultRow;
  return toTestResult(row);
}

export interface ListTestResultsOptions {
  task_id?: number;
  by_agent?: string;
  status?: TestResultStatus;
  project?: string;
  area?: string;
  team?: string;
  limit?: number;
}

export function listTestResults(opts: ListTestResultsOptions = {}): TestResult[] {
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) validateProject(opts.project);
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) validateArea(opts.area);
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) validateTeam(opts.team);
  validateTestResultStatus(opts.status);
  if (opts.by_agent !== undefined) validateName(opts.by_agent);
  const where: string[] = [];
  const params: unknown[] = [];
  if (opts.task_id !== undefined) {
    where.push("task_id = ?");
    params.push(opts.task_id);
  }
  if (opts.by_agent !== undefined) {
    where.push("by_agent = ?");
    params.push(opts.by_agent);
  }
  if (opts.status !== undefined) {
    where.push("status = ?");
    params.push(opts.status);
  }
  if (opts.project !== undefined && opts.project !== PROJECT_WILDCARD) {
    where.push("project = ?");
    params.push(opts.project);
  }
  if (opts.area !== undefined && opts.area !== AREA_WILDCARD) {
    where.push("area = ?");
    params.push(opts.area);
  }
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    where.push("team = ?");
    params.push(opts.team);
  }
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 500);
  const rows = getDb()
    .prepare(`SELECT * FROM test_results${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at DESC, id DESC LIMIT ?`)
    .all(...params, limit) as TestResultRow[];
  return rows.map(toTestResult);
}

export interface Memory {
  id: number;
  by_agent: string;
  agent: string | null;
  kind: MemoryKind;
  content: string;
  project: string | null;
  area: string | null;
  team: string | null;
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
  team: string | null;
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
  team?: string | null;
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
  validateTeam(opts.team);
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
  const team = opts.team !== undefined ? opts.team : byAgent.team;
  const info = getDb()
    .prepare(
      `INSERT INTO memories
         (by_agent, agent, kind, content, project, area, team, task_id, thread_id, pinned, supersedes_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      opts.by_agent,
      opts.agent ?? null,
      opts.kind,
      opts.content,
      project,
      area,
      team,
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
  team?: string;
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
  if (opts.team !== undefined && opts.team !== TEAM_WILDCARD) {
    validateTeam(opts.team);
    where.push("team = ?");
    params.push(opts.team);
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
  team?: string;
  agent?: string;
  limit?: number;
}

export interface SessionBrief {
  project: string | null;
  area: string | null;
  team: string | null;
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

export interface ProjectBoard {
  agents: AgentDirectoryEntry[];
  open_tasks: Task[];
  active_tasks: Task[];
  blocked_tasks: Task[];
  waiting_review: Task[];
  waiting_acknowledgement: Task[];
  stale_tasks: Task[];
  scope_conflicts: Array<{ task_id: number; title: string; conflicts: ScopeConflict[] }>;
  pinned_risks: Memory[];
  pinned_handoffs: Memory[];
  suggested_next_actions: string[];
}

export function sessionBrief(opts: SessionBriefOptions = {}): SessionBrief {
  if (opts.agent !== undefined) validateName(opts.agent);
  const limit = Math.min(Math.max(opts.limit ?? 10, 1), 50);
  const scope = { project: opts.project, area: opts.area, team: opts.team };
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
    team: opts.team ?? null,
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

export function projectBoard(opts: SessionBriefOptions = {}): ProjectBoard {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const scope = { project: opts.project, area: opts.area, team: opts.team };
  const agents = directory(scope).slice(0, limit);
  const tasks = listTasks({ ...scope, include_terminal: false, limit: 500 });
  const openTasks = tasks.filter((task) => task.state === "open").slice(0, limit);
  const activeTasks = tasks.filter((task) => ["claimed", "working"].includes(task.state)).slice(0, limit);
  const blockedTasks = tasks.filter((task) => task.state === "blocked").slice(0, limit);
  const waitingReview = tasks
    .filter((task) => task.review_required && task.review_state === "pending")
    .slice(0, limit);
  const waitingAck = tasks
    .filter((task) => task.ack_required && task.acknowledged_at === null && (task.pending_assignee !== null || task.claimed_by !== null))
    .slice(0, limit);
  const staleTasks = tasks.filter((task) => task.stale === true).slice(0, limit);
  const scopeConflicts = tasks
    .filter((task) => task.edit_scope.length > 0 && (task.state === "claimed" || task.state === "working" || task.state === "blocked"))
    .map((task) => ({
      task_id: task.id,
      title: task.title,
      conflicts: checkScopeConflicts({
        edit_scope: task.edit_scope,
        project: task.project,
        area: task.area,
        team: task.team,
        exclude_task_id: task.id,
      }),
    }))
    .filter((row) => row.conflicts.length > 0)
    .slice(0, limit);
  const pinnedRisks = listMemories({ ...scope, kind: "risk", pinned: true, limit });
  const pinnedHandoffs = listMemories({ ...scope, kind: "handoff", pinned: true, limit });
  const suggested: string[] = [];
  if (scopeConflicts.length > 0) suggested.push("Resolve overlapping edit_scope before allowing more edits.");
  if (waitingAck.length > 0) suggested.push("Follow up with agents who have not acknowledged assigned work.");
  if (blockedTasks.length > 0) suggested.push("Review blocked tasks and update blockers or release ownership.");
  if (waitingReview.length > 0) suggested.push("Assign a verifier to pending review tasks.");
  if (staleTasks.length > 0) suggested.push("Check stale task holders and reassign or release if needed.");
  if (openTasks.length > 0) suggested.push("Assign or claim open tasks with explicit mode and file_scope.");
  return {
    agents,
    open_tasks: openTasks,
    active_tasks: activeTasks,
    blocked_tasks: blockedTasks,
    waiting_review: waitingReview,
    stale_tasks: staleTasks,
    waiting_acknowledgement: waitingAck,
    scope_conflicts: scopeConflicts,
    pinned_risks: pinnedRisks,
    pinned_handoffs: pinnedHandoffs,
    suggested_next_actions: suggested,
  };
}

export interface TeamBoardOptions extends SessionBriefOptions {
  team: string;
}

export function teamBoard(opts: TeamBoardOptions): ProjectBoard {
  validateTeam(opts.team);
  return projectBoard({ ...opts, team: opts.team });
}

export type ActivityItem =
  | {
      source: "message";
      at: number;
      id: number;
      summary: string;
      message: Message;
    }
  | {
      source: "task_event";
      at: number;
      id: number;
      summary: string;
      event: TaskEvent;
    }
  | {
      source: "test_result";
      at: number;
      id: number;
      summary: string;
      test_result: TestResult;
    }
  | {
      source: "decision";
      at: number;
      id: number;
      summary: string;
      decision: Decision;
    }
  | {
      source: "memory";
      at: number;
      id: number;
      summary: string;
      memory: Memory;
    };

export interface ActivityOptions extends SessionBriefOptions {
  since?: number;
}

export function activityTimeline(opts: ActivityOptions = {}): ActivityItem[] {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const scope = { project: opts.project, area: opts.area, team: opts.team };
  const since = opts.since ?? 0;
  const items: ActivityItem[] = [];

  for (const message of recentMessages({ ...scope, limit })) {
    if (message.created_at < since) continue;
    items.push({
      source: "message",
      at: message.created_at,
      id: message.id,
      summary: `${message.from_agent} ${message.kind === "ask" ? "asked" : message.kind === "reply" ? "replied to" : "messaged"} ${message.to_agent}: ${message.content}`,
      message,
    });
  }
  for (const event of listTaskEvents({ ...scope, limit })) {
    if (event.created_at < since) continue;
    items.push({
      source: "task_event",
      at: event.created_at,
      id: event.id,
      summary: `${event.by_agent} ${event.event_type} task #${event.task_id}${event.phase ? ` -> ${event.phase}` : ""}: ${event.message}`,
      event,
    });
  }
  for (const result of listTestResults({ ...scope, limit })) {
    if (result.created_at < since) continue;
    items.push({
      source: "test_result",
      at: result.created_at,
      id: result.id,
      summary: `${result.by_agent} recorded ${result.status} test${result.task_id ? ` for task #${result.task_id}` : ""}: ${result.command}${result.output_summary ? ` - ${result.output_summary}` : ""}`,
      test_result: result,
    });
  }
  for (const decision of listDecisions({ ...scope, limit })) {
    if (decision.created_at < since) continue;
    items.push({
      source: "decision",
      at: decision.created_at,
      id: decision.id,
      summary: `${decision.by_agent} decided: ${decision.decision}${decision.rationale ? ` - ${decision.rationale}` : ""}`,
      decision,
    });
  }
  for (const memory of listMemories({ ...scope, since, limit })) {
    items.push({
      source: "memory",
      at: memory.created_at,
      id: memory.id,
      summary: `${memory.by_agent} remembered [${memory.kind}]: ${memory.content}`,
      memory,
    });
  }

  return items
    .sort((a, b) => a.at - b.at || sourceOrder(a.source) - sourceOrder(b.source) || a.id - b.id)
    .slice(-limit);
}

export interface Cockpit {
  waiting_on: string[];
  ready: string[];
  blockers: string[];
  suggested_next_actions: string[];
  board: ProjectBoard;
}

export function cockpit(opts: SessionBriefOptions = {}): Cockpit {
  const board = projectBoard(opts);
  const waitingOn: string[] = [];
  const ready: string[] = [];
  const blockers: string[] = [];

  for (const task of board.waiting_acknowledgement) {
    waitingOn.push(`task #${task.id} acknowledgement from ${task.pending_assignee ?? task.claimed_by ?? "assignee"}: ${task.title}`);
  }
  for (const task of board.waiting_review) {
    waitingOn.push(`task #${task.id} review: ${task.title}`);
  }
  for (const task of board.blocked_tasks) {
    blockers.push(`task #${task.id} blocked${task.blocked_reason ? `: ${task.blocked_reason}` : ""}`);
  }
  for (const task of board.stale_tasks) {
    blockers.push(`task #${task.id} stale holder ${task.claimed_by ?? "unknown"}: ${task.title}`);
  }
  for (const row of board.scope_conflicts) {
    blockers.push(`task #${row.task_id} edit scope overlaps ${row.conflicts.map((conflict) => `#${conflict.task_id}`).join(", ")}`);
  }
  const completedNeedsReview = listTasks({
    project: opts.project,
    area: opts.area,
    team: opts.team,
    state: "completed",
    include_terminal: true,
    manager_reviewed: false,
    limit: opts.limit ?? 50,
  });
  for (const task of completedNeedsReview) {
    ready.push(`task #${task.id} completed, needs manager review: ${task.title}`);
  }
  for (const task of board.open_tasks) {
    ready.push(`task #${task.id} open: ${task.title}`);
  }

  const suggested = [...board.suggested_next_actions];
  if (ready.some((item) => item.includes("completed, needs manager review"))) {
    suggested.push("Review completed tasks and set manager_reviewed when accepted.");
  }
  if (waitingOn.length === 0 && blockers.length === 0 && ready.length === 0) {
    suggested.push("No immediate manager action; check activity for recent discussion.");
  }

  return {
    waiting_on: waitingOn,
    ready,
    blockers,
    suggested_next_actions: suggested,
    board,
  };
}

export interface AgentNowOptions {
  agent: string;
  task_id?: number;
  phase?: string | null;
  note?: string | null;
  status?: AgentStatus;
}

export interface AgentNowResult {
  agent: Agent;
  task: Task | null;
  event: TaskEvent | null;
  suggested_next_actions: string[];
}

export function agentNow(opts: AgentNowOptions): AgentNowResult {
  validateName(opts.agent);
  const agent = setAgentStatus(opts.agent, opts.status ?? (opts.task_id !== undefined ? "working" : "idle"));
  let task: Task | null = null;
  let event: TaskEvent | null = null;

  if (opts.task_id !== undefined) {
    const current = getTask(opts.task_id);
    const nextState = current.state === "claimed" || current.state === "blocked" ? "working" : undefined;
    task = updateTask({
      agent: opts.agent,
      task_id: opts.task_id,
      state: nextState,
      phase: opts.phase,
    });
    if (opts.note !== undefined || opts.phase !== undefined) {
      event = recordTaskEvent({
        by_agent: opts.agent,
        task_id: opts.task_id,
        event_type: opts.phase !== undefined ? "phase" : "progress",
        phase: opts.phase,
        message: opts.note ?? (opts.phase ? `phase -> ${opts.phase}` : "progress update"),
        metadata: {
          status: agent.status,
        },
      });
      task = getTask(opts.task_id);
    }
  }

  return {
    agent,
    task,
    event,
    suggested_next_actions: [
      opts.task_id !== undefined ? `task #${opts.task_id} is visible in activity, cockpit, and task_result` : `agent ${opts.agent} status updated`,
      "Tell the user what changed and continue local work.",
    ],
  };
}

function sourceOrder(source: ActivityItem["source"]): number {
  switch (source) {
    case "message":
      return 0;
    case "task_event":
      return 1;
    case "test_result":
      return 2;
    case "decision":
      return 3;
    case "memory":
      return 4;
  }
}

export interface FinalReport {
  implemented: string[];
  not_implemented: string[];
  known_risks: string[];
  tests_passed: string[];
  test_results: TestResult[];
  manual_tests_needed: string[];
  safe_to_commit: boolean;
  safe_to_push: boolean;
  safe_to_deploy: false;
}

export interface ReviewGateReport {
  ok: boolean;
  blockers: string[];
  warnings: string[];
  final_report: FinalReport;
  board: ProjectBoard;
}

export function finalReport(opts: ListTasksOptions = {}): FinalReport {
  const tasks = listTasks({ ...opts, include_terminal: true, limit: opts.limit ?? 500 });
  const testResults = listTestResults({ project: opts.project, area: opts.area, limit: 100 });
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
  for (const result of testResults.filter((row) => row.status === "passed")) {
    testsPassed.push(`${result.command}${result.output_summary ? ` - ${result.output_summary}` : ""}`);
  }
  const manualTestsNeeded = tasks
    .filter((task) => task.state !== "completed" || task.manager_reviewed === false || (task.review_required && task.review_state !== "approved"))
    .map((task) => task.title);
  const safe = notImplemented.length === 0 && knownRisks.length === 0 && manualTestsNeeded.length === 0;
  return {
    implemented,
    not_implemented: notImplemented,
    known_risks: knownRisks,
    tests_passed: testsPassed,
    test_results: testResults,
    manual_tests_needed: manualTestsNeeded,
    safe_to_commit: safe,
    safe_to_push: safe,
    safe_to_deploy: false,
  };
}

export function reviewGate(opts: ListTasksOptions = {}): ReviewGateReport {
  const board = projectBoard(opts);
  const report = finalReport(opts);
  const blockers: string[] = [];
  const warnings: string[] = [];
  if (board.active_tasks.length > 0) blockers.push(`${board.active_tasks.length} active task(s) still running`);
  if (board.blocked_tasks.length > 0) blockers.push(`${board.blocked_tasks.length} blocked task(s)`);
  if (board.waiting_review.length > 0) blockers.push(`${board.waiting_review.length} task(s) waiting for review`);
  if (board.waiting_acknowledgement.length > 0) warnings.push(`${board.waiting_acknowledgement.length} task(s) waiting for acknowledgement`);
  if (board.stale_tasks.length > 0) warnings.push(`${board.stale_tasks.length} stale task holder(s)`);
  if (board.scope_conflicts.length > 0) blockers.push(`${board.scope_conflicts.length} edit scope conflict(s)`);
  if (!report.safe_to_commit) blockers.push("final_report says safe_to_commit=false");
  if (!report.safe_to_push) blockers.push("final_report says safe_to_push=false");
  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    final_report: report,
    board,
  };
}
