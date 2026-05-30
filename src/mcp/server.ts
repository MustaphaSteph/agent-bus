#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  ack,
  acknowledgeTask,
  activityTimeline,
  agentNow,
  assignTask,
  ask,
  askBest,
  askTeam,
  cancelTask,
  checkScopeConflicts,
  claimTask,
  claimBestTask,
  cockpit,
  createTask,
  delegate,
  delegateTeam,
  directory,
  finalReport,
  getTask,
  inbox,
  inboxStatus,
  listTaskEvents,
  listTasks,
  listDecisions,
  listMemories,
  recentMessages,
  pinMemory,
  projectBoard,
  register,
  recordTaskEvent,
  recordTestResult,
  releaseTask,
  recordDecision,
  remember,
  reply,
  replyThread,
  send,
  sendChannel,
  sendTeam,
  sessionBrief,
  submitReview,
  subscribe,
  subscribers,
  threadMessages,
  unsubscribe,
  updateTask,
  handoffTask,
  waitForAgents,
  waitForTask,
  listTestResults,
  messageStatus,
  reviewGate,
  taskResult,
  teamBoard,
  whois,
  whyNoReply,
  sleepAgent,
  wakeAgent,
  setAgentStatus,
} from "../bus.js";
import { BusError } from "../util/errors.js";
import { packageVersion } from "../util/package-info.js";
import { deriveScope } from "../util/project.js";

// MCP servers inherit cwd from the spawning session, so this is the
// project/area context for everything this process handles. Derived once at
// startup (the cwd doesn't change for the life of an MCP child process).
const SESSION_SCOPE = deriveScope();

const TASK_STATES = [
  "open",
  "claimed",
  "working",
  "blocked",
  "completed",
  "failed",
  "canceled",
] as const;
const TaskStateEnum = z.enum(TASK_STATES);
const AgentStatusEnum = z.enum(["idle", "working", "blocked", "waiting_review", "sleeping"]);
const TaskModeEnum = z.enum(["investigate_only", "propose_patch", "edit_files", "test_only"]);

// project filter accepts "*" (global) or a project slug or null/omit (default scope)
const ProjectField = z.string().min(1).max(64).nullable().optional();
const ProjectFilterField = z.string().min(1).max(64).optional();
const AreaField = z.string().min(1).max(64).nullable().optional();
const AreaFilterField = z.string().min(1).max(64).optional();
const TeamField = z.string().min(1).max(64).nullable().optional();
const TeamFilterField = z.string().min(1).max(64).optional();

const RegisterInput = z.object({
  name: z.string().min(1).max(64),
  capabilities: z.array(z.string()).max(32).optional(),
  replace: z.boolean().optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
  role: z.string().min(1).max(64).nullable().optional(),
  routing_weight: z.number().int().optional(),
  status: AgentStatusEnum.optional(),
  session_id: z.string().min(1).max(128).nullable().optional(),
});

const SendInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  message: z.string(),
  thread_id: z.string().optional(),
});

const InboxInput = z.object({
  agent: z.string().min(1),
  team: TeamFilterField,
  since_id: z.number().int().nonnegative().optional(),
  mark_delivered: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
  wait_s: z.number().int().positive().max(110).optional(),
  claim_s: z.number().int().positive().max(3600).optional(),
});

const AckInput = z.object({
  agent: z.string().min(1),
  message_id: z.number().int().positive(),
});

const AskInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  question: z.string(),
  timeout_s: z.number().int().positive().max(110).optional(),
  thread_id: z.string().optional(),
});

const AskBestInput = z.object({
  from: z.string().min(1),
  capability: z.string().min(1),
  question: z.string(),
  timeout_s: z.number().int().positive().max(110).optional(),
  thread_id: z.string().optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  role: z.string().min(1).max(64).optional(),
});

const SendTeamInput = z.object({
  from: z.string().min(1),
  team: TeamFilterField,
  message: z.string(),
  thread_id: z.string().optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  include_self: z.boolean().optional(),
});

const AskTeamInput = z.object({
  from: z.string().min(1),
  team: TeamFilterField,
  question: z.string(),
  timeout_s: z.number().int().positive().max(110).optional(),
  thread_id: z.string().optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  capability: z.string().min(1).optional(),
  role: z.string().min(1).max(64).optional(),
});

const ReplyInput = z.object({
  from: z.string().min(1),
  ask_id: z.number().int().positive(),
  answer: z.string(),
});

const SubscribeInput = z.object({
  agent: z.string().min(1),
  channel: z.string().min(1).max(64),
});

const SendChannelInput = z.object({
  from: z.string().min(1),
  channel: z.string().min(1).max(64),
  message: z.string(),
  thread_id: z.string().optional(),
});

const SubscribersInput = z.object({
  channel: z.string().min(1).max(64),
});

const ThreadInput = z.object({
  thread_id: z.string().min(1),
  limit: z.number().int().positive().max(500).optional(),
});

const WhoisInput = z.object({
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
});

const WaitForAgentsInput = z.object({
  names: z.array(z.string().min(1)).min(1),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  timeout_s: z.number().int().nonnegative().max(110).optional(),
});

const CreateTaskInput = z.object({
  requested_by: z.string().min(1),
  title: z.string().min(1).max(200),
  description: z.string().optional(),
  thread_id: z.string().optional(),
  priority: z.number().int().optional(),
  cwd: z.string().optional(),
  blocked_on_task_id: z.number().int().positive().optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
  required_capability: z.string().min(1).nullable().optional(),
  mode: TaskModeEnum.optional(),
  expected_output: z.string().nullable().optional(),
  deadline_at: z.number().int().positive().nullable().optional(),
  checkin_at: z.number().int().positive().nullable().optional(),
  final_answer: z.string().nullable().optional(),
  manager_reviewed: z.boolean().optional(),
  file_scope: z.array(z.string()).optional(),
  edit_scope: z.array(z.string()).optional(),
  read_scope: z.array(z.string()).optional(),
  ack_required: z.boolean().optional(),
  review_required: z.boolean().optional(),
  changed_files: z.array(z.string()).optional(),
  phase: z.string().nullable().optional(),
  session_id: z.string().min(1).max(128).nullable().optional(),
  allow_conflicts: z.boolean().optional(),
});

