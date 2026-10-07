import { WORKSPACE_SCHEMA_SQL } from "./schema";
import type { Env, RpcRequest, RpcResponse, WorkspaceContext } from "../shared/types";
import { json } from "../shared/http";
import { now } from "../shared/ids";

type SqlDatabase = DurableObjectStorage["sql"];

interface AgentRow {
  name: string;
  capabilities: string;
  registered_at: number;
  last_seen: number;
  paused: number;
  project: string | null;
  area: string | null;
  team: string | null;
  role: string | null;
  routing_weight: number;
  status: string;
  session_id: string | null;
  removed_at: number | null;
  bus_version: string | null;
  listening_until: number | null;
}

interface MessageRow {
  id: number;
  from_agent: string;
  to_agent: string;
  kind: string;
  content: string;
  reply_to: number | null;
  status: string;
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
  priority: string;
}

function rows<T>(cursor: unknown): T[] {
  const c = cursor as { toArray?: () => T[] };
  if (typeof c.toArray === "function") return c.toArray();
  return [];
}

function one<T>(cursor: unknown): T | undefined {
  return rows<T>(cursor)[0];
}

function validateName(kind: string, value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 64 || !/^[a-zA-Z0-9_.-]+$/.test(value)) {
    throw new Error(`${kind} must be 1-64 chars and contain only letters, digits, _ . -`);
  }
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function toAgent(row: AgentRow): Record<string, unknown> {
  return {
    ...row,
    capabilities: JSON.parse(row.capabilities) as string[],
    paused: row.paused === 1,
  };
}

function toMessage(row: MessageRow): Record<string, unknown> {
  return {
    ...row,
    thread_id: row.thread_id ?? "",
  };
}

function previewMessage(row: MessageRow, previewChars = 300): Record<string, unknown> {
  const contentLength = row.content.length;
  const truncated = contentLength > previewChars;
  const { content: _content, ...rest } = toMessage(row);
  return {
    ...rest,
    content_preview: truncated ? row.content.slice(0, previewChars) : row.content,
    content_length: contentLength,
    truncated,
  };
}

function scopeClause(input: Record<string, unknown>, prefix = ""): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const key of ["project", "area", "team"] as const) {
    const value = input[key];
    if (typeof value === "string" && value !== "*") {
      clauses.push(`${prefix}${key} = ?`);
      params.push(value);
    }
  }
  return { sql: clauses.length ? ` AND ${clauses.join(" AND ")}` : "", params };
}

