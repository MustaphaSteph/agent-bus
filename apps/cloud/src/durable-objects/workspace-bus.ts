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
      case "inbox":
        return this.inbox(input);
      case "reply":
        return this.reply(input);
      case "thread":
        return this.thread(input);
      case "create_task":
        return this.createTask(input);
      case "list_tasks":
      case "tasks":
        return this.listTasks(input);
      case "get_task":
        return this.getTask(input);
      case "update_task":
        return this.updateTask(input);
      case "team_board":
      case "project_board":
        return this.board(input);
      case "remember":
        return this.remember(input);
      case "list_memories":
        return this.listMemories(input);
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

  private inbox(input: Record<string, unknown>): unknown {
    const agent = validateName("agent", input.agent);
    const limit = Math.min(Math.max(Number(input.limit ?? 20), 1), 500);
    const markDelivered = input.mark_delivered !== false;
    const scope = scopeClause(input);
    const rowsFound = rows<MessageRow>(
      this.sql.exec(
        `SELECT * FROM messages
         WHERE to_agent = ? AND status = 'pending'${scope.sql}
         ORDER BY id ASC LIMIT ?`,
        agent,
        ...scope.params,
        limit,
      ),
    );
    if (markDelivered && rowsFound.length > 0) {
      const at = now();
      for (const message of rowsFound) {
        this.sql.exec("UPDATE messages SET status = 'delivered', delivered_at = ? WHERE id = ?", at, message.id);
      }
    }
    return { messages: rowsFound.map(toMessage) };
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

  private thread(input: Record<string, unknown>): unknown {
    const threadId = String(input.thread_id ?? "");
    if (!threadId) throw new Error("thread_id is required");
    const messages = rows<MessageRow>(
      this.sql.exec("SELECT * FROM messages WHERE thread_id = ? ORDER BY id ASC", threadId),
    ).map(toMessage);
    return { thread_id: threadId, messages };
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

  private board(input: Record<string, unknown>): unknown {
    const agents = this.directory(input);
    const tasks = this.listTasks({ ...input, include_terminal: false });
    return { agents: (agents as { agents: unknown[] }).agents, tasks: (tasks as { tasks: unknown[] }).tasks };
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