const DelegateInput = CreateTaskInput.omit({ requested_by: true }).extend({
  from: z.string().min(1),
  to_agent: z.string().min(1),
  allow_pending_agent: z.boolean().optional(),
});

const DelegateTeamInput = DelegateInput.omit({ to_agent: true, allow_pending_agent: true }).extend({
  team: TeamFilterField,
  capability: z.string().min(1).optional(),
  role: z.string().min(1).max(64).optional(),
  include_self: z.boolean().optional(),
  max_recipients: z.number().int().positive().max(100).optional(),
});

const ClaimTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
  allow_conflicts: z.boolean().optional(),
});

const AssignTaskInput = z.object({
  task_id: z.number().int().positive(),
  to_agent: z.string().min(1),
  allow_conflicts: z.boolean().optional(),
  allow_pending_agent: z.boolean().optional(),
});

const ClaimBestTaskInput = z.object({
  agent: z.string().min(1),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
});

const UpdateTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
  state: TaskStateEnum.optional(),
  blocked_reason: z.string().nullable().optional(),
  blocked_on_task_id: z.number().int().positive().nullable().optional(),
  result: z.string().nullable().optional(),
  priority: z.number().int().optional(),
  mode: TaskModeEnum.optional(),
  expected_output: z.string().nullable().optional(),
  deadline_at: z.number().int().positive().nullable().optional(),
  checkin_at: z.number().int().positive().nullable().optional(),
  final_answer: z.string().nullable().optional(),
  manager_reviewed: z.boolean().optional(),
  file_scope: z.array(z.string()).optional(),
  edit_scope: z.array(z.string()).optional(),
  read_scope: z.array(z.string()).optional(),
  ack_required: z.boolean().optional(),
  review_required: z.boolean().optional(),
  review_state: z.enum(["none", "pending", "approved", "changes_requested"]).optional(),
  reviewed_by: z.string().min(1).nullable().optional(),
  review_notes: z.string().nullable().optional(),
  changed_files: z.array(z.string()).optional(),
  phase: z.string().nullable().optional(),
  session_id: z.string().min(1).max(128).nullable().optional(),
  allow_conflicts: z.boolean().optional(),
});

const RecordTaskEventInput = z.object({
  by_agent: z.string().min(1),
  task_id: z.number().int().positive(),
  event_type: z.enum(["note", "phase", "progress", "log", "result", "cancel"]).optional(),
  message: z.string().min(1),
  phase: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const ListTaskEventsInput = z.object({
  task_id: z.number().int().positive().optional(),
  by_agent: z.string().min(1).optional(),
  event_type: z.enum(["note", "phase", "progress", "log", "result", "cancel"]).optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  limit: z.number().int().positive().max(500).optional(),
});

const TaskResultInput = z.object({
  task_id: z.number().int().positive(),
  limit: z.number().int().positive().max(500).optional(),
});

const WaitForTaskInput = z.object({
  task_id: z.number().int().positive(),
  wait_s: z.number().int().nonnegative().max(110).optional(),
  since_updated_at: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const InboxStatusInput = z.object({
  agent: z.string().min(1),
  team: TeamFilterField,
  limit: z.number().int().positive().max(100).optional(),
});

const MessageStatusInput = z.object({
  message_id: z.number().int().positive(),
});

const ReplyThreadInput = z.object({
  from: z.string().min(1),
  thread_id: z.string().min(1),
  message: z.string(),
});

const CancelTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
  reason: z.string().nullable().optional(),
});

const AcknowledgeTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
  response: z.enum(["claimed", "declined", "blocked"]),
  note: z.string().nullable().optional(),
});

const SubmitReviewInput = z.object({
  reviewer: z.string().min(1),
  task_id: z.number().int().positive(),
  approved: z.boolean(),
  notes: z.string().nullable().optional(),
});

const HandoffTaskInput = z.object({
  from_agent: z.string().min(1),
  task_id: z.number().int().positive(),
  to_agent: z.string().min(1).nullable().optional(),
  reason: z.string().min(1),
  memory: z.string().nullable().optional(),
});

const CheckScopeConflictsInput = z.object({
  file_scope: z.array(z.string()).optional(),
  edit_scope: z.array(z.string()).optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
  exclude_task_id: z.number().int().positive().optional(),
});

const RecordTestResultInput = z.object({
  by_agent: z.string().min(1),
  task_id: z.number().int().positive().nullable().optional(),
  command: z.string().min(1),
  status: z.enum(["passed", "failed", "skipped"]),
  output_summary: z.string().nullable().optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
});

const ListTestResultsInput = z.object({
  task_id: z.number().int().positive().optional(),
  by_agent: z.string().min(1).optional(),
  status: z.enum(["passed", "failed", "skipped"]).optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  limit: z.number().int().positive().max(500).optional(),
});

const SetAgentStatusInput = z.object({
  agent: z.string().min(1),
  status: AgentStatusEnum,
});

const ReleaseTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
});

const ListTasksInput = z.object({
  state: z.union([TaskStateEnum, z.array(TaskStateEnum)]).optional(),
  claimed_by: z.string().optional(),
  requested_by: z.string().optional(),
  thread_id: z.string().optional(),
  include_terminal: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  required_capability: z.string().min(1).optional(),
  mode: TaskModeEnum.optional(),
  manager_reviewed: z.boolean().optional(),
});

const GetTaskInput = z.object({
  task_id: z.number().int().positive(),
});

const RecentInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
});

const RecordDecisionInput = z.object({
  by_agent: z.string().min(1),
  decision: z.string().min(1),
  rationale: z.string().nullable().optional(),
  implemented: z.boolean().optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
});

