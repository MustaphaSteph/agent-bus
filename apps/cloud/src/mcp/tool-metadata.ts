import { z } from "zod";

const ScopeFields = {
  project: z.string().nullable().optional().describe("Project scope. Use '*' for a global read where supported."),
  area: z.string().nullable().optional().describe("Area/subfolder scope. Use '*' for a global read where supported."),
  team: z.string().nullable().optional().describe("Team scope. Prefer concrete team names for coordination."),
};

const AgentName = z.string().min(1).max(64).describe("Agent name.");
const MessageId = z.number().int().positive().describe("Message id.");
const TaskId = z.number().int().positive().describe("Task id.");
const ThreadId = z.string().min(1).describe("Thread id.");

const AnyToolInput = z.object({}).catchall(z.unknown());

const toolMetadata = {
  cloud_workspace: {
    description: "Return the authenticated Agent Bus Cloud workspace and principal role.",
    inputSchema: z.object({}),
  },
  register: {
    description: "Register or refresh an agent in this cloud workspace.",
    inputSchema: z.object({
      name: AgentName,
      capabilities: z.array(z.string()).optional(),
      replace: z.boolean().optional(),
      role: z.string().nullable().optional(),
      routing_weight: z.number().int().optional(),
      status: z.enum(["idle", "working", "blocked", "waiting_review", "sleeping"]).optional(),
      session_id: z.string().nullable().optional(),
      ...ScopeFields,
    }),
  },
  remove_agent: {
    description: "Soft-remove an agent from the workspace roster.",
    inputSchema: z.object({ name: AgentName, release_tasks: z.boolean().optional(), force: z.boolean().optional() }),
  },
  delete_team: {
    description: "Soft-remove all agents in a team and optionally release active tasks.",
    inputSchema: z.object({ team: z.string().min(1), release_tasks: z.boolean().optional(), force: z.boolean().optional(), project: ScopeFields.project, area: ScopeFields.area }),
  },
  send: {
    description: "Send a direct message to one agent.",
    inputSchema: z.object({ from: AgentName, to: AgentName, message: z.string(), thread_id: z.string().optional() }),
  },
  send_team: {
    description: "Send one message to every active member of a team.",
    inputSchema: z.object({ from: AgentName, team: z.string().min(1), message: z.string(), include_self: z.boolean().optional(), thread_id: z.string().optional(), project: ScopeFields.project, area: ScopeFields.area }),
  },
  inbox: {
    description: "Read pending messages for an agent, optionally waiting for new messages.",
    inputSchema: z.object({
      agent: AgentName,
      mark_delivered: z.boolean().optional(),
      claim_s: z.number().int().positive().optional(),
      wait_s: z.number().min(0).max(110).optional(),
      since_id: z.number().int().min(0).optional(),
      thread_id: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
      ...ScopeFields,
    }),
  },
  inbox_previews: {
    description: "Read pending-message previews without pulling large message bodies.",
    inputSchema: z.object({
      agent: AgentName,
      wait_s: z.number().min(0).max(110).optional(),
      since_id: z.number().int().min(0).optional(),
      thread_id: z.string().optional(),
      preview_chars: z.number().int().min(0).max(4000).optional(),
      limit: z.number().int().positive().max(100).optional(),
      ...ScopeFields,
    }),
  },
  inbox_status: {
    description: "Inspect unread, claimed, and recent delivered inbox state without consuming messages.",
    inputSchema: z.object({ agent: AgentName, thread_id: z.string().optional(), ...ScopeFields }),
  },
  get_message: {
    description: "Fetch one message by id, optionally as a preview.",
    inputSchema: z.object({ message_id: MessageId.optional(), id: MessageId.optional(), include_content: z.boolean().optional(), preview_chars: z.number().int().min(0).max(4000).optional() }),
  },
  ack: {
    description: "Acknowledge a claimed message and mark it delivered.",
    inputSchema: z.object({ agent: AgentName, message_id: MessageId.optional(), id: MessageId.optional() }),
  },
  ask: {
    description: "Send a blocking ask to an active agent. Use only for short Q&A.",
    inputSchema: z.object({ from: AgentName, to: AgentName, question: z.string(), timeout_s: z.number().min(1).max(110).optional(), thread_id: z.string().optional() }),
  },
  ask_async: {
    description: "Create an ask and return immediately so the requester can keep working.",
    inputSchema: z.object({ from: AgentName, to: AgentName, question: z.string(), thread_id: z.string().optional() }),
  },
  ask_best: {
    description: "Route an ask to the best active agent with a capability and optional role.",
    inputSchema: z.object({ from: AgentName, capability: z.string().min(1), question: z.string(), role: z.string().optional(), timeout_s: z.number().min(1).max(110).optional(), ...ScopeFields }),
  },
  ask_team: {
    description: "Ask one best active member of a team, optionally filtered by capability.",
    inputSchema: z.object({ from: AgentName, team: z.string().min(1), question: z.string(), capability: z.string().optional(), timeout_s: z.number().min(1).max(110).optional(), project: ScopeFields.project, area: ScopeFields.area }),
  },
  reply: {
    description: "Reply to an ask or normal message by id.",
    inputSchema: z.object({ from: AgentName, message_id: MessageId.optional(), reply_to: MessageId.optional(), message: z.string() }),
  },
  reply_thread: {
    description: "Reply to the latest other participant in a thread.",
    inputSchema: z.object({ from: AgentName, thread_id: ThreadId, message: z.string() }),
  },
  send_channel: {
    description: "Send a message to all subscribers of a channel.",
    inputSchema: z.object({ from: AgentName, channel: z.string().min(1), message: z.string(), thread_id: z.string().optional() }),
  },
  subscribe: {
    description: "Subscribe an agent to a channel.",
    inputSchema: z.object({ agent: AgentName, channel: z.string().min(1) }),
  },
  unsubscribe: {
    description: "Unsubscribe an agent from a channel.",
    inputSchema: z.object({ agent: AgentName, channel: z.string().min(1) }),
  },
  subscribers: {
    description: "List channel subscribers.",
    inputSchema: z.object({ channel: z.string().min(1) }),
  },
  thread: {
    description: "Read all messages in a thread.",
    inputSchema: z.object({ thread_id: ThreadId }),
  },
  recent: {
    description: "Read recent message previews for a scope.",
    inputSchema: z.object({ limit: z.number().int().positive().max(200).optional(), ...ScopeFields }),
  },
  whois: {
    description: "List agents in scope. Alias of directory.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  directory: {
    description: "List registered agents with presence, role, team, and capability metadata.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  wait_for_agents: {
    description: "Wait until expected agents are present, in scope, and not stale.",
    inputSchema: z.object({ names: z.array(AgentName).min(1), timeout_s: z.number().min(0).max(110).optional(), ...ScopeFields }),
  },
  create_task: {
    description: "Create a tracked task for the workspace board.",
    inputSchema: z.object({
      requested_by: AgentName,
      title: z.string().min(1),
      description: z.string().optional(),
      claimed_by: z.string().optional(),
      state: z.enum(["backlog", "open", "claimed", "working", "blocked", "completed", "failed", "canceled"]).optional(),
      priority: z.number().int().optional(),
      mode: z.enum(["investigate_only", "propose_patch", "edit_files", "test_only"]).optional(),
      expected_output: z.string().optional(),
      required_capability: z.string().optional(),
      review_required: z.boolean().optional(),
      independent_review: z.boolean().optional(),
      ...ScopeFields,
    }),
  },
  delegate: {
    description: "Create an assigned task, notify the assignee, and require acknowledgement by default.",
    inputSchema: z.object({ from: AgentName, to: AgentName.optional(), title: z.string().min(1), description: z.string().optional(), priority: z.number().int().optional(), mode: z.string().optional(), ...ScopeFields }),
  },
  delegate_team: {
    description: "Create tracked tasks for active team members.",
    inputSchema: z.object({ from: AgentName, team: z.string().min(1), title: z.string().min(1), description: z.string().optional(), capability: z.string().optional(), priority: z.number().int().optional(), mode: z.string().optional(), project: ScopeFields.project, area: ScopeFields.area }),
  },
  claim_task: {
    description: "Claim an open or assigned task for an agent.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), agent: AgentName }),
  },
  assign_task: {
    description: "Assign a task to an agent and notify them.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), agent: AgentName.optional(), to: AgentName.optional() }),
  },
  claim_best_task: {
    description: "Claim the highest-priority open task matching an agent scope/capabilities.",
    inputSchema: z.object({ agent: AgentName }),
  },
  update_task: {
    description: "Update tracked task state or metadata.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), state: z.string().optional(), claimed_by: z.string().optional(), result: z.string().optional(), phase: z.string().optional(), blocked_reason: z.string().optional(), final_answer: z.string().optional(), review_state: z.string().optional(), reviewed_by: z.string().optional(), review_notes: z.string().optional() }),
  },
  release_task: {
    description: "Release a claimed task back to open.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional() }),
  },
  acknowledge_task: {
    description: "Acknowledge, claim, or block an assigned task.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), agent: AgentName, response: z.enum(["claimed", "blocked"]).optional(), message: z.string().optional() }),
  },
  submit_review: {
    description: "Submit approval or changes-requested review for a task.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), reviewer: AgentName, review_state: z.enum(["approved", "changes_requested"]).optional(), notes: z.string().optional() }),
  },
  handoff_task: {
    description: "Hand a task from one agent to another.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), from_agent: AgentName.optional(), to_agent: AgentName, note: z.string().optional() }),
  },
  check_scope_conflicts: {
    description: "Check for overlapping active edit scopes.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), edit_scope: z.array(z.string()).optional(), agent: z.string().optional(), ...ScopeFields }),
  },
  record_task_event: {
    description: "Record durable task progress, phase, log, or result event.",
    inputSchema: z.object({ task_id: TaskId, by_agent: AgentName, event_type: z.enum(["note", "phase", "progress", "log", "result", "cancel"]).optional(), message: z.string(), phase: z.string().optional(), metadata: z.record(z.string(), z.unknown()).optional(), ...ScopeFields }),
  },
  list_task_events: {
    description: "List task events, optionally filtered by task id and scope.",
    inputSchema: z.object({ task_id: TaskId.optional(), ...ScopeFields }),
  },
  record_test_result: {
    description: "Record command/test evidence for reports and review gates.",
    inputSchema: z.object({ by_agent: AgentName, task_id: TaskId.optional(), command: z.string(), status: z.enum(["passed", "failed", "skipped"]), output_summary: z.string().optional(), git_ref: z.string().optional(), cwd: z.string().optional(), ...ScopeFields }),
  },
  list_test_results: {
    description: "List recorded test evidence.",
    inputSchema: z.object({ task_id: TaskId.optional(), ...ScopeFields }),
  },
  task_result: {
    description: "Bundle task state, events, and test evidence for review/handoff.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional() }),
  },
  wait_for_task: {
    description: "Wait for task activity, terminal state, message, event, or test result.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), wait_s: z.number().min(0).max(110).optional(), since_updated_at: z.number().optional() }),
  },
  cancel_task: {
    description: "Cancel active task work and record cancellation.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional(), by_agent: AgentName.optional(), reason: z.string().optional() }),
  },
  list_tasks: {
    description: "List tasks for a scope.",
    inputSchema: z.object({ include_terminal: z.boolean().optional(), all: z.boolean().optional(), ...ScopeFields }),
  },
  tasks: {
    description: "List tasks for a scope.",
    inputSchema: z.object({ include_terminal: z.boolean().optional(), all: z.boolean().optional(), ...ScopeFields }),
  },
  get_task: {
    description: "Fetch one task and its events.",
    inputSchema: z.object({ task_id: TaskId.optional(), id: TaskId.optional() }),
  },
  set_agent_status: {
    description: "Set an agent board status.",
    inputSchema: z.object({ agent: AgentName.optional(), name: AgentName.optional(), status: z.enum(["idle", "working", "blocked", "waiting_review", "sleeping"]) }),
  },
  sleep_agent: {
    description: "Set an agent status to sleeping.",
    inputSchema: z.object({ agent: AgentName.optional(), name: AgentName.optional() }),
  },
  wake_agent: {
    description: "Set an agent status to idle.",
    inputSchema: z.object({ agent: AgentName.optional(), name: AgentName.optional() }),
  },
  now: {
    description: "Update what an agent is currently doing and optionally record a task phase event.",
    inputSchema: z.object({ agent: AgentName, status: z.string().optional(), task_id: TaskId.optional(), phase: z.string().optional(), note: z.string().optional() }),
  },
  activity: {
    description: "Show recent message and task-event activity.",
    inputSchema: z.object({ limit: z.number().int().positive().max(200).optional(), ...ScopeFields }),
  },
  cockpit: {
    description: "Return board, activity, memories, and decisions for a scope.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  project_board: {
    description: "Return agents and active tasks for a project/team scope.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  team_board: {
    description: "Return agents and active tasks for a team.",
    inputSchema: z.object({ team: z.string().optional(), project: ScopeFields.project, area: ScopeFields.area }),
  },
  record_decision: {
    description: "Record a durable decision and rationale.",
    inputSchema: z.object({ by_agent: AgentName, decision: z.string(), rationale: z.string().optional(), implemented: z.boolean().optional(), ...ScopeFields }),
  },
  list_decisions: {
    description: "List recorded decisions.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  remember: {
    description: "Store project/team memory such as decisions, risks, handoffs, facts, or constraints.",
    inputSchema: z.object({ by_agent: AgentName, agent: z.string().optional(), kind: z.string().optional(), content: z.string(), task_id: TaskId.optional(), thread_id: z.string().optional(), pinned: z.boolean().optional(), supersedes_id: z.number().int().positive().optional(), ...ScopeFields }),
  },
  list_memories: {
    description: "List memories, pinned first.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  pin_memory: {
    description: "Pin a memory.",
    inputSchema: z.object({ memory_id: z.number().int().positive().optional(), id: z.number().int().positive().optional() }),
  },
  unpin_memory: {
    description: "Unpin a memory.",
    inputSchema: z.object({ memory_id: z.number().int().positive().optional(), id: z.number().int().positive().optional() }),
  },
  session_brief: {
    description: "Summarize current board, memories, decisions, and activity for a scope.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  final_report: {
    description: "Generate implementation/test/risk safety report from tasks and evidence.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  review_gate: {
    description: "Check whether board/report state is safe to proceed.",
    inputSchema: z.object({ ...ScopeFields }),
  },
  message_status: {
    description: "Inspect one message and its replies.",
    inputSchema: z.object({ message_id: MessageId.optional(), id: MessageId.optional() }),
  },
  why_no_reply: {
    description: "Explain why a message has not received a reply yet.",
    inputSchema: z.object({ message_id: MessageId.optional(), id: MessageId.optional() }),
  },
} satisfies Record<string, { description: string; inputSchema: z.ZodTypeAny }>;

export function metadataForTool(name: string): { description: string; inputSchema: z.ZodTypeAny } {
  return toolMetadata[name as keyof typeof toolMetadata] ?? {
    description: `Agent Bus Cloud ${name} operation.`,
    inputSchema: AnyToolInput,
  };
}
