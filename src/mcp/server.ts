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
  ask,
  askBest,
  claimTask,
  createTask,
  getTask,
  inbox,
  listTasks,
  recentMessages,
  register,
  releaseTask,
  reply,
  send,
  sendChannel,
  subscribe,
  subscribers,
  threadMessages,
  unsubscribe,
  updateTask,
  whois,
} from "../bus.js";
import { BusError } from "../util/errors.js";
import { deriveProject } from "../util/project.js";

// MCP servers inherit cwd from the spawning session, so this is the
// project context for everything this process handles. Derived once at
// startup (the cwd doesn't change for the life of an MCP child process).
const SESSION_PROJECT: string | null = deriveProject();

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

// project filter accepts "*" (global) or a project slug or null/omit (default scope)
const ProjectField = z.string().min(1).max(64).nullable().optional();
const ProjectFilterField = z.string().min(1).max(64).optional();

const RegisterInput = z.object({
  name: z.string().min(1).max(64),
  capabilities: z.array(z.string()).max(32).optional(),
  replace: z.boolean().optional(),
  project: ProjectField,
});

const SendInput = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  message: z.string(),
  thread_id: z.string().optional(),
});

const InboxInput = z.object({
  agent: z.string().min(1),
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
});

const ClaimTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
});

const UpdateTaskInput = z.object({
  agent: z.string().min(1),
  task_id: z.number().int().positive(),
  state: TaskStateEnum.optional(),
  blocked_reason: z.string().nullable().optional(),
  blocked_on_task_id: z.number().int().positive().nullable().optional(),
  result: z.string().nullable().optional(),
  priority: z.number().int().optional(),
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
});

const GetTaskInput = z.object({
  task_id: z.number().int().positive(),
});

const RecentInput = z.object({
  limit: z.number().int().positive().max(500).optional(),
  project: ProjectFilterField,
});

const TOOLS = [
  {
    name: "register",
    description:
      "Register this session as an agent on the bus. Pick a stable name like 'claude-frontend'. " +
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
    name: "subscribe",
    description:
      "Subscribe this agent to a named channel. After subscribing, any send_channel(channel) puts a copy in your inbox.",
    inputSchema: {
      type: "object",
      properties: {
        agent: { type: "string" },
        channel: {
          type: "string",
          description: "Channel name (e.g. 'alerts', 'review-queue', 'frontend-team')",
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
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "recent",
    description: "Read the most recent messages on the bus regardless of recipient. Useful for catching up.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Default 50, max 500" },
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
      },
      required: ["requested_by", "title"],
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
      },
      required: ["agent", "task_id"],
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
      },
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
] as const;

const server = new Server(
  { name: "agent-bus", version: "0.4.0" },
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
        project: input.project === undefined ? SESSION_PROJECT : input.project,
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
    case "inbox":
      return inbox(InboxInput.parse(raw));
    case "ack":
      return ack(AckInput.parse(raw));
    case "ask":
      return ask(AskInput.parse(raw));
    case "ask_best": {
      const input = AskBestInput.parse(raw);
      return askBest({
        ...input,
        project: input.project ?? (SESSION_PROJECT ?? undefined),
      });
    }
    case "reply":
      return reply(ReplyInput.parse(raw));
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
      return whois({ project: input.project ?? (SESSION_PROJECT ?? undefined) });
    }
    case "recent": {
      const input = RecentInput.parse(raw);
      return recentMessages({
        limit: input.limit ?? 50,
        project: input.project ?? (SESSION_PROJECT ?? undefined),
      });
    }
    case "create_task": {
      const input = CreateTaskInput.parse(raw);
      return createTask({
        ...input,
        project: input.project === undefined ? SESSION_PROJECT : input.project,
      });
    }
    case "claim_task":
      return claimTask(ClaimTaskInput.parse(raw));
    case "update_task":
      return updateTask(UpdateTaskInput.parse(raw));
    case "release_task":
      return releaseTask(ReleaseTaskInput.parse(raw));
    case "list_tasks": {
      const input = ListTasksInput.parse(raw);
      return listTasks({
        ...input,
        project: input.project ?? (SESSION_PROJECT ?? undefined),
      });
    }
    case "get_task":
      return getTask(GetTaskInput.parse(raw).task_id);
    default:
      throw new BusError("INVALID_INPUT", `unknown tool '${tool}'`);
  }
}

const transport = new StdioServerTransport();
await server.connect(transport);