const ListDecisionsInput = z.object({
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  implemented: z.boolean().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const RememberInput = z.object({
  by_agent: z.string().min(1),
  kind: z.string().min(1).max(64),
  content: z.string().min(1),
  agent: z.string().min(1).nullable().optional(),
  project: ProjectField,
  area: AreaField,
  team: TeamField,
  task_id: z.number().int().positive().nullable().optional(),
  thread_id: z.string().min(1).nullable().optional(),
  pinned: z.boolean().optional(),
  supersedes_id: z.number().int().positive().nullable().optional(),
});

const ListMemoriesInput = z.object({
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  agent: z.string().min(1).optional(),
  kind: z.string().min(1).max(64).optional(),
  task_id: z.number().int().positive().optional(),
  thread_id: z.string().min(1).optional(),
  pinned: z.boolean().optional(),
  since: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(500).optional(),
});

const PinMemoryInput = z.object({
  memory_id: z.number().int().positive(),
});

const SessionBriefInput = z.object({
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  agent: z.string().min(1).optional(),
  limit: z.number().int().positive().max(50).optional(),
});

const TeamBoardInput = z.object({
  team: z.string().min(1).max(64),
  project: ProjectFilterField,
  area: AreaFilterField,
  limit: z.number().int().positive().max(100).optional(),
});

const ActivityInput = z.object({
  project: ProjectFilterField,
  area: AreaFilterField,
  team: TeamFilterField,
  since: z.number().int().nonnegative().optional(),
  limit: z.number().int().positive().max(200).optional(),
});

const NowInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive().optional(),
  phase: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
  status: AgentStatusEnum.optional(),
});