function makeThreadId(): string {
  return `t_${crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class WorkspaceBusObject implements DurableObject {
  private readonly sql: SqlDatabase;
  private initialized = false;

  constructor(private readonly state: DurableObjectState, private readonly env: Env) {
    this.sql = state.storage.sql;
  }

  async fetch(request: Request): Promise<Response> {
    await this.ensureSchema();
    if (request.method !== "POST") {
      return json({ ok: true, service: "agent-bus-cloud-workspace" });
    }
    const rpc = (await request.json()) as RpcRequest;
    try {
      const result = await this.dispatch(rpc.op, (rpc.input ?? {}) as Record<string, unknown>, rpc.context);
      return json({ ok: true, result } satisfies RpcResponse);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return json({ ok: false, error: { code: "BUS_ERROR", message } } satisfies RpcResponse, { status: 400 });
    }
  }

  private async ensureSchema(): Promise<void> {
    if (this.initialized) return;
    this.sql.exec(WORKSPACE_SCHEMA_SQL);
    this.initialized = true;
  }

  private async dispatch(op: string, input: Record<string, unknown>, context: WorkspaceContext): Promise<unknown> {
    switch (op) {
      case "register":
        return this.register(input);
      case "whois":
      case "directory":
        return this.directory(input);
      case "send":
        return this.send(input);
      case "send_team":
        return this.sendTeam(input);
      case "subscribe":
        return this.subscribe(input);
      case "unsubscribe":
        return this.unsubscribe(input);
      case "subscribers":
        return this.subscribers(input);
      case "send_channel":
        return this.sendChannel(input);
      case "inbox":
        return this.inbox(input);
      case "inbox_status":
        return this.inboxStatus(input);
      case "inbox_previews":
        return this.inboxPreviews(input);
      case "get_message":
        return this.getMessage(input);
      case "ack":
        return this.ack(input);
      case "ask":
        return this.ask(input, true);
      case "ask_async":
        return this.ask(input, false);
      case "ask_best":
        return this.askBest(input, true);
      case "ask_team":
        return this.askTeam(input);
      case "reply":
        return this.reply(input);
      case "reply_thread":
        return this.replyThread(input);
      case "message_status":
        return this.messageStatus(input);
      case "why_no_reply":
        return this.whyNoReply(input);
      case "thread":
        return this.thread(input);
      case "recent":
        return this.recent(input);
      case "remove_agent":
        return this.removeAgent(input);
      case "delete_team":
        return this.deleteTeam(input);
      case "set_agent_status":
        return this.setAgentStatus(input);
      case "sleep_agent":
        return this.setAgentStatus({ ...input, status: "sleeping" });
      case "wake_agent":
        return this.setAgentStatus({ ...input, status: "idle" });
      case "create_task":
        return this.createTask(input);
      case "delegate":
        return this.delegate(input);
      case "delegate_team":
        return this.delegateTeam(input);
      case "claim_task":
        return this.claimTask(input);
      case "assign_task":
        return this.assignTask(input);
      case "claim_best_task":
        return this.claimBestTask(input);
      case "list_tasks":
      case "tasks":
        return this.listTasks(input);
      case "get_task":
        return this.getTask(input);
      case "update_task":
        return this.updateTask(input);
      case "release_task":
        return this.releaseTask(input);
      case "acknowledge_task":
        return this.acknowledgeTask(input);
      case "submit_review":
        return this.submitReview(input);
      case "handoff_task":
        return this.handoffTask(input);
      case "check_scope_conflicts":
        return this.checkScopeConflicts(input);
      case "cancel_task":
        return this.cancelTask(input);
      case "wait_for_task":
        return this.taskResult(input);
      case "record_task_event":
        return this.recordTaskEvent(input);
      case "list_task_events":
        return this.listTaskEvents(input);
      case "record_test_result":
        return this.recordTestResult(input);
      case "list_test_results":
        return this.listTestResults(input);
      case "task_result":
        return this.taskResult(input);
      case "final_report":
        return this.finalReport(input);
      case "review_gate":
        return this.reviewGate(input);
      case "activity":
        return this.activity(input);
      case "cockpit":
        return this.cockpit(input);
      case "now":
        return this.agentNow(input);
      case "team_board":
      case "project_board":
        return this.board(input);
      case "remember":
        return this.remember(input);
      case "list_memories":
        return this.listMemories(input);
      case "pin_memory":
        return this.setMemoryPinned(input, true);
      case "unpin_memory":
        return this.setMemoryPinned(input, false);
      case "session_brief":
        return this.sessionBrief(input);
      case "record_decision":
        return this.recordDecision(input);
      case "list_decisions":
        return this.listDecisions(input);
      case "cloud_workspace":
        return { workspace: context.slug, workspace_id: context.id, role: context.role };
      default:
        return this.toolPlanned(op);
    }
  }

  private toolPlanned(op: string): unknown {
    return {
      implemented: false,
      op,
      message: "This Agent Bus Cloud scaffold exposes the full tool registry; this operation is queued for parity porting.",
    };
  }

  private register(input: Record<string, unknown>): unknown {
    const name = validateName("agent name", input.name);
    const at = now();
    const capabilities = Array.isArray(input.capabilities) ? input.capabilities.filter((v) => typeof v === "string") : [];
    const replace = input.replace === true;
    const existing = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ? AND removed_at IS NULL", name));
    if (existing && !replace) throw new Error(`agent ${name} is already registered`);
    this.sql.exec(
      `INSERT INTO agents (
        name, capabilities, registered_at, last_seen, paused, project, area, team,
        role, routing_weight, status, session_id, removed_at, bus_version, listening_until
      ) VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, NULL, ?, NULL)
      ON CONFLICT(name) DO UPDATE SET
        capabilities = excluded.capabilities,
        last_seen = excluded.last_seen,
        paused = 0,
        project = excluded.project,
        area = excluded.area,
        team = excluded.team,
        role = excluded.role,
        routing_weight = excluded.routing_weight,
        status = excluded.status,
        session_id = excluded.session_id,
        removed_at = NULL,
        bus_version = excluded.bus_version`,
      name,
      JSON.stringify(capabilities),
      at,
      at,
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      optionalString(input.role),
      Number.isInteger(input.routing_weight) ? input.routing_weight : 0,
      optionalString(input.status) ?? "idle",
      optionalString(input.session_id),
      "cloud"
    );
    return toAgent(one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", name))!);
  }

  private directory(input: Record<string, unknown>): unknown {
    const scope = scopeClause(input);
    const agents = rows<AgentRow>(
      this.sql.exec(`SELECT * FROM agents WHERE removed_at IS NULL${scope.sql} ORDER BY last_seen DESC`, ...scope.params),
    ).map(toAgent);
    return { agents };
  }

  private send(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const to = validateName("to", input.to);
    const message = String(input.message ?? "");
    const threadId = optionalString(input.thread_id) ?? makeThreadId();
    const sender = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", from));
    if (!sender) throw new Error(`unknown sender ${from}`);
    const recipient = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", to));
    if (!recipient) throw new Error(`unknown recipient ${to}`);
    const at = now();
    this.sql.exec(
      `INSERT INTO messages (
        from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, project, area, team, priority
      ) VALUES (?, ?, 'msg', ?, NULL, 'pending', ?, ?, ?, ?, ?, 'normal')`,
      from,
      to,
      message,
      at,
      threadId,
      sender.project,
      sender.area,
      sender.team,
    );
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id, thread_id: threadId, delivered_to: to };
  }

  private sendTeam(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const team = validateName("team", input.team);
    const message = String(input.message ?? "");
    const threadId = optionalString(input.thread_id) ?? makeThreadId();
    const includeSelf = input.include_self === true;
    const scope = scopeClause({ ...input, team });
    const recipients = rows<AgentRow>(
      this.sql.exec(
        `SELECT * FROM agents WHERE removed_at IS NULL AND paused = 0${scope.sql} ORDER BY last_seen DESC`,
        ...scope.params,
      ),
    ).filter((agent) => includeSelf || agent.name !== from);
    const at = now();
    for (const agent of recipients) {
      this.sql.exec(
        `INSERT INTO messages (
          from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, project, area, team, priority
        ) VALUES (?, ?, 'msg', ?, NULL, 'pending', ?, ?, ?, ?, ?, 'normal')`,
        from,
        agent.name,
        message,
        at,
        threadId,
        agent.project,
        agent.area,
        agent.team,
      );
    }
    return { thread_id: threadId, recipients: recipients.map((agent) => agent.name) };
  }

  private subscribe(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const channel = validateName("channel", input.channel);
    this.sql.exec(
      "INSERT OR REPLACE INTO subscriptions (channel, agent, subscribed_at) VALUES (?, ?, ?)",
      channel,
      agent,
      now(),
    );
    return { channel, agent, subscribed: true };
  }

  private unsubscribe(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const channel = validateName("channel", input.channel);
    this.sql.exec("DELETE FROM subscriptions WHERE channel = ? AND agent = ?", channel, agent);
    return { channel, agent, subscribed: false };
  }

  private subscribers(input: Record<string, unknown>): unknown {
    const channel = validateName("channel", input.channel);
    const subscribers = rows<{ agent: string; subscribed_at: number }>(
      this.sql.exec("SELECT agent, subscribed_at FROM subscriptions WHERE channel = ? ORDER BY agent ASC", channel),
    );
    return { channel, subscribers };
  }

  private sendChannel(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const channel = validateName("channel", input.channel);
    const message = String(input.message ?? "");
    const threadId = optionalString(input.thread_id) ?? makeThreadId();
    const subscribers = rows<{ agent: string }>(
      this.sql.exec("SELECT agent FROM subscriptions WHERE channel = ? AND agent <> ? ORDER BY agent ASC", channel, from),
    );
    const sender = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", from));
    if (!sender) throw new Error(`unknown sender ${from}`);
    const at = now();
    for (const subscriber of subscribers) {
      this.sql.exec(
        `INSERT INTO messages (
          from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id,
          channel, project, area, team, priority
        ) VALUES (?, ?, 'msg', ?, NULL, 'pending', ?, ?, ?, ?, ?, ?, 'normal')`,
        from,
        subscriber.agent,
        message,
        at,
        threadId,
        channel,
        sender.project,
        sender.area,
        sender.team,
      );
    }
    return { channel, thread_id: threadId, recipients: subscribers.map((row) => row.agent) };
  }

  private inbox(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 500);
    const claimSeconds = Number(input.claim_s ?? 0);
    const markDelivered = input.mark_delivered !== false && claimSeconds <= 0;
    const scope = scopeClause(input);
    const rowsFound = rows<MessageRow>(
      this.sql.exec(
        `SELECT * FROM messages
         WHERE to_agent = ? AND status = 'pending'
           AND (claim_deadline IS NULL OR claim_deadline < ?)
           ${scope.sql}
         ORDER BY id ASC LIMIT ?`,
        agent,
        now(),
        ...scope.params,
        limit,
      ),
    );
    if (claimSeconds > 0 && rowsFound.length > 0) {
      const deadline = now() + Math.min(Math.max(claimSeconds, 1), 3600) * 1000;
      for (const message of rowsFound) {
        this.sql.exec("UPDATE messages SET claim_deadline = ?, claimed_by = ? WHERE id = ?", deadline, agent, message.id);
      }
    }
    if (markDelivered && rowsFound.length > 0) {
      const at = now();
      for (const message of rowsFound) {
        this.sql.exec("UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?", at, message.id);
      }
    }
    return { messages: rowsFound.map(toMessage) };
  }

  private inboxPreviews(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 100);
    const previewChars = Math.min(Math.max(Number(input.preview_chars ?? 300), 0), 4000);
    const scope = scopeClause(input);
    const found = rows<MessageRow>(
      this.sql.exec(
        `SELECT * FROM messages
         WHERE to_agent = ? AND status = 'pending'
           AND (claim_deadline IS NULL OR claim_deadline < ?)
           ${scope.sql}
         ORDER BY id ASC LIMIT ?`,
        agent,
        now(),
        ...scope.params,
        limit,
      ),
    );
    return { messages: found.map((row) => previewMessage(row, previewChars)) };
  }

  private inboxStatus(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const scope = scopeClause(input);
    const unread = one<{ count: number }>(
      this.sql.exec(
        `SELECT COUNT(*) AS count FROM messages WHERE to_agent = ? AND status = 'pending'
         AND (claim_deadline IS NULL OR claim_deadline < ?)${scope.sql}`,
        agent,
        now(),
        ...scope.params,
      ),
    )?.count ?? 0;
    const inFlight = one<{ count: number }>(
      this.sql.exec(
        `SELECT COUNT(*) AS count FROM messages WHERE to_agent = ? AND status = 'pending'
         AND claim_deadline >= ?${scope.sql}`,
        agent,
        now(),
        ...scope.params,
      ),
    )?.count ?? 0;
    const last = one<MessageRow>(
      this.sql.exec(`SELECT * FROM messages WHERE to_agent = ?${scope.sql} ORDER BY id DESC LIMIT 1`, agent, ...scope.params),
    );
    return {
      agent,
      unread,
      in_flight: inFlight,
      last_message: last ? previewMessage(last, 200) : null,
      summary: unread > 0 ? `${unread} unread message${unread === 1 ? "" : "s"}` : last ? `no unread messages; last message #${last.id} was ${last.status}` : "no messages",
    };
  }

  private getMessage(input: Record<string, unknown>): unknown {
    const id = Number(input.message_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("message_id is required");
    const row = one<MessageRow>(this.sql.exec("SELECT * FROM messages WHERE id = ?", id));
    if (!row) throw new Error(`message ${id} not found`);
    const includeContent = input.include_content !== false;
    const previewChars = Math.min(Math.max(Number(input.preview_chars ?? 4000), 0), 4000);
    return { message: includeContent ? toMessage(row) : previewMessage(row, previewChars) };
  }

  private ack(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const id = Number(input.message_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("message_id is required");
    const at = now();
    this.sql.exec(
      "UPDATE messages SET status = 'delivered', delivered_at = ?, claim_deadline = NULL, claimed_by = NULL WHERE id = ? AND claimed_by = ?",
      at,
      id,
      agent,
    );
    return { message_id: id, acknowledged_by: agent };
  }

  private async ask(input: Record<string, unknown>, blocking: boolean): Promise<unknown> {
    const from = validateName("from", input.from);
    const to = validateName("to", input.to);
    const question = String(input.question ?? "");
    const threadId = optionalString(input.thread_id) ?? makeThreadId();
    const sender = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", from));
    if (!sender) throw new Error(`unknown sender ${from}`);
    const recipient = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ? AND removed_at IS NULL", to));
    if (!recipient) throw new Error(`unknown recipient ${to}`);
    const at = now();
    this.sql.exec(
      `INSERT INTO messages (
        from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, project, area, team, priority
      ) VALUES (?, ?, 'ask', ?, NULL, 'pending', ?, ?, ?, ?, ?, 'normal')`,
      from,
      to,
      question,
      at,
      threadId,
      sender.project,
      sender.area,
      sender.team,
    );
    const askId = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!.id;
    if (!blocking) {
      return { ask_id: askId, thread_id: threadId, status: "pending", continue_locally: true };
    }
    const timeoutMs = Math.min(Math.max(Number(input.timeout_s ?? 30), 1), 110) * 1000;
    const end = now() + timeoutMs;
    while (now() < end) {
      const reply = one<MessageRow>(this.sql.exec("SELECT * FROM messages WHERE reply_to = ? ORDER BY id ASC LIMIT 1", askId));
      if (reply) return { ask_id: askId, thread_id: threadId, reply: toMessage(reply) };
      await sleep(100);
    }
    return { ask_id: askId, thread_id: threadId, status: "timeout", next_action: "check inbox_status or thread later" };
  }

  private async askBest(input: Record<string, unknown>, blocking: boolean): Promise<unknown> {
    const from = validateName("from", input.from);
    const capability = String(input.capability ?? "");
    if (!capability) throw new Error("capability is required");
    const role = optionalString(input.role);
    const scope = scopeClause(input);
    const candidates = rows<AgentRow>(
      this.sql.exec(
        `SELECT * FROM agents WHERE removed_at IS NULL AND paused = 0 AND name <> ?${scope.sql} ORDER BY routing_weight DESC, last_seen DESC`,
        from,
        ...scope.params,
      ),
    ).filter((agent) => {
      const capabilities = JSON.parse(agent.capabilities) as string[];
      return capabilities.includes(capability) && (!role || agent.role === role);
    });
    const target = candidates[0];
    if (!target) throw new Error(`no active agent found with capability ${capability}`);
    return this.ask({ ...input, to: target.name }, blocking);
  }

  private async askTeam(input: Record<string, unknown>): Promise<unknown> {
    const team = validateName("team", input.team);
    const capability = optionalString(input.capability);
    const from = validateName("from", input.from);
    const scope = scopeClause({ ...input, team });
    const candidates = rows<AgentRow>(
      this.sql.exec(
        `SELECT * FROM agents WHERE removed_at IS NULL AND paused = 0 AND name <> ?${scope.sql} ORDER BY routing_weight DESC, last_seen DESC`,
        from,
        ...scope.params,
      ),
    ).filter((agent) => {
      if (!capability) return true;
      return (JSON.parse(agent.capabilities) as string[]).includes(capability);
    });
    const target = candidates[0];
    if (!target) throw new Error(`no active agent found in team ${team}`);
    return this.ask({ ...input, to: target.name }, true);
  }

  private reply(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const messageId = Number(input.message_id ?? input.reply_to);
    if (!Number.isInteger(messageId) || messageId <= 0) throw new Error("message_id is required");
    const original = one<MessageRow>(this.sql.exec("SELECT * FROM messages WHERE id = ?", messageId));
    if (!original) throw new Error(`message ${messageId} not found`);
    const content = String(input.message ?? "");
    const at = now();
    const threadId = original.thread_id ?? makeThreadId();
    this.sql.exec(
      `INSERT INTO messages (
        from_agent, to_agent, kind, content, reply_to, status, created_at, thread_id, project, area, team, priority
      ) VALUES (?, ?, 'reply', ?, ?, 'pending', ?, ?, ?, ?, ?, 'normal')`,
      from,
      original.from_agent,
      content,
      messageId,
      at,
      threadId,
      original.project,
      original.area,
      original.team,
    );
    this.sql.exec("UPDATE messages SET status = 'answered', replied_at = ? WHERE id = ?", at, messageId);
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id, thread_id: threadId, reply_to: messageId };
  }

  private replyThread(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const threadId = String(input.thread_id ?? "");
    if (!threadId) throw new Error("thread_id is required");
    const last = one<MessageRow>(
      this.sql.exec("SELECT * FROM messages WHERE thread_id = ? AND from_agent <> ? ORDER BY id DESC LIMIT 1", threadId, from),
    );
    if (!last) throw new Error(`no other participant found in thread ${threadId}`);
    return this.reply({ from, message_id: last.id, message: input.message });
  }

  private messageStatus(input: Record<string, unknown>): unknown {
    const id = Number(input.message_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("message_id is required");
    const message = one<MessageRow>(this.sql.exec("SELECT * FROM messages WHERE id = ?", id));
    if (!message) throw new Error(`message ${id} not found`);
    const replies = rows<MessageRow>(this.sql.exec("SELECT * FROM messages WHERE reply_to = ? ORDER BY id ASC", id)).map(toMessage);
    return { message: toMessage(message), replies };
  }

  private whyNoReply(input: Record<string, unknown>): unknown {
    const status = this.messageStatus(input) as { message: Record<string, unknown>; replies: unknown[] };
    if (status.replies.length > 0) return { ...status, explanation: "message has replies" };
    const recipient = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", status.message.to_agent));
    const ageMs = now() - Number(status.message.created_at);
    return {
      ...status,
      explanation: recipient ? `no reply yet; recipient status is ${recipient.status}, last_seen ${Math.round((now() - recipient.last_seen) / 1000)}s ago` : "recipient is not registered",
      age_ms: ageMs,
    };
  }

  private thread(input: Record<string, unknown>): unknown {
    const threadId = String(input.thread_id ?? "");
    if (!threadId) throw new Error("thread_id is required");
    const messages = rows<MessageRow>(
      this.sql.exec("SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC", threadId),
    ).map(toMessage);
    return { thread_id: threadId, messages };
  }

  private recent(input: Record<string, unknown>): unknown {
    const limit = Math.min(Math.max(Number(input.limit ?? 30), 1), 200);
    const scope = scopeClause(input);
    const messages = rows<MessageRow>(
      this.sql.exec(`SELECT * FROM messages WHERE 1 = 1${scope.sql} ORDER BY id DESC LIMIT ?`, ...scope.params, limit),
    ).reverse().map((row) => previewMessage(row, 500));
    return { messages };
  }

  private removeAgent(input: Record<string, unknown>): unknown {
    const name = validateName("name", input.name);
    const at = now();
    this.sql.exec("UPDATE agents SET removed_at = ?, paused = 1, status = 'sleeping' WHERE name = ?", at, name);
    if (input.release_tasks === true || input.force === true) {
      this.sql.exec("UPDATE tasks SET state = 'open', claimed_by = NULL, updated_at = ? WHERE claimed_by = ? AND state NOT IN ('completed','failed','canceled')", at, name);
    }
    return { name, removed_at: at };
  }

  private deleteTeam(input: Record<string, unknown>): unknown {
    const team = validateName("team", input.team);
    const at = now();
    const scope = scopeClause({ ...input, team });
    const members = rows<AgentRow>(this.sql.exec(`SELECT * FROM agents WHERE removed_at IS NULL${scope.sql}`, ...scope.params));
    for (const member of members) {
      this.sql.exec("UPDATE agents SET removed_at = ?, paused = 1, status = 'sleeping' WHERE name = ?", at, member.name);
      if (input.release_tasks === true || input.force === true) {
        this.sql.exec("UPDATE tasks SET state = 'open', claimed_by = NULL, updated_at = ? WHERE claimed_by = ? AND state NOT IN ('completed','failed','canceled')", at, member.name);
      }
    }
    return { team, removed: members.map((member) => member.name) };
  }

  private setAgentStatus(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent ?? input.name);
    const status = optionalString(input.status) ?? "idle";
    this.sql.exec("UPDATE agents SET status = ?, last_seen = ? WHERE name = ?", status, now(), agent);
    return { agent, status };
  }

  private createTask(input: Record<string, unknown>): unknown {
    const requestedBy = validateName("requested_by", input.requested_by);
    const title = String(input.title ?? "");
    if (!title) throw new Error("title is required");
    const at = now();
    const threadId = optionalString(input.thread_id) ?? makeThreadId();
    this.sql.exec(
      `INSERT INTO tasks (
        title, description, thread_id, requested_by, claimed_by, state, milestone, priority,
        cwd, result, created_at, updated_at, project, area, team, required_capability,
        mode, expected_output, file_scope, edit_scope, read_scope, ack_required,
        review_required, independent_review
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      title,
      optionalString(input.description),
      threadId,
      requestedBy,
      optionalString(input.claimed_by),
      optionalString(input.state) ?? "open",
      optionalString(input.milestone),
      Number.isInteger(input.priority) ? input.priority : 0,
      optionalString(input.cwd),
      at,
      at,
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      optionalString(input.required_capability),
      optionalString(input.mode) ?? "edit_files",
      optionalString(input.expected_output),
      JSON.stringify(input.file_scope ?? []),
      JSON.stringify(input.edit_scope ?? []),
      JSON.stringify(input.read_scope ?? []),
      input.ack_required === true ? 1 : 0,
      input.review_required === true ? 1 : 0,
      input.independent_review === true ? 1 : 0,
    );
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return this.getTask({ task_id: row.id });
  }

  private delegate(input: Record<string, unknown>): unknown {
    const task = this.createTask({
      ...input,
      requested_by: input.from ?? input.requested_by,
      claimed_by: input.to ?? input.claimed_by,
      state: input.to || input.claimed_by ? "claimed" : (input.state ?? "open"),
      ack_required: input.ack_required ?? true,
    }) as { task: Record<string, unknown> };
    if (input.to) {
      this.send({
        from: input.from ?? input.requested_by,
        to: input.to,
        message: `Task #${task.task.id}: ${task.task.title}`,
        thread_id: task.task.thread_id,
      });
    }
    return task;
  }

  private delegateTeam(input: Record<string, unknown>): unknown {
    const from = validateName("from", input.from);
    const team = validateName("team", input.team);
    const capability = optionalString(input.capability);
    const scope = scopeClause({ ...input, team });
    const members = rows<AgentRow>(
      this.sql.exec(`SELECT * FROM agents WHERE removed_at IS NULL AND paused = 0${scope.sql} ORDER BY last_seen DESC`, ...scope.params),
    ).filter((agent) => {
      if (agent.name === from) return false;
      if (!capability) return true;
      return (JSON.parse(agent.capabilities) as string[]).includes(capability);
    });
    const tasks = members.map((member) => this.delegate({ ...input, from, to: member.name }));
    return { team, assigned: members.map((member) => member.name), tasks };
  }

  private claimTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const agent = validateName("agent", input.agent);
    const existing = one<Record<string, unknown>>(this.sql.exec("SELECT * FROM tasks WHERE id = ?", taskId));
    if (!existing) throw new Error(`task ${taskId} not found`);
    if (!["open", "claimed"].includes(String(existing.state)) && existing.claimed_by && existing.claimed_by !== agent) {
      throw new Error(`task ${taskId} is not claimable`);
    }
    const at = now();
    this.sql.exec("UPDATE tasks SET claimed_by = ?, state = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?", agent, at, at, taskId);
    return this.getTask({ task_id: taskId });
  }

  private assignTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const agent = validateName("agent", input.agent ?? input.to);
    const at = now();
    this.sql.exec("UPDATE tasks SET claimed_by = ?, state = 'claimed', claimed_at = ?, updated_at = ? WHERE id = ?", agent, at, at, taskId);
    const task = this.getTask({ task_id: taskId }) as { task: Record<string, unknown> };
    const requester = String(task.task.requested_by);
    this.send({ from: requester, to: agent, message: `Assigned task #${taskId}: ${task.task.title}`, thread_id: task.task.thread_id });
    return task;
  }

  private claimBestTask(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const row = one<AgentRow>(this.sql.exec("SELECT * FROM agents WHERE name = ?", agent));
    if (!row) throw new Error(`unknown agent ${agent}`);
    const capabilities = JSON.parse(row.capabilities) as string[];
    const scope = scopeClause({ project: row.project, area: row.area, team: row.team });
    const tasks = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM tasks WHERE state = 'open'${scope.sql} ORDER BY priority DESC, created_at ASC`, ...scope.params),
    );
    const match = tasks.find((task) => !task.required_capability || capabilities.includes(String(task.required_capability)));
    if (!match) return { task: null };
    return this.claimTask({ task_id: match.id, agent });
  }

  private listTasks(input: Record<string, unknown>): unknown {
    const scope = scopeClause(input);
    const includeTerminal = input.include_terminal === true || input.all === true;
    const terminal = includeTerminal ? "" : " AND state NOT IN ('completed','failed','canceled')";
    const tasks = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM tasks WHERE 1 = 1${scope.sql}${terminal} ORDER BY priority DESC, updated_at DESC`, ...scope.params),
    );
    return { tasks };
  }

  private getTask(input: Record<string, unknown>): unknown {
    const id = Number(input.task_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("task_id is required");
    const task = one<Record<string, unknown>>(this.sql.exec("SELECT * FROM tasks WHERE id = ?", id));
    if (!task) throw new Error(`task ${id} not found`);
    const events = rows<Record<string, unknown>>(this.sql.exec("SELECT * FROM task_events WHERE task_id = ? ORDER BY id ASC", id));
    return { task, events };
  }

  private updateTask(input: Record<string, unknown>): unknown {
    const id = Number(input.task_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("task_id is required");
    const updates: string[] = [];
    const params: unknown[] = [];
    for (const field of ["state", "claimed_by", "result", "phase", "blocked_reason", "final_answer", "review_state", "reviewed_by", "review_notes"] as const) {
      if (input[field] !== undefined) {
        updates.push(`${field} = ?`);
        params.push(input[field]);
      }
    }
    updates.push("updated_at = ?");
    params.push(now());
    params.push(id);
    this.sql.exec(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`, ...params);
    return this.getTask({ task_id: id });
  }

  private releaseTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    this.sql.exec("UPDATE tasks SET state = 'open', claimed_by = NULL, updated_at = ? WHERE id = ?", now(), taskId);
    return this.getTask({ task_id: taskId });
  }

  private acknowledgeTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const agent = validateName("agent", input.agent);
    const response = optionalString(input.response) ?? "claimed";
    const at = now();
    const updates = response === "blocked"
      ? "acknowledged_by = ?, acknowledged_at = ?, state = 'blocked', blocked_reason = ?, updated_at = ?"
      : "acknowledged_by = ?, acknowledged_at = ?, updated_at = ?";
    const params = response === "blocked"
      ? [agent, at, optionalString(input.message) ?? "blocked", at, taskId]
      : [agent, at, at, taskId];
    this.sql.exec(`UPDATE tasks SET ${updates} WHERE id = ?`, ...params);
    return this.getTask({ task_id: taskId });
  }

  private submitReview(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const reviewer = validateName("reviewer", input.reviewer ?? input.by_agent);
    const approved = input.approved === true;
    this.sql.exec(
      "UPDATE tasks SET review_state = ?, reviewed_by = ?, review_notes = ?, updated_at = ? WHERE id = ?",
      approved ? "approved" : "changes_requested",
      reviewer,
      optionalString(input.notes) ?? optionalString(input.review_notes),
      now(),
      taskId,
    );
    return this.getTask({ task_id: taskId });
  }

  private handoffTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const to = optionalString(input.to_agent);
    const task = this.getTask({ task_id: taskId }) as { task: Record<string, unknown> };
    this.remember({
      by_agent: input.by_agent ?? task.task.claimed_by ?? task.task.requested_by,
      agent: to,
      kind: "handoff",
      content: input.message ?? `Handoff for task #${taskId}: ${task.task.title}`,
      task_id: taskId,
      thread_id: task.task.thread_id,
      pinned: true,
      project: task.task.project,
      area: task.task.area,
      team: task.task.team,
    });
    if (to) this.sql.exec("UPDATE tasks SET claimed_by = ?, state = 'claimed', updated_at = ? WHERE id = ?", to, now(), taskId);
    return this.getTask({ task_id: taskId });
  }

  private cancelTask(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id ?? input.id);
    const at = now();
    this.sql.exec("UPDATE tasks SET state = 'canceled', finished_at = ?, updated_at = ? WHERE id = ?", at, at, taskId);
    this.recordTaskEvent({
      task_id: taskId,
      by_agent: input.by_agent ?? "system",
      event_type: "cancel",
      message: input.reason ?? "canceled",
    });
    return this.getTask({ task_id: taskId });
  }

  private checkScopeConflicts(input: Record<string, unknown>): unknown {
    const proposed = Array.isArray(input.edit_scope ?? input.file_scope) ? (input.edit_scope ?? input.file_scope) as unknown[] : [];
    const proposedStrings = proposed.filter((value): value is string => typeof value === "string");
    const active = rows<Record<string, unknown>>(
      this.sql.exec("SELECT * FROM tasks WHERE state IN ('claimed','working','blocked')"),
    );
    const conflicts = active.filter((task) => {
      const existing = JSON.parse(String(task.edit_scope ?? task.file_scope ?? "[]")) as string[];
      return existing.some((scope) => proposedStrings.some((candidate) => candidate === scope || candidate.startsWith(scope) || scope.startsWith(candidate)));
    });
    return { ok: conflicts.length === 0, conflicts };
  }

  private recordTaskEvent(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id);
    if (!Number.isInteger(taskId) || taskId <= 0) throw new Error("task_id is required");
    const phase = optionalString(input.phase);
    const at = now();
    this.sql.exec(
      `INSERT INTO task_events (task_id, by_agent, event_type, message, phase, metadata, project, area, team, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      taskId,
      validateName("by_agent", input.by_agent),
      optionalString(input.event_type) ?? "note",
      String(input.message ?? ""),
      phase,
      JSON.stringify(input.metadata ?? {}),
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      at,
    );
    if (phase) this.sql.exec("UPDATE tasks SET phase = ?, updated_at = ? WHERE id = ?", phase, at, taskId);
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id };
  }

  private listTaskEvents(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id);
    const scope = scopeClause(input);
    const filter = Number.isInteger(taskId) && taskId > 0 ? " AND task_id = ?" : "";
    const params = Number.isInteger(taskId) && taskId > 0 ? [taskId, ...scope.params] : scope.params;
    const events = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM task_events WHERE 1 = 1${filter}${scope.sql} ORDER BY id ASC`, ...params),
    );
    return { events };
  }

  private recordTestResult(input: Record<string, unknown>): unknown {
    const at = now();
    this.sql.exec(
      `INSERT INTO test_results (by_agent, task_id, command, status, output_summary, git_ref, cwd, project, area, team, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      validateName("by_agent", input.by_agent),
      input.task_id ?? null,
      String(input.command ?? ""),
      optionalString(input.status) ?? "passed",
      optionalString(input.output_summary),
      optionalString(input.git_ref),
      optionalString(input.cwd),
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      at,
    );
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id };
  }

  private listTestResults(input: Record<string, unknown>): unknown {
    const taskId = Number(input.task_id);
    const scope = scopeClause(input);
    const filter = Number.isInteger(taskId) && taskId > 0 ? " AND task_id = ?" : "";
    const params = Number.isInteger(taskId) && taskId > 0 ? [taskId, ...scope.params] : scope.params;
    const test_results = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM test_results WHERE 1 = 1${filter}${scope.sql} ORDER BY id DESC`, ...params),
    );
    return { test_results };
  }

  private taskResult(input: Record<string, unknown>): unknown {
    const task = this.getTask(input) as Record<string, unknown>;
    const taskId = Number(input.task_id ?? input.id);
    const tests = this.listTestResults({ task_id: taskId });
    return { ...task, ...(tests as Record<string, unknown>) };
  }

  private finalReport(input: Record<string, unknown>): unknown {
    const tasks = (this.listTasks({ ...input, include_terminal: true }) as { tasks: Array<Record<string, unknown>> }).tasks;
    const tests = (this.listTestResults(input) as { test_results: unknown[] }).test_results;
    const completed = tasks.filter((task) => task.state === "completed");
    const blocked = tasks.filter((task) => task.state === "blocked");
    const open = tasks.filter((task) => !["completed", "failed", "canceled"].includes(String(task.state)));
    return {
      implemented: completed.map((task) => ({ id: task.id, title: task.title })),
      not_implemented: open.map((task) => ({ id: task.id, title: task.title, state: task.state })),
      known_risks: blocked.map((task) => ({ id: task.id, title: task.title, reason: task.blocked_reason })),
      tests_passed: tests,
      safe_to_commit: open.length === 0,
      safe_to_push: open.length === 0,
      safe_to_deploy: false,
    };
  }

  private reviewGate(input: Record<string, unknown>): unknown {
    const report = this.finalReport(input) as { safe_to_commit: boolean; not_implemented: unknown[]; known_risks: unknown[] };
    return {
      ok: report.safe_to_commit,
      blockers: [...report.not_implemented, ...report.known_risks],
      report,
    };
  }

  private board(input: Record<string, unknown>): unknown {
    const agents = this.directory(input);
    const tasks = this.listTasks({ ...input, include_terminal: false });
    return { agents: (agents as { agents: unknown[] }).agents, tasks: (tasks as { tasks: unknown[] }).tasks };
  }

  private activity(input: Record<string, unknown>): unknown {
    const limit = Math.min(Math.max(Number(input.limit ?? 50), 1), 200);
    const scope = scopeClause(input);
    const messages = rows<MessageRow>(
      this.sql.exec(`SELECT * FROM messages WHERE 1 = 1${scope.sql} ORDER BY id DESC LIMIT ?`, ...scope.params, limit),
    ).map((message) => ({ type: "message", at: message.created_at, item: previewMessage(message, 240) }));
    const events = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM task_events WHERE 1 = 1${scope.sql} ORDER BY id DESC LIMIT ?`, ...scope.params, limit),
    ).map((event) => ({ type: "task_event", at: event.created_at, item: event }));
    return { activity: [...messages, ...events].sort((a, b) => Number(b.at) - Number(a.at)).slice(0, limit) };
  }

  private cockpit(input: Record<string, unknown>): unknown {
    const board = this.board(input);
    const activity = this.activity({ ...input, limit: 20 });
    const memories = this.listMemories(input);
    const decisions = this.listDecisions(input);
    return { board, activity, memories, decisions };
  }

  private agentNow(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const status = optionalString(input.status) ?? optionalString(input.phase) ?? "working";
    this.sql.exec("UPDATE agents SET status = ?, last_seen = ? WHERE name = ?", status, now(), agent);
    if (input.task_id) {
      this.recordTaskEvent({
        task_id: input.task_id,
        by_agent: agent,
        event_type: "phase",
        message: input.note ?? status,
        phase: input.phase ?? status,
      });
    }
    return { agent, status, task_id: input.task_id ?? null, note: input.note ?? null };
  }

  private remember(input: Record<string, unknown>): unknown {
    const at = now();
    this.sql.exec(
      `INSERT INTO memories (by_agent, agent, kind, content, project, area, team, task_id, thread_id, pinned, supersedes_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      validateName("by_agent", input.by_agent),
      optionalString(input.agent),
      optionalString(input.kind) ?? "fact",
      String(input.content ?? ""),
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      input.task_id ?? null,
      optionalString(input.thread_id),
      input.pinned === true ? 1 : 0,
      input.supersedes_id ?? null,
      at,
      at,
    );
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id };
  }

  private listMemories(input: Record<string, unknown>): unknown {
    const scope = scopeClause(input);
    const memories = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM memories WHERE 1 = 1${scope.sql} ORDER BY pinned DESC, updated_at DESC LIMIT 100`, ...scope.params),
    );
    return { memories };
  }

  private setMemoryPinned(input: Record<string, unknown>, pinned: boolean): unknown {
    const id = Number(input.memory_id ?? input.id);
    if (!Number.isInteger(id) || id <= 0) throw new Error("memory_id is required");
    this.sql.exec("UPDATE memories SET pinned = ?, updated_at = ? WHERE id = ?", pinned ? 1 : 0, now(), id);
    return { memory_id: id, pinned };
  }

  private sessionBrief(input: Record<string, unknown>): unknown {
    const board = this.board(input) as Record<string, unknown>;
    const memories = this.listMemories(input) as { memories: unknown[] };
    const decisions = this.listDecisions(input) as { decisions: unknown[] };
    const activity = this.activity({ ...input, limit: 10 }) as { activity: unknown[] };
    return {
      summary: "Agent Bus Cloud workspace brief",
      board,
      pinned_memories: memories.memories,
      recent_decisions: decisions.decisions,
      recent_activity: activity.activity,
    };
  }

  private recordDecision(input: Record<string, unknown>): unknown {
    const at = now();
    this.sql.exec(
      `INSERT INTO decisions (by_agent, decision, rationale, implemented, project, area, team, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      validateName("by_agent", input.by_agent),
      String(input.decision ?? ""),
      optionalString(input.rationale),
      input.implemented === true ? 1 : 0,
      optionalString(input.project),
      optionalString(input.area),
      optionalString(input.team),
      at,
      at,
    );
    const row = one<{ id: number }>(this.sql.exec("SELECT last_insert_rowid() AS id"))!;
    return { id: row.id };
  }

  private listDecisions(input: Record<string, unknown>): unknown {
    const scope = scopeClause(input);
    const decisions = rows<Record<string, unknown>>(
      this.sql.exec(`SELECT * FROM decisions WHERE 1 = 1${scope.sql} ORDER BY updated_at DESC LIMIT 100`, ...scope.params),
    );
    return { decisions };
  }
}