const TOOLS = [
  {
    name: "register",
    description:
      "Register this session as an agent on the bus. Pick a stable name like 'worker-a'. " +
      "Call once at session start; safe to call again to update capabilities (use replace:true).",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Unique agent name (1-64 chars, [a-zA-Z0-9_.-])" },
        capabilities: {
          type: "array",
          items: { type: "string" },
          description:
            "Tags describing what this agent is good at (e.g. ['react','css','supabase']). " +
            "Used by ask_best for capability-based routing.",
        },
        replace: {
          type: "boolean",
          description: "Take over the name even if another session holds it",
        },
        project: {
          type: ["string", "null"],
          description: "Optional project scope; defaults to this MCP session's cwd-derived project",
        },
        area: {
          type: ["string", "null"],
          description: "Optional subfolder/domain scope from .agent-bus.json",
        },
        team: {
          type: ["string", "null"],
          description: "Optional coordination team scope. Agents in different teams stay out of team-scoped routing/views.",
        },
        role: { type: ["string", "null"], description: "Optional role such as pm, worker, verifier, reviewer, listener" },
        routing_weight: { type: "number", description: "Optional routing preference weight for ask_best" },
        status: {
          type: "string",
          enum: ["idle", "working", "blocked", "waiting_review", "sleeping"],
          description: "Optional current work state for manager boards",
        },
        session_id: {
          type: ["string", "null"],
          description: "Optional host/model session id for grouping tasks and cleanup",
        },
      },
      required: ["name"],
    },
  },
  {
    name: "send",
    description:
      "Send a fire-and-forget message to another agent's inbox. Returns immediately. " +
      "A new thread is auto-created unless thread_id is provided.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Your registered agent name" },
        to: { type: "string", description: "Recipient agent name" },
        message: { type: "string", description: "Message body (no size cap)" },
        thread_id: {
          type: "string",
          description:
            "Optional: continue an existing conversation thread. Pass the thread_id from a previous message.",
        },
      },
      required: ["from", "to", "message"],
    },
  },
  {
    name: "inbox",
    description:
      "Read new messages addressed to you. " +
      "Pass wait_s to BLOCK until a message arrives (listener pattern). " +
      "Pass claim_s for at-least-once delivery — messages stay pending and require ack() to finalize.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Your registered agent name" },
        team: {
          type: "string",
          description:
            "Optional team filter. Pass a concrete team to read only that team's messages; pass '*' for all teams.",
        },
        since_id: { type: "number", description: "Only return messages with id > this" },
        mark_delivered: {
          type: "boolean",
          description: "Default true. If false (or claim_s set), messages stay pending.",
        },
        limit: { type: "number", description: "Max messages to return (default 50, cap 500)" },
        wait_s: {
          type: "number",
          description: "Block up to N seconds for the first message (max 110)",
        },
        claim_s: {
          type: "number",
          description:
            "At-least-once mode: claim returned messages for N seconds. Other readers see them as in-flight. " +
            "You MUST call ack() per message after success, or they become available again after the claim expires.",
        },
      },
      required: ["agent"],
    },
  },
  {
    name: "inbox_status",
    description:
      "Inspect an agent inbox without consuming messages. Shows unread, claimed/in-flight, recent delivered messages, and a clear summary.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Registered agent name" },
        team: {
          type: "string",
          description:
            "Optional team filter. Pass a concrete team to inspect only that team's inbox rows; pass '*' for all teams.",
        },
        limit: { type: "number", description: "Maximum rows per section (default 20, cap 100)" },
      },
      required: ["agent"],
    },
  },
  {
    name: "ack",
    description:
      "Acknowledge a message you successfully processed (used with inbox claim_s). " +
      "Flips status to delivered so the message is never redelivered.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Your agent name (must be the recipient)" },
        message_id: { type: "number", description: "id of the message to acknowledge" },
      },
      required: ["agent", "message_id"],
    },
  },
  {
    name: "ask",
    description:
      "Send a question and BLOCK until a reply arrives (or timeout). Capped at 110s. " +
      "Works best when the recipient is actively listening (in inbox(wait_s) loop).",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        question: { type: "string" },
        timeout_s: { type: "number", description: "Default 60, max 110" },
        thread_id: {
          type: "string",
          description: "Optional: continue an existing thread",
        },
      },
      required: ["from", "to", "question"],
    },
  },
  {
    name: "ask_best",
    description:
      "Route an ask to the most recently-active agent that has the given capability. " +
      "Useful when you don't know which agent to ask — describe the skill and the bus picks.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        capability: {
          type: "string",
          description:
            "Capability tag to match (e.g. 'react', 'supabase'). Agents register their capabilities with the register tool.",
        },
        question: { type: "string" },
        timeout_s: { type: "number" },
        thread_id: { type: "string" },
        project: { type: "string", description: "Optional project filter; '*' searches all projects" },
        area: { type: "string", description: "Optional area filter; '*' searches every area" },
        team: { type: "string", description: "Optional team filter; '*' searches every team" },
        role: { type: "string", description: "Optional role filter such as verifier or worker" },
      },
      required: ["from", "capability", "question"],
    },
  },
  {
    name: "reply",
    description:
      "Answer a pending ask. The original ask's sender will unblock and receive your answer. " +
      "The reply inherits the thread_id from the ask.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Your agent name" },
        ask_id: { type: "number", description: "id of the 'ask' message you are answering" },
        answer: { type: "string" },
      },
      required: ["from", "ask_id", "answer"],
    },
  },
  {
    name: "reply_thread",
    description:
      "Continue an existing thread without remembering the exact recipient. Sends to the last other participant in the thread.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Your agent name" },
        thread_id: { type: "string" },
        message: { type: "string" },
      },
      required: ["from", "thread_id", "message"],
    },
  },
  {
    name: "message_status",
    description:
      "Diagnose one message: delivery/claim state, reply, recipient presence, related task, and suggested next actions.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "number" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "why_no_reply",
    description:
      "Explain why an ask/message has no reply yet, including recipient presence, claim state, and related task context.",
    inputSchema: {
      type: "object",
      properties: {
        message_id: { type: "number" },
      },
      required: ["message_id"],
    },
  },
  {
    name: "send_team",
    description:
      "Send one message to every active agent in a team, optionally scoped by project/area. Use for private team fan-out without manually addressing each agent.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        team: { type: "string", description: "Team to send to. Defaults to sender's registered team when omitted." },
        message: { type: "string" },
        thread_id: { type: "string" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        include_self: { type: "boolean" },
      },
      required: ["from", "message"],
    },
  },
  {
    name: "ask_team",
    description:
      "Ask the best active member of a team. Optionally filter by capability and role. Use for team-scoped request/response.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        team: { type: "string", description: "Team to ask. Defaults to sender's registered team when omitted." },
        question: { type: "string" },
        timeout_s: { type: "number" },
        thread_id: { type: "string" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        capability: { type: "string", description: "Optional capability required on the selected team member" },
        role: { type: "string", description: "Optional role required on the selected team member" },
      },
      required: ["from", "question"],
    },
  },
  {
    name: "subscribe",
    description:
      "Subscribe this agent to a named channel. After subscribing, any send_channel(channel) puts a copy in your inbox.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        channel: {
          type: "string",
          description: "Channel name (e.g. 'alerts', 'review-queue', 'team-updates')",
        },
      },
      required: ["agent", "channel"],
    },
  },
  {
    name: "unsubscribe",
    description: "Remove this agent from a channel.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        channel: { type: "string" },
      },
      required: ["agent", "channel"],
    },
  },
  {
    name: "send_channel",
    description:
      "Broadcast a message to every subscriber of a channel. " +
      "Returns the list of messages created (one per subscriber). Sender is excluded from the fan-out.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string" },
        channel: { type: "string" },
        message: { type: "string" },
        thread_id: { type: "string" },
      },
      required: ["from", "channel", "message"],
    },
  },
  {
    name: "subscribers",
    description: "List the agents subscribed to a channel.",
    inputSchema: {
      type: "object",
      properties: {
        channel: { type: "string" },
      },
      required: ["channel"],
    },
  },
  {
    name: "thread",
    description: "Read all messages in a conversation thread, in order.",
    inputSchema: {
      type: "object",
      properties: {
        thread_id: { type: "string" },
        limit: { type: "number" },
      },
      required: ["thread_id"],
    },
  },
  {
    name: "whois",
    description:
      "List every agent currently registered on the bus along with capabilities and last-seen timestamps.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
      },
    },
  },
  {
    name: "directory",
    description:
      "List registered agents with status, age, scope, role, capabilities, and active task id.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
      },
    },
  },
  {
    name: "wait_for_agents",
    description:
      "Wait for an expected roster of agents and report ready, missing, stale, and wrong-scope registrations.",
    inputSchema: {
      type: "object",
      properties: {
        names: { type: "array", items: { type: "string" } },
        project: { type: "string", description: "Expected project; '*' means any project" },
        area: { type: "string", description: "Expected area; '*' means any area" },
        team: { type: "string", description: "Expected team; '*' means any team" },
        timeout_s: { type: "number", description: "Seconds to wait, max 110" },
      },
      required: ["names"],
    },
  },
  {
    name: "recent",
    description: "Read the most recent messages on the bus regardless of recipient. Useful for catching up.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 50, max 500" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create a new task in state 'open'. Tasks are first-class units of work — different from " +
      "messages, which are events. A new thread_id is generated unless provided. " +
      "Use blocked_on_task_id to record a soft dependency (no auto-unblock behavior in v1).",
    inputSchema: {
      type: "object",
      properties: {
        requested_by: { type: "string", description: "Your registered agent name" },
        title: { type: "string", description: "1-200 chars" },
        description: { type: "string" },
        thread_id: { type: "string" },
        priority: { type: "number", description: "Higher = sorts first in list_tasks" },
        cwd: { type: "string", description: "Working directory the task targets" },
        blocked_on_task_id: { type: "number" },
        project: { type: ["string", "null"], description: "Optional project scope; defaults to requester" },
        area: { type: ["string", "null"], description: "Optional area scope; defaults to requester" },
        team: { type: ["string", "null"], description: "Optional team scope; defaults to requester" },
        required_capability: { type: ["string", "null"], description: "Optional capability required to claim this task" },
        mode: { type: "string", enum: ["investigate_only", "propose_patch", "edit_files", "test_only"] },
        expected_output: { type: ["string", "null"] },
        deadline_at: { type: ["number", "null"] },
        checkin_at: { type: ["number", "null"] },
        final_answer: { type: ["string", "null"] },
        manager_reviewed: { type: "boolean" },
        file_scope: { type: "array", items: { type: "string" } },
        edit_scope: { type: "array", items: { type: "string" } },
        read_scope: { type: "array", items: { type: "string" } },
        ack_required: { type: "boolean" },
        review_required: { type: "boolean" },
        changed_files: { type: "array", items: { type: "string" } },
        phase: { type: ["string", "null"], description: "Optional fine-grained phase such as planning, editing, testing, or review" },
        session_id: { type: ["string", "null"], description: "Optional session id associated with this task" },
        allow_conflicts: { type: "boolean" },
      },
      required: ["requested_by", "title"],
    },
  },
  {
    name: "delegate",
    description:
      "Create a task, assign it to an agent, require acknowledgement by default, notify the assignee, and record a delegation event. Use for long-running work instead of ask.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Coordinator/requester agent name" },
        to_agent: { type: "string", description: "Assignee agent name" },
        title: { type: "string", description: "1-200 chars" },
        description: { type: "string" },
        thread_id: { type: "string" },
        priority: { type: "number" },
        cwd: { type: "string" },
        blocked_on_task_id: { type: "number" },
        project: { type: ["string", "null"], description: "Optional project scope; defaults to requester/session" },
        area: { type: ["string", "null"], description: "Optional area scope; defaults to requester/session" },
        team: { type: ["string", "null"], description: "Optional team scope; defaults to requester/session" },
        required_capability: { type: ["string", "null"] },
        mode: { type: "string", enum: ["investigate_only", "propose_patch", "edit_files", "test_only"] },
        expected_output: { type: ["string", "null"] },
        deadline_at: { type: ["number", "null"] },
        checkin_at: { type: ["number", "null"] },
        file_scope: { type: "array", items: { type: "string" } },
        edit_scope: { type: "array", items: { type: "string" } },
        read_scope: { type: "array", items: { type: "string" } },
        ack_required: { type: "boolean", description: "Default true" },
        review_required: { type: "boolean" },
        allow_pending_agent: { type: "boolean" },
        allow_conflicts: { type: "boolean" },
      },
      required: ["from", "to_agent", "title"],
    },
  },
  {
    name: "delegate_team",
    description:
      "Create board-visible tracked tasks for active members of a team. " +
      "Use this instead of send_team when the user expects work to appear on team_board/project_board/Kanban. " +
      "Returns created tasks plus skipped stale/paused/mismatched recipients.",
    inputSchema: {
      type: "object",
      properties: {
        from: { type: "string", description: "Coordinator/requester agent name" },
        team: { type: "string", description: "Team to delegate to; defaults to sender team when omitted" },
        title: { type: "string", description: "1-200 chars" },
        description: { type: "string" },
        thread_id: { type: "string", description: "Optional shared thread id for all created tasks" },
        priority: { type: "number" },
        cwd: { type: "string" },
        blocked_on_task_id: { type: "number" },
        project: { type: ["string", "null"], description: "Optional project scope; defaults to requester/session" },
        area: { type: ["string", "null"], description: "Optional area scope; defaults to requester/session" },
        capability: { type: "string", description: "Only delegate to team members with this capability" },
        role: { type: "string", description: "Only delegate to team members with this role" },
        include_self: { type: "boolean", description: "Include the sender if they are in the target team" },
        max_recipients: { type: "number", description: "Safety cap for created tasks; default 50, max 100" },
        required_capability: { type: ["string", "null"], description: "Capability required later for claiming each task" },
        mode: { type: "string", enum: ["investigate_only", "propose_patch", "edit_files", "test_only"] },
        expected_output: { type: ["string", "null"] },
        deadline_at: { type: ["number", "null"] },
        checkin_at: { type: ["number", "null"] },
        file_scope: { type: "array", items: { type: "string" } },
        edit_scope: { type: "array", items: { type: "string" } },
        read_scope: { type: "array", items: { type: "string" } },
        ack_required: { type: "boolean", description: "Default true" },
        review_required: { type: "boolean" },
        allow_conflicts: { type: "boolean" },
      },
      required: ["from", "title"],
    },
  },
  {
    name: "claim_task",
    description:
      "Atomically claim an 'open' task. Only succeeds if state='open' AND claimed_by IS NULL — " +
      "concurrent claims for the same task return TASK_NOT_CLAIMABLE.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Your registered agent name" },
        task_id: { type: "number" },
        allow_conflicts: { type: "boolean" },
      },
      required: ["agent", "task_id"],
    },
  },
  {
    name: "set_agent_status",
    description: "Set an agent work state: idle, working, blocked, waiting_review, or sleeping.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        status: { type: "string", enum: ["idle", "working", "blocked", "waiting_review", "sleeping"] },
      },
      required: ["agent", "status"],
    },
  },
  {
    name: "sleep_agent",
    description: "Mark an agent as sleeping.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
      required: ["agent"],
    },
  },
  {
    name: "wake_agent",
    description: "Wake a sleeping agent by setting status to idle.",
    inputSchema: {
      type: "object",
      properties: { agent: { type: "string" } },
      required: ["agent"],
    },
  },
  {
    name: "assign_task",
    description: "Assign an open task directly to an agent, moving it to claimed.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
        to_agent: { type: "string" },
        allow_conflicts: { type: "boolean" },
        allow_pending_agent: { type: "boolean" },
      },
      required: ["task_id", "to_agent"],
    },
  },
  {
    name: "claim_best_task",
    description:
      "Claim the highest-priority open task in this agent's project/area that matches its capabilities. Returns null if none.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
      },
      required: ["agent"],
    },
  },
  {
    name: "update_task",
    description:
      "Update a task. State transitions are strict: open->claimed|canceled, claimed->working|open|canceled|failed, " +
      "working->blocked|completed|failed|canceled, blocked->working|completed|failed|canceled. " +
      "Terminal states (completed, failed, canceled) cannot transition. Only the claimer or the requester can update.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        task_id: { type: "number" },
        state: {
          type: "string",
          enum: ["open", "claimed", "working", "blocked", "completed", "failed", "canceled"],
        },
        blocked_reason: { type: ["string", "null"] },
        blocked_on_task_id: { type: ["number", "null"] },
        result: {
          type: ["string", "null"],
          description: "Final output or summary on completed/failed",
        },
        priority: { type: "number" },
        mode: { type: "string", enum: ["investigate_only", "propose_patch", "edit_files", "test_only"] },
        expected_output: { type: ["string", "null"] },
        deadline_at: { type: ["number", "null"] },
        checkin_at: { type: ["number", "null"] },
        final_answer: { type: ["string", "null"] },
        manager_reviewed: { type: "boolean" },
        file_scope: { type: "array", items: { type: "string" } },
        edit_scope: { type: "array", items: { type: "string" } },
        read_scope: { type: "array", items: { type: "string" } },
        ack_required: { type: "boolean" },
        review_required: { type: "boolean" },
        review_state: { type: "string", enum: ["none", "pending", "approved", "changes_requested"] },
        reviewed_by: { type: ["string", "null"] },
        review_notes: { type: ["string", "null"] },
        changed_files: { type: "array", items: { type: "string" } },
        phase: { type: ["string", "null"], description: "Optional fine-grained phase such as planning, editing, testing, or review" },
        session_id: { type: ["string", "null"], description: "Optional session id associated with this task" },
        allow_conflicts: { type: "boolean" },
      },
      required: ["agent", "task_id"],
    },
  },
  {
    name: "release_task",
    description:
      "Return a held task to 'open' so another agent can claim it. The claimer or the requester can release. " +
      "Refuses on terminal states.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        task_id: { type: "number" },
      },
      required: ["agent", "task_id"],
    },
  },
  {
    name: "acknowledge_task",
    description:
      "Acknowledge an assigned task as claimed, declined, or blocked. Sends a receipt back to the requester.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        task_id: { type: "number" },
        response: { type: "string", enum: ["claimed", "declined", "blocked"] },
        note: { type: ["string", "null"] },
      },
      required: ["agent", "task_id", "response"],
    },
  },
  {
    name: "submit_review",
    description:
      "Submit verifier review for a task. Approved reviews satisfy review gates; rejected reviews mark changes_requested.",
    inputSchema: {
      type: "object",
      properties: {
        reviewer: { type: "string" },
        task_id: { type: "number" },
        approved: { type: "boolean" },
        notes: { type: ["string", "null"] },
      },
      required: ["reviewer", "task_id", "approved"],
    },
  },
  {
    name: "handoff_task",
    description:
      "Create a pinned handoff memory for a task and optionally assign it to another agent, or release it if no target is provided.",
    inputSchema: {
      type: "object",
      properties: {
        from_agent: { type: "string" },
        task_id: { type: "number" },
        to_agent: { type: ["string", "null"] },
        reason: { type: "string" },
        memory: { type: ["string", "null"] },
      },
      required: ["from_agent", "task_id", "reason"],
    },
  },
  {
    name: "check_scope_conflicts",
    description:
      "Check whether a proposed file_scope overlaps active claimed/working/blocked tasks in the same project/area.",
    inputSchema: {
      type: "object",
      properties: {
        file_scope: { type: "array", items: { type: "string" } },
        edit_scope: { type: "array", items: { type: "string" } },
        project: { type: ["string", "null"] },
        area: { type: ["string", "null"] },
        team: { type: ["string", "null"] },
        exclude_task_id: { type: "number" },
      },
      required: [],
    },
  },
  {
    name: "record_test_result",
    description:
      "Record explicit test/build/lint evidence for final_report.",
    inputSchema: {
      type: "object",
      properties: {
        by_agent: { type: "string" },
        task_id: { type: ["number", "null"] },
        command: { type: "string" },
        status: { type: "string", enum: ["passed", "failed", "skipped"] },
        output_summary: { type: ["string", "null"] },
        project: { type: ["string", "null"] },
        area: { type: ["string", "null"] },
        team: { type: ["string", "null"] },
      },
      required: ["by_agent", "command", "status"],
    },
  },
  {
    name: "list_test_results",
    description: "List recorded test/build/lint evidence.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
        by_agent: { type: "string" },
        status: { type: "string", enum: ["passed", "failed", "skipped"] },
        project: { type: "string" },
        area: { type: "string" },
        team: { type: "string" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "record_task_event",
    description:
      "Append a task progress/event log row. Use for phases, progress notes, command summaries, result notes, and cancellation context.",
    inputSchema: {
      type: "object",
      properties: {
        by_agent: { type: "string" },
        task_id: { type: "number" },
        event_type: { type: "string", enum: ["note", "phase", "progress", "log", "result", "cancel"] },
        message: { type: "string" },
        phase: { type: ["string", "null"], description: "Optional phase; also updates task.phase when present" },
        metadata: { type: "object", additionalProperties: true },
      },
      required: ["by_agent", "task_id", "message"],
    },
  },
  {
    name: "list_task_events",
    description: "List task event/progress rows, optionally filtered by task, agent, type, project, or area.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
        by_agent: { type: "string" },
        event_type: { type: "string", enum: ["note", "phase", "progress", "log", "result", "cancel"] },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "task_result",
    description: "Fetch one task plus its event log, test evidence, related memories, and thread messages.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
        limit: { type: "number", description: "Maximum related rows per section" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "wait_for_task",
    description:
      "Wait up to 110s for a task update/event/message/test result, then return task_result plus holder, latest activity, timeout flag, and next actions.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
        wait_s: { type: "number", description: "Seconds to wait, max 110" },
        since_updated_at: { type: "number", description: "Only return when activity is newer than this ms epoch" },
        limit: { type: "number", description: "Maximum related rows per section" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "cancel_task",
    description:
      "Cancel a non-terminal task, record a cancel event, notify the other side, and run task.canceled hooks.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string", description: "Requester or current holder" },
        task_id: { type: "number" },
        reason: { type: ["string", "null"] },
      },
      required: ["agent", "task_id"],
    },
  },
  {
    name: "list_tasks",
    description:
      "List tasks. By default excludes terminal states (completed/failed/canceled); set include_terminal:true to show them. " +
      "Sorted by priority DESC, then creation order. Each returned task includes a `stale` flag when its holder hasn't been " +
      "seen in the last AGENT_BUS_TASK_STALE_MS (default 5 min).",
    inputSchema: {
      type: "object",
      properties: {
        state: {
          oneOf: [
            {
              type: "string",
              enum: ["open", "claimed", "working", "blocked", "completed", "failed", "canceled"],
            },
            {
              type: "array",
              items: {
                type: "string",
                enum: ["open", "claimed", "working", "blocked", "completed", "failed", "canceled"],
              },
            },
          ],
        },
        claimed_by: { type: "string" },
        requested_by: { type: "string" },
        thread_id: { type: "string" },
        include_terminal: { type: "boolean" },
        limit: { type: "number" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        required_capability: { type: "string" },
        mode: { type: "string", enum: ["investigate_only", "propose_patch", "edit_files", "test_only"] },
        manager_reviewed: { type: "boolean" },
      },
    },
  },
  {
    name: "activity",
    description:
      "Chronological project/area/team activity timeline across messages, task events, test results, decisions, and memories.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        since: { type: "number", description: "Optional lower bound as ms epoch" },
        limit: { type: "number", description: "Maximum activity rows" },
      },
    },
  },
  {
    name: "cockpit",
    description:
      "Coordinator dashboard: waiting items, ready items, blockers, suggested next actions, and the underlying project board.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        agent: { type: "string", description: "Optional agent-specific memory filter" },
        limit: { type: "number", description: "Maximum items per section" },
      },
    },
  },
  {
    name: "now",
    description:
      "Update an agent's visible current work in one call: status plus optional task phase/progress event.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        task_id: { type: "number" },
        phase: { type: ["string", "null"] },
        note: { type: ["string", "null"] },
        status: { type: "string", enum: ["idle", "working", "blocked", "waiting_review", "sleeping"] },
      },
      required: ["agent"],
    },
  },
  {
    name: "project_board",
    description:
      "Manager board: agents, open/active/blocked/waiting-review/stale tasks, scope conflicts, pinned risks/handoffs, and deterministic next actions.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        agent: { type: "string", description: "Optional agent-specific memory filter" },
        limit: { type: "number", description: "Maximum items per section" },
      },
    },
  },
  {
    name: "team_board",
    description:
      "Manager board for one team: agents, tasks, review queue, acknowledgements, conflicts, pinned risks/handoffs, and next actions.",
    inputSchema: {
      type: "object",
      properties: {
        team: { type: "string", description: "Team to inspect" },
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        limit: { type: "number", description: "Maximum items per section" },
      },
      required: ["team"],
    },
  },
  {
    name: "get_task",
    description: "Fetch a single task by id.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: { type: "number" },
      },
      required: ["task_id"],
    },
  },
  {
    name: "record_decision",
    description: "Persist a project decision with rationale and implemented flag.",
    inputSchema: {
      type: "object",
      properties: {
        by_agent: { type: "string" },
        decision: { type: "string" },
        rationale: { type: ["string", "null"] },
        implemented: { type: "boolean" },
        project: { type: ["string", "null"] },
        area: { type: ["string", "null"] },
        team: { type: ["string", "null"] },
      },
      required: ["by_agent", "decision"],
    },
  },
  {
    name: "list_decisions",
    description: "List persisted decisions for the current project/area.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        area: { type: "string" },
        team: { type: "string" },
        implemented: { type: "boolean" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "remember",
    description:
      "Persist a structured memory for future sessions: summary, handoff, risk, todo, fact, blocker, lesson, gotcha, or a custom kind.",
    inputSchema: {
      type: "object",
      properties: {
        by_agent: { type: "string", description: "Agent recording the memory" },
        kind: { type: "string", description: "Memory kind, e.g. summary, handoff, risk, todo, fact, blocker, lesson, gotcha" },
        content: { type: "string", description: "Memory body" },
        agent: { type: ["string", "null"], description: "Optional subject/target agent" },
        project: { type: ["string", "null"], description: "Optional project scope; defaults to this MCP session's scope" },
        area: { type: ["string", "null"], description: "Optional area scope; defaults to this MCP session's scope" },
        team: { type: ["string", "null"], description: "Optional team scope; defaults to recording agent" },
        task_id: { type: ["number", "null"], description: "Optional related task id" },
        thread_id: { type: ["string", "null"], description: "Optional related thread id" },
        pinned: { type: "boolean", description: "Pin this memory so session_brief surfaces it above recent memories" },
        supersedes_id: { type: ["number", "null"], description: "Optional older memory id this one replaces" },
      },
      required: ["by_agent", "kind", "content"],
    },
  },
  {
    name: "list_memories",
    description: "List structured memories for the current project/area, optionally filtered by agent, kind, task, or thread.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        agent: { type: "string", description: "Optional subject or author agent filter" },
        kind: { type: "string", description: "Optional memory kind filter" },
        task_id: { type: "number", description: "Optional related task filter" },
        thread_id: { type: "string", description: "Optional related thread filter" },
        pinned: { type: "boolean", description: "Optional pinned/unpinned filter" },
        since: { type: "number", description: "Optional created_at lower bound (ms epoch)" },
        limit: { type: "number" },
      },
    },
  },
  {
    name: "pin_memory",
    description: "Pin a memory so session_brief surfaces it in the pinned handoff section.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "number" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "unpin_memory",
    description: "Unpin a memory so it returns to normal recent-memory ordering.",
    inputSchema: {
      type: "object",
      properties: {
        memory_id: { type: "number" },
      },
      required: ["memory_id"],
    },
  },
  {
    name: "session_brief",
    description:
      "Generate a startup/handoff brief from live agents, open/blocked/stale tasks, recent decisions, memories, and messages.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "Optional project filter; '*' means all projects" },
        area: { type: "string", description: "Optional area filter; '*' means all areas" },
        team: { type: "string", description: "Optional team filter; '*' means all teams" },
        agent: { type: "string", description: "Optional agent-specific memory filter" },
        limit: { type: "number", description: "Maximum items per section, up to 50" },
      },
    },
  },
  {
    name: "final_report",
    description: "Generate a merge-readiness report from tasks.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        area: { type: "string" },
        team: { type: "string" },
      },
    },
  },
  {
    name: "review_gate",
    description:
      "Return a deterministic merge/push gate from the project board and final report. ok=false includes blockers and warnings.",
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string" },
        area: { type: "string" },
        team: { type: "string" },
      },
    },
  },
] as const;

const server = new Server(
  { name: "agent-bus", version: packageVersion() },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  try {
    const result = await dispatch(name, args ?? {});
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    const isBusError = err instanceof BusError;
    const code = isBusError ? err.code : "INTERNAL";
    const message = err instanceof Error ? err.message : String(err);
    return {
      isError: true,
      content: [
        { type: "text", text: JSON.stringify({ error: { code, message } }, null, 2) },
      ],
    };
  }
});

async function dispatch(tool: string, raw: unknown): Promise<unknown> {
  switch (tool) {
    case "register": {
      const input = RegisterInput.parse(raw);
      return register({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
      });
    }
    case "send": {
      const input = SendInput.parse(raw);
      return send({
        from: input.from,
        to: input.to,
        content: input.message,
        thread_id: input.thread_id,
      });
    }
    case "send_team": {
      const input = SendTeamInput.parse(raw);
      return sendTeam({
        ...input,
        content: input.message,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
      });
    }
    case "inbox":
      return inbox(InboxInput.parse(raw));
    case "inbox_status":
      return inboxStatus(InboxStatusInput.parse(raw));
    case "ack":
      return ack(AckInput.parse(raw));
    case "ask":
      return ask(AskInput.parse(raw));
    case "ask_best": {
      const input = AskBestInput.parse(raw);
      return askBest({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "ask_team": {
      const input = AskTeamInput.parse(raw);
      return await askTeam({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "reply":
      return reply(ReplyInput.parse(raw));
    case "reply_thread":
      return replyThread(ReplyThreadInput.parse(raw));
    case "message_status":
      return messageStatus(MessageStatusInput.parse(raw));
    case "why_no_reply":
      return whyNoReply(MessageStatusInput.parse(raw).message_id);
    case "subscribe":
      return subscribe(SubscribeInput.parse(raw));
    case "unsubscribe": {
      unsubscribe(SubscribeInput.parse(raw));
      return { ok: true };
    }
    case "send_channel": {
      const input = SendChannelInput.parse(raw);
      return sendChannel({
        from: input.from,
        channel: input.channel,
        content: input.message,
        thread_id: input.thread_id,
      });
    }
    case "subscribers":
      return subscribers(SubscribersInput.parse(raw).channel);
    case "thread": {
      const input = ThreadInput.parse(raw);
      return threadMessages(input.thread_id, input.limit ?? 200);
    }
    case "whois": {
      const input = WhoisInput.parse(raw);
      return whois({
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "directory": {
      const input = WhoisInput.parse(raw);
      return directory({
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "wait_for_agents": {
      const input = WaitForAgentsInput.parse(raw);
      return await waitForAgents({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "recent": {
      const input = RecentInput.parse(raw);
      return recentMessages({
        limit: input.limit ?? 50,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "create_task": {
      const input = CreateTaskInput.parse(raw);
      return createTask({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "delegate": {
      const input = DelegateInput.parse(raw);
      return delegate({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "delegate_team": {
      const input = DelegateTeamInput.parse(raw);
      return delegateTeam({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "claim_task":
      return claimTask(ClaimTaskInput.parse(raw));
    case "set_agent_status": {
      const input = SetAgentStatusInput.parse(raw);
      return setAgentStatus(input.agent, input.status);
    }
    case "sleep_agent":
      return sleepAgent(z.object({ agent: z.string().min(1) }).parse(raw).agent);
    case "wake_agent":
      return wakeAgent(z.object({ agent: z.string().min(1) }).parse(raw).agent);
    case "assign_task":
      return assignTask(AssignTaskInput.parse(raw));
    case "claim_best_task": {
      const input = ClaimBestTaskInput.parse(raw);
      return claimBestTask({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "update_task":
      return updateTask(UpdateTaskInput.parse(raw));
    case "release_task":
      return releaseTask(ReleaseTaskInput.parse(raw));
    case "acknowledge_task":
      return acknowledgeTask(AcknowledgeTaskInput.parse(raw));
    case "submit_review":
      return submitReview(SubmitReviewInput.parse(raw));
    case "handoff_task":
      return handoffTask(HandoffTaskInput.parse(raw));
    case "check_scope_conflicts": {
      const input = CheckScopeConflictsInput.parse(raw);
      return checkScopeConflicts({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "record_test_result": {
      const input = RecordTestResultInput.parse(raw);
      return recordTestResult({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "list_test_results": {
      const input = ListTestResultsInput.parse(raw);
      return listTestResults({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "record_task_event":
      return recordTaskEvent(RecordTaskEventInput.parse(raw));
    case "list_task_events": {
      const input = ListTaskEventsInput.parse(raw);
      return listTaskEvents({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "task_result": {
      const input = TaskResultInput.parse(raw);
      return taskResult(input.task_id, input.limit);
    }
    case "wait_for_task": {
      const input = WaitForTaskInput.parse(raw);
      return await waitForTask(input);
    }
    case "cancel_task":
      return cancelTask(CancelTaskInput.parse(raw));
    case "list_tasks": {
      const input = ListTasksInput.parse(raw);
      return listTasks({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "get_task":
      return getTask(GetTaskInput.parse(raw).task_id);
    case "activity": {
      const input = ActivityInput.parse(raw);
      return activityTimeline({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "cockpit": {
      const input = SessionBriefInput.parse(raw);
      return cockpit({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "now":
      return agentNow(NowInput.parse(raw));
    case "record_decision": {
      const input = RecordDecisionInput.parse(raw);
      return recordDecision({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
      });
    }
    case "list_decisions": {
      const input = ListDecisionsInput.parse(raw);
      return listDecisions({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "remember": {
      const input = RememberInput.parse(raw);
      return remember({
        ...input,
        project: input.project === undefined ? SESSION_SCOPE.project : input.project,
        area: input.area === undefined ? SESSION_SCOPE.area : input.area,
        team: input.team,
      });
    }
    case "list_memories": {
      const input = ListMemoriesInput.parse(raw);
      return listMemories({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "pin_memory": {
      const input = PinMemoryInput.parse(raw);
      return pinMemory(input.memory_id, true);
    }
    case "unpin_memory": {
      const input = PinMemoryInput.parse(raw);
      return pinMemory(input.memory_id, false);
    }
    case "session_brief": {
      const input = SessionBriefInput.parse(raw);
      return sessionBrief({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "project_board": {
      const input = SessionBriefInput.parse(raw);
      return projectBoard({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "team_board": {
      const input = TeamBoardInput.parse(raw);
      return teamBoard({
        ...input,
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
      });
    }
    case "final_report": {
      const input = WhoisInput.parse(raw);
      return finalReport({
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    case "review_gate": {
      const input = WhoisInput.parse(raw);
      return reviewGate({
        project: input.project ?? (SESSION_SCOPE.project ?? undefined),
        area: input.area ?? (SESSION_SCOPE.area ?? undefined),
        team: input.team,
      });
    }
    default:
      throw new BusError("INVALID_INPUT", `unknown tool '${tool}'`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
