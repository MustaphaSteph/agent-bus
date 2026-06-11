# MCP tools reference

Every tool exposed by `agent-bus-mcp`. All return JSON. Errors return
`{ error: { code, message } }` with `isError: true`.

## register

Claim a name + declare capabilities.

```ts
register({
  name: string,                // 1-64 chars, [a-zA-Z0-9_.-]
  capabilities?: string[],     // tags for ask_best routing
  replace?: boolean,           // take over an actively-held name
  project?: string | null,      // MCP default is derived from cwd; null is global
  area?: string | null,         // MCP default from .agent-bus.json; null is no area
  team?: string | null,         // optional workgroup inside the project/area
  role?: string | null,         // pm, worker, verifier, reviewer, listener, ...
  routing_weight?: number,      // higher wins when ask_best candidates tie
  status?: "idle" | "working" | "blocked" | "waiting_review" | "sleeping",
  session_id?: string | null,   // optional host/model session id
}) → Agent
```

**Returns** the `Agent` row, including `bus_version` when the adapter
knows it and `listening_until` when a blocking inbox wait or CLI waiter
has marked the session as actively listening.

**Errors**: `INVALID_INPUT` (bad name format), `NAME_TAKEN` (name active
within last 60s and `replace` not passed).

```js
register({ name: "worker-a", team: "frontend", capabilities: ["tests", "review"] })
// → { name: "worker-a", capabilities: ["tests","review"],
//     registered_at: ..., last_seen: ..., paused: false,
//     project: "agent-bus", area: "area-a", team: "frontend" }
```

## send

Fire-and-forget direct message. Returns immediately.

```ts
send({
  from: string,
  to: string,
  message: string,
  priority?: "low" | "normal" | "high" | "urgent",
  thread_id?: string,          // continue an existing thread; auto-generated otherwise
}) → Message
```

**Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT` (either `from` or `to` not registered).

```js
send({ from: "alpha", to: "beta", message: "hello" })
// → { id: 17, from_agent: "alpha", to_agent: "beta", kind: "msg",
//     content: "hello", thread_id: "t_kxxx_abc...", status: "pending", ... }
```

## inbox

Read pending messages addressed to you.

```ts
inbox({
  agent: string,
  project?: string,            // optional exact project filter
  area?: string,               // optional exact area filter
  team?: string,               // concrete team only; "*" means all teams
  thread_id?: string,          // only consume this thread
  wait_s?: number,             // block up to N seconds for first arrival (max 110)
  claim_s?: number,            // at-least-once mode: keep pending, require ack
  since_id?: number,           // only return messages with id > this
  mark_delivered?: boolean,    // default true (ignored when claim_s set)
  limit?: number,              // default 50, max 500
}) → Message[]
```

Without `wait_s` it's a snapshot. With `wait_s` it blocks until a message
arrives or the timeout fires and marks the agent as `listening` until the
wait window expires. Thread/project/area/team filters apply before
delivery, so a thread-scoped inbox only consumes messages from that
thread and leaves unrelated pending messages queued.

**Without `claim_s`**: returned messages flip to `delivered` immediately.
At-most-once delivery.

**With `claim_s`**: returned messages stay `pending` with a
`claim_deadline`. Other inbox calls won't see them while the claim is
live. You **must** call `ack(message_id)` per message. If the claim
expires, the message becomes visible again.

**Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT`.

```js
// Listener pattern
inbox({ agent: "alpha", wait_s: 110 })

// Team-only listener pattern
inbox({ agent: "alpha", team: "frontend", wait_s: 110 })

// At-least-once
inbox({ agent: "alpha", wait_s: 110, claim_s: 300 })
```

## inbox_status

Inspect an inbox without consuming messages. Use this when a coordinator
needs to distinguish "nothing unread" from "claimed/in flight" or "last
message already delivered". If message bodies may be huge, use
`inbox_previews` instead so the tool result stays small.

```ts
inbox_status({
  agent: string,
  project?: string,
  area?: string,
  team?: string,               // concrete team only; "*" means all teams
  thread_id?: string,
  since_id?: number,
  limit?: number,              // default 20, max 100 per section
}) -> {
  agent: string,
  unread: Message[],
  in_flight: Message[],
  delivered_recent: Message[],
  last_message: Message | null,
  next_claim_deadline: number | null,
  summary: string,
}
```

## inbox_previews

Preview pending inbox messages without consuming them and without
returning full message bodies. Use this before `inbox` when a worker may
have large messages queued.

```ts
inbox_previews({
  agent: string,
  project?: string,
  area?: string,
  team?: string,               // concrete team only; "*" means all teams
  thread_id?: string,
  since_id?: number,
  wait_s?: number,             // block up to N seconds for first arrival (max 110)
  limit?: number,              // default 20, max 100
  preview_chars?: number,      // default 300, max 4000
}) -> MessagePreview[]
```

`MessagePreview` has the same metadata as `Message`, but replaces
`content` with `content_preview`, `content_length`, and `truncated`.

## get_message

Fetch one exact message by id. For huge messages, pass
`include_content:false` or `preview_chars` first, then fetch the full
content only when you really need it.

```ts
get_message({
  message_id: number,
  include_content?: boolean,   // false returns a preview instead of full content
  preview_chars?: number,      // also returns a preview
  project?: string,            // optional safety filter
  area?: string,               // optional safety filter
  team?: string,               // optional safety filter
}) -> {
  message: Message | MessagePreview,
  full_content_included: boolean,
  suggested_next_actions: string[],
}
```

When `project`, `area`, or `team` is provided, the message must belong
to that scope or the call returns `MESSAGE_NOT_FOUND`. This lets agents
fetch exact message ids without accidentally reading unrelated project
or team traffic.

## ack

Acknowledge a claimed message. Flips status to `delivered` and clears
the claim.

```ts
ack({
  agent: string,               // must equal message's to_agent
  message_id: number,
}) → Message
```

**Errors**: `MESSAGE_NOT_FOUND` (id doesn't exist), `INVALID_INPUT` (wrong
agent for that message).

```js
ack({ agent: "alpha", message_id: 42 })
```

## ask

Send a question and BLOCK until a `reply` lands or the timeout fires.
Use this only when the recipient is online/listening and the user needs
the answer to continue. If the recipient is stale or paused, `ask`
fails fast with `ASK_RECIPIENT_UNAVAILABLE` instead of burning the
timeout window.

```ts
ask({
  from: string,
  to: string,
  question: string,
  timeout_s?: number,          // default 60, max 110
  thread_id?: string,          // continue a thread
}) → Message                   // the reply message
```

**Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT`, `ASK_CYCLE` (active
opposite ask would deadlock; stale opposite asks older than the active
ask window are ignored), `ASK_RECIPIENT_UNAVAILABLE`, `ASK_TIMEOUT`.

```js
const reply = await ask({
  from: "alpha", to: "beta", question: "what's 2+2?", timeout_s: 30
})
// → { kind: "reply", content: "4", reply_to: <ask_id>, ... }
```

## ask_async

Create an `ask` row and return immediately with the ask id, recipient
presence, and suggested next actions. Use this when the recipient may
not be listening, the answer can arrive later, or the work should not
block the current agent session.

```ts
ask_async({
  from: string,
  to: string,
  question: string,
  thread_id?: string,
}) → {
  ask: Message,                 // kind: "ask", status: "pending"
  recipient: AgentDirectoryEntry | null,
  suggested_next_actions: string[],
}
```

## ask_best

Route an `ask` to the most-recently-active agent that has the given
capability.

```ts
ask_best({
  from: string,
  capability: string,
  question: string,
  timeout_s?: number,
  thread_id?: string,
  project?: string,             // default asker's project; "*" searches globally
  area?: string,                // default asker's area; "*" searches every area
  team?: string,                // default asker's team; "*" searches every team
  role?: string,                // optional role filter
}) → Message                   // the reply
```

Picks the candidate with the most recent `last_seen` in the selected
project, area, and team, preferring higher `routing_weight` first. Refuses
matches where the candidate hasn't been seen in 5 minutes. If no
in-scope match exists, it fails with a hint to pass
`project: "*"`, `area: "*"`, and/or `team: "*"` for a broader search.

**Errors**: `UNKNOWN_AGENT` (no registered agent has the capability, or
the best match is stale), plus everything `ask` can throw.

```js
ask_best({ from: "human", capability: "react",
           question: "memoize this list?" })
```

## reply

Answer a pending ask or reply to a normal message. For asks, it inherits
the ask's thread_id and marks the ask answered. If `ask_id` points to a
normal `msg` or existing `reply`, `reply` infers the thread and creates
a threaded conversational reply instead of returning `ASK_NOT_FOUND`.

```ts
reply({
  from: string,                // ask recipient or message participant
  ask_id: number,
  answer: string,
}) → Message                   // the reply message
```

**Errors**: `ASK_NOT_FOUND`, `INVALID_INPUT` (wrong agent/not a
participant).

```js
reply({ from: "beta", ask_id: 42, answer: "4" })
```

## reply_thread

Continue an existing thread without remembering the exact recipient. It
sends to the last other participant in the thread, and creates a **real
threaded reply**: the message is `kind: "reply"` with `reply_to` set to
the thread's root (oldest) message. That groups every reply Slack-style
under one root, so the cockpit shows a "N replies → view thread"
affordance. Use this for conversational follow-ups; use `reply` to answer
a specific `ask` (which sets `reply_to` to that ask instead).

```ts
reply_thread({
  from: string,
  thread_id: string,
  message: string,
}) -> Message  // kind: "reply", reply_to: <thread root id>
```

## message_status / why_no_reply

Diagnose delivery, claim, reply, recipient presence, and related task
context for a single message. `why_no_reply` is the same diagnostic view
with ask/no-reply wording for coordinators.

```ts
message_status({ message_id: number }) -> {
  message: Message,
  reply: Message | null,
  recipient: AgentDirectoryEntry | null,
  related_task: Task | null,
  diagnostics: string[],
  suggested_next_actions: string[],
}

why_no_reply({ message_id: number }) -> same shape
```

## subscribe

Subscribe an agent to a channel.

```ts
subscribe({
  agent: string,
  channel: string,             // 1-64 chars, [a-zA-Z0-9_.:#-]
}) → Subscription
```

Idempotent — re-subscribing updates `subscribed_at`.

```js
subscribe({ agent: "worker-a", channel: "team-updates" })
// → { channel: "team-updates", agent: "worker-a", subscribed_at: ... }
```

## unsubscribe

Remove an agent from a channel.

```ts
unsubscribe({
  agent: string,
  channel: string,
}) → { ok: true }
```

No-op if not subscribed.

## send_channel

Broadcast a message to every subscriber. Fans out: one `messages` row
per subscriber. Sender excluded from the fan-out.

```ts
send_channel({
  from: string,
  channel: string,
  message: string,
  thread_id?: string,
}) → Message[]                 // one per recipient (could be empty)
```

**Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT` (sender not registered).

```js
send_channel({ from: "alice", channel: "alerts",
               message: "deploy starting" })
```

## send_team / ask_team

Address the active members of a named team without managing a channel
subscription list. A team is neutral scope metadata; it does not impose
roles or behavior.

```ts
send_team({
  from: string,
  team?: string,                // default sender's team
  message: string,
  thread_id?: string,
  project?: string,             // default sender/session project
  area?: string,                // default sender/session area
  include_self?: boolean,
}) → Message[]

ask_team({
  from: string,
  team?: string,                // default sender's team
  question: string,
  timeout_s?: number,
  thread_id?: string,
  project?: string,
  area?: string,
  capability?: string,
  role?: string,
}) → Message
```

`send_team` fans out to active, non-paused, non-stale agents in the
selected team. `ask_team` picks the best active team member using the
same routing order as `ask_best` and can narrow by capability or role.

These tools are message routing only. They do not create tasks and will
not show up as `open_tasks` or `active_tasks` on `project_board` /
`team_board`. For board-visible team assignments, use `delegate_team`.

## subscribers

List the agents subscribed to a channel.

```ts
subscribers({ channel: string }) → string[]
```

```js
subscribers({ channel: "team-updates" }) // → ["worker-a","worker-b"]
```

## thread

Read every message in a thread, in chronological order.

```ts
thread({
  thread_id: string,
  limit?: number,              // default 200, max 1000
}) → Message[]
```

Useful for reconstructing a multi-message exchange.

## whois

List every registered agent with capabilities and last-seen.

```ts
whois({ project?: string, area?: string, team?: string }) → Agent[]   // "*" = all
```

## directory

List agents with derived status and active task metadata.

```ts
directory({ project?: string, area?: string, team?: string }) → AgentDirectoryEntry[]
```

Removed agents are hidden from `whois`, `directory`, routing, and inbox
delivery. Historical messages/tasks still keep their agent names for
audit.

## remove_agent

Remove one agent/member from the live roster while preserving message and
task history. If the agent holds active work, the tool refuses unless you
explicitly release that work.

```ts
remove_agent({
  name: string,
  release_tasks?: boolean,     // reopen active tasks held by this agent
  force?: boolean,             // currently equivalent to release_tasks
}) → {
  removed_agent: Agent,
  active_tasks: number[],
  released_tasks: number[],
  subscriptions_deleted: number,
  preserved_history: true,
}
```

**Errors**: `UNKNOWN_AGENT`, `AGENT_HAS_ACTIVE_TASKS`.

## delete_team

Delete a team scope from live boards. This tombstones live members in that
team, deletes their channel subscriptions, and clears the team label from
preserved history rows so the team disappears from scoped views. It does
not physically delete messages, tasks, decisions, memories, or test
evidence.

```ts
delete_team({
  team: string,
  project?: string,            // default current MCP project; "*" = all projects
  area?: string,               // default current MCP area; "*" = all areas
  release_tasks?: boolean,     // reopen active team tasks
  force?: boolean,             // currently equivalent to release_tasks
}) → {
  team: string,
  project: string | null,
  area: string | null,
  removed_agents: string[],
  active_tasks: number[],
  released_tasks: number[],
  unscoped: Record<string, number>,
  preserved_history: true,
}
```

**Errors**: `TEAM_NOT_FOUND`, `TEAM_HAS_ACTIVE_TASKS`.

## wait_for_agents

Wait for an expected team roster before the manager starts assigning
work.

```ts
wait_for_agents({
  names: string[],
  project?: string,            // concrete project or "*" for any
  area?: string,               // concrete area or "*" for any
  team?: string,               // concrete team or "*" for any
  timeout_s?: number,          // default 60, max 110
}) → {
  ready: AgentDirectoryEntry[],
  missing: string[],
  stale: AgentDirectoryEntry[],
  wrong_scope: Array<{
    name: string,
    project: string | null,
    area: string | null,
    team: string | null,
    expected_project: string | null,
    expected_area: string | null,
    expected_team: string | null,
  }>,
}
```

Use this when a coordinator knows the intended agents, such as
`worker-a`, `worker-b`, and `reviewer`, but some sessions may not have
registered yet.

## set_agent_status / sleep_agent / wake_agent

Update an agent's work state.

```ts
set_agent_status({ agent: string, status: "idle" | "working" | "blocked" | "waiting_review" | "sleeping" }) → Agent
sleep_agent({ agent: string }) → Agent
wake_agent({ agent: string }) → Agent
```

## recent

Read the most recent messages on the bus, regardless of who sent them or
who they're for. Doesn't flip status.

```ts
recent({ limit?: number, project?: string, area?: string, team?: string }) → Message[]    // default 50, max 500
```

Useful when you want to catch up on what's been happening. A concrete
project or area includes matching messages plus legacy/global null-scope
messages; `"*"` returns all for that dimension.

## create_task

Create a first-class unit of work. Tasks are queryable stateful work
items; messages and threads carry the discussion around them.

```ts
create_task({
  requested_by: string,
  title: string,               // 1-200 chars
  description?: string,
  thread_id?: string,          // auto-generated otherwise
  state?: "backlog" | "open",  // default open
  milestone?: string | null,   // free-form label such as "mvp"
  priority?: number,           // higher sorts first
  cwd?: string,                // target working directory
  blocked_on_task_id?: number, // soft dependency, no auto-unblock
  project?: string | null,      // default requester's project
  area?: string | null,         // default requester's area
  team?: string | null,         // default requester's team
  required_capability?: string | null,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  deadline_at?: number | null,  // ms epoch
  checkin_at?: number | null,   // ms epoch
  final_answer?: string | null,
  manager_reviewed?: boolean,
  file_scope?: string[],       // legacy/general scope
  edit_scope?: string[],       // files this task may modify
  read_scope?: string[],       // files this task may inspect
  ack_required?: boolean,
  review_required?: boolean,
  independent_review?: boolean, // reject holder/pending assignee as reviewer
  changed_files?: string[],
  phase?: string | null,
  session_id?: string | null,
  allow_conflicts?: boolean,
}) -> Task
```

Creates the task in `open` state by default. Use `state:"backlog"` for
ideas or parked work that should show on boards but should not be
claimable or block `review_gate`/`final_report` safety. `milestone` is a
free-form label only; it does not create hierarchy or automatic release
behavior. **Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT`,
`TASK_NOT_FOUND` for a missing dependency.

## claim_task

Atomically claim an open task.

```ts
claim_task({
  agent: string,
  task_id: number,
  allow_conflicts?: boolean,
}) -> Task
```

Only succeeds when `state='open'` and `claimed_by IS NULL`; concurrent
claimers get `TASK_NOT_CLAIMABLE`.

## assign_task

Assign an open task directly to an agent.

```ts
assign_task({
  task_id: number,
  to_agent: string,
  allow_conflicts?: boolean,
  allow_pending_agent?: boolean,
}) -> Task
```

`assign_task` sends the assignee an inbox notification. If the agent is
not registered yet, pass `allow_pending_agent: true`; the task stays
open with `pending_assignee` and the assignee is notified when it
registers. Claiming, assignment, and conflict checks use `edit_scope`
by default for edit/propose tasks.

## delegate

High-level long-work primitive: create a task, assign it, require
acknowledgement by default, notify the assignee, and record a delegation
event. Use it instead of `ask` when the work can take longer than one
tool timeout.

```ts
delegate({
  from: string,
  to_agent: string,
  title: string,
  description?: string,
  thread_id?: string,
  milestone?: string | null,
  priority?: number,
  cwd?: string,
  blocked_on_task_id?: number,
  project?: string | null,
  area?: string | null,
  team?: string | null,
  required_capability?: string | null,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  deadline_at?: number | null,
  checkin_at?: number | null,
  file_scope?: string[],
  edit_scope?: string[],
  read_scope?: string[],
  ack_required?: boolean,      // default true
  review_required?: boolean,
  independent_review?: boolean,
  allow_pending_agent?: boolean,
  allow_conflicts?: boolean,
}) -> {
  task: Task,
  event: TaskEvent,
  assigned: boolean,
  pending: boolean,
  suggested_next_actions: string[],
}
```

## delegate_team

Team long-work primitive: create a board-visible tracked task for each
active matching member of a team. Use it instead of `send_team` when
the user expects work to appear on `team_board`, `kanban`, or `done`.

```ts
delegate_team({
  from: string,
  team?: string,                // default sender's team
  title: string,
  description?: string,
  thread_id?: string,           // shared by all created tasks
  milestone?: string | null,
  priority?: number,
  cwd?: string,
  project?: string | null,
  area?: string | null,
  required_capability?: string | null,
  capability?: string,          // filter recipients by capability
  role?: string,                // filter recipients by role
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  deadline_at?: number | null,
  checkin_at?: number | null,
  file_scope?: string[],
  edit_scope?: string[],
  read_scope?: string[],
  ack_required?: boolean,       // default true
  review_required?: boolean,
  independent_review?: boolean,
  allow_conflicts?: boolean,
  include_self?: boolean,
  max_recipients?: number,
}) -> {
  team: string,
  thread_id: string,
  expected_count: number,
  delegated_count: number,
  tasks: DelegateResult[],
  skipped: { name: string, reason: string }[],
  suggested_next_actions: string[],
}
```

`delegate_team` only targets active, non-paused, non-stale registered
members in a concrete team. It reports skipped members, including
paused/stale agents, self, capability or role mismatches, and
`max_recipients` overflow.

## claim_best_task

Claim the highest-priority open task in the agent's project/area/team
that matches its capabilities. Backlog tasks are intentionally ignored
until promoted to `open`.

```ts
claim_best_task({
  agent: string,
  project?: string,
  area?: string,
  team?: string,
}) -> Task | null
```

## update_task

Update task metadata or move through the strict state machine.

```ts
update_task({
  agent: string,
  task_id: number,
  state?: "backlog" | "open" | "claimed" | "working" | "blocked" |
          "completed" | "failed" | "canceled",
  blocked_reason?: string | null,
  blocked_on_task_id?: number | null,
  result?: string | null,
  milestone?: string | null,
  priority?: number,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  deadline_at?: number | null,
  checkin_at?: number | null,
  final_answer?: string | null,
  manager_reviewed?: boolean,
  file_scope?: string[],
  edit_scope?: string[],
  read_scope?: string[],
  ack_required?: boolean,
  review_required?: boolean,
  independent_review?: boolean,
  review_state?: "none" | "pending" | "approved" | "changes_requested",
  reviewed_by?: string | null,
  review_notes?: string | null,
  changed_files?: string[],
  phase?: string | null,
  session_id?: string | null,
  allow_conflicts?: boolean,
}) -> Task
```

Allowed transitions:

| From | To |
|---|---|
| `backlog` | `open`, `canceled` |
| `open` | `backlog`, `claimed`, `canceled` |
| `claimed` | `working`, `completed`, `open`, `canceled`, `failed` |
| `working` | `blocked`, `completed`, `failed`, `canceled` |
| `blocked` | `working`, `completed`, `failed`, `canceled` |
| `completed`, `failed`, `canceled` | none |

Only the requester or holder can update. **Errors**:
`TASK_INVALID_TRANSITION`, `TASK_FORBIDDEN`, `TASK_NOT_FOUND`,
`TASK_SCOPE_CONFLICT`, `TASK_REVIEW_REQUIRED`.

`independent_review` is default false for compatibility. When true,
`submit_review` rejects the current `claimed_by` holder or
`pending_assignee` with `REVIEW_SELF_FORBIDDEN`; the requester may still
review because PM-requester review is the common workflow.

Moving a task to `backlog` parks it and clears the holder/pending
assignee/phase fields. `deadline_at` is surfaced as overdue for
open/claimed/working/blocked
tasks. `checkin_at` is surfaced as check-in due for claimed/working/
blocked tasks. These are computed when boards/cockpit are read; they do
not create task events or require a daemon.

## release_task

Return a held non-terminal task to `open` so another agent can claim it.

```ts
release_task({
  agent: string,
  task_id: number,
}) -> Task
```

The requester or current holder can release. Terminal tasks cannot be
released.

## acknowledge_task / submit_review / handoff_task

Task receipts, review gates, and clean handoffs for multi-agent work.

```ts
acknowledge_task({
  agent: string,
  task_id: number,
  response: "claimed" | "declined" | "blocked",
  note?: string | null,
}) -> Task

submit_review({
  reviewer: string,
  task_id: number,
  approved: boolean,
  notes?: string | null,
}) -> Task

handoff_task({
  from_agent: string,
  task_id: number,
  to_agent?: string | null,
  reason: string,
  memory?: string | null,
}) -> { task: Task, memory: Memory | null, message: Message | null }
```

`submit_review(approved:true)` satisfies review-required tasks.
`handoff_task` records a pinned `handoff` memory and either reassigns or
releases the task.

## check_scope_conflicts / project_board

Manager safety views.

```ts
check_scope_conflicts({
  file_scope?: string[],
  edit_scope?: string[],
  project?: string | null,
  area?: string | null,
  team?: string | null,
  exclude_task_id?: number,
}) -> ScopeConflict[]

project_board({
  project?: string,
  area?: string,
  team?: string,
  limit?: number,
}) -> {
  agents: AgentDirectoryEntry[],
  open_tasks: Task[],
  active_tasks: Task[],
  blocked_tasks: Task[],
  backlog_tasks: Task[],
  waiting_review: Task[],
  waiting_acknowledgement: Task[],
  stale_tasks: Task[],
  scope_conflicts: { task_id: number, title: string, conflicts: ScopeConflict[] }[],
  pinned_risks: Memory[],
  pinned_handoffs: Memory[],
  suggested_next_actions: string[],
}

team_board({
  team: string,
  project?: string,
  area?: string,
  limit?: number,
}) -> ProjectBoard

activity({
  project?: string,
  area?: string,
  team?: string,
  since?: number,
  limit?: number,
}) -> ActivityItem[]

cockpit({
  project?: string,
  area?: string,
  team?: string,
  agent?: string,
  limit?: number,
}) -> {
  waiting_on: string[],
  ready: string[],
  blockers: string[],
  suggested_next_actions: string[],
  board: ProjectBoard,
}

now({
  agent: string,
  task_id?: number,
  phase?: string | null,
  note?: string | null,
  status?: "idle" | "working" | "blocked" | "waiting_review" | "sleeping",
}) -> {
  agent: Agent,
  task: Task | null,
  event: TaskEvent | null,
  suggested_next_actions: string[],
}
```

`check_scope_conflicts` compares active edit/propose tasks by
`edit_scope`. Verifier or test-only tasks can set a broad `read_scope`
without creating edit-conflict noise.
`activity` is the compact "what happened recently?" timeline across
messages, task events, test results, decisions, and memories. `cockpit`
is the coordinator next-action view. `now` is the agent self-status
helper: it updates visible status, optional task phase, and records a
task event when a note or phase is provided.

## list_tasks

List tasks sorted by `priority DESC, created_at ASC`.

```ts
list_tasks({
  state?: TaskState | TaskState[],
  claimed_by?: string,
  requested_by?: string,
  thread_id?: string,
  include_terminal?: boolean,  // default false
  limit?: number,              // default 100, max 500
  project?: string,             // concrete project or "*" for all
  area?: string,                // concrete area or "*" for all
  team?: string,                // concrete team or "*" for all
  required_capability?: string,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  milestone?: string,
  manager_reviewed?: boolean,
}) -> Task[]
```

By default terminal tasks (`completed`, `failed`, `canceled`) are hidden,
but backlog tasks are included so a manager can see parked ideas and
ready work together. Active tasks may include `stale: true` when the
holder has not heartbeated within `AGENT_BUS_TASK_STALE_MS` (default 5
minutes). Concrete project and area filters hide null-scope legacy
tasks; `project: "*"` and `area: "*"` return all projects/areas.

## get_task

Fetch a single task.

```ts
get_task({ task_id: number }) -> Task
```

**Errors**: `TASK_NOT_FOUND`.

## record_decision / list_decisions

Persist project decisions so agents do not repeat the same debate.

```ts
record_decision({
  by_agent: string,
  decision: string,
  rationale?: string | null,
  implemented?: boolean,
  project?: string | null,
  area?: string | null,
  team?: string | null,
}) -> Decision

list_decisions({
  project?: string,
  area?: string,
  team?: string,
  implemented?: boolean,
  limit?: number,
}) -> Decision[]
```

## remember / list_memories / session_brief

Persist structured session memory and generate startup/handoff context.

```ts
remember({
  by_agent: string,
  kind: "summary" | "handoff" | "risk" | "todo" | "fact" | "blocker" | "lesson" | "gotcha" | string,
  content: string,
  agent?: string | null,
  project?: string | null,
  area?: string | null,
  team?: string | null,
  task_id?: number | null,
  thread_id?: string | null,
  pinned?: boolean,
  supersedes_id?: number | null,
}) -> Memory

list_memories({
  project?: string,
  area?: string,
  team?: string,
  agent?: string,
  kind?: string,
  task_id?: number,
  thread_id?: string,
  pinned?: boolean,
  since?: number,
  limit?: number,
}) -> Memory[]

pin_memory({ memory_id: number }) -> Memory
unpin_memory({ memory_id: number }) -> Memory

session_brief({
  project?: string,
  area?: string,
  team?: string,
  agent?: string,
  limit?: number,
}) -> {
  active_agents: AgentDirectoryEntry[],
  open_tasks: Task[],
  blocked_tasks: Task[],
  stale_tasks: Task[],
  recent_decisions: Decision[],
  pinned_memories: Memory[],
  recent_memories: Memory[],
  recent_messages: Message[],
  suggested_next_actions: string[],
}
```

`remember` defaults project/area to the recording agent when not supplied.
Pinned memories are surfaced near the top of `session_brief`; use pinned
`handoff` memories for "next agent please read" context.

## record_task_event / list_task_events / task_result / cancel_task

Append durable task progress, fetch a full task evidence bundle, or
cancel work cleanly.

```ts
record_task_event({
  by_agent: string,
  task_id: number,
  event_type?: "note" | "phase" | "progress" | "log" | "result" | "cancel",
  message: string,
  phase?: string | null,       // also updates task.phase when present
  metadata?: Record<string, unknown>,
}) -> TaskEvent

list_task_events({
  task_id?: number,
  by_agent?: string,
  event_type?: "note" | "phase" | "progress" | "log" | "result" | "cancel",
  project?: string,
  area?: string,
  team?: string,
  limit?: number,
}) -> TaskEvent[]

task_result({ task_id: number, limit?: number }) -> {
  task: Task,
  events: TaskEvent[],
  test_results: TestResult[],
  memories: Memory[],
  messages: Message[],
}

wait_for_task({
  task_id: number,
  wait_s?: number,             // default/max 110
  since_updated_at?: number,   // ms epoch; defaults to current task updated_at
  limit?: number,
}) -> TaskResult & {
  timed_out: boolean,
  holder: AgentDirectoryEntry | null,
  latest_event: TaskEvent | null,
  latest_message: Message | null,
  latest_test_result: TestResult | null,
  suggested_next_actions: string[],
}

cancel_task({
  agent: string,       // requester or current holder
  task_id: number,
  reason?: string | null,
}) -> { task: Task, event: TaskEvent }
```

Use `record_task_event` for phase changes (`planning`, `editing`,
`testing`, `review`, `done`), progress notes, command summaries, and
final result notes. The CLI Kanban maps stable task states plus phase
into human workflow lanes: Todo, Accepted, Doing, Testing, Review, and
Blocked. Use `task_result` before verification or handoff so the
reviewer sees task state, events, tests, memories, and thread messages
together. `cancel_task` marks the task terminal, records a cancel event,
notifies the other side, and runs `task.canceled` hooks.

## record_test_result / list_test_results

Record explicit evidence from build, lint, unit test, browser smoke, or
manual checks. `final_report` includes these rows so the merge report is
grounded in commands that actually ran.

```ts
record_test_result({
  by_agent: string,
  task_id?: number | null,
  command: string,
  status: "passed" | "failed" | "skipped",
  output_summary?: string | null,
  git_ref?: string | null,      // caller-supplied ref/commit tested
  cwd?: string | null,          // working directory where evidence ran
  project?: string | null,
  area?: string | null,
  team?: string | null,
}) -> TestResult

list_test_results({
  task_id?: number,
  by_agent?: string,
  status?: "passed" | "failed" | "skipped",
  project?: string,
  area?: string,
  team?: string,
  limit?: number,
}) -> TestResult[]
```

`git_ref` and `cwd` are informational evidence anchors. The bus never
derives git state and `review_gate` does not block on missing refs.

## final_report

Generate merge-readiness output from tasks.

```ts
final_report({ project?: string, area?: string, team?: string }) -> {
  implemented: string[],
  not_implemented: string[],
  known_risks: string[],
  tests_passed: string[],
  test_results: TestResult[],
  manual_tests_needed: string[],
  safe_to_commit: boolean,
  safe_to_push: boolean,
  safe_to_deploy: false,
}
```

## review_gate

Build a deterministic merge/push gate from `project_board` and
`final_report`.

```ts
review_gate({ project?: string, area?: string, team?: string }) -> {
  ok: boolean,
  blockers: string[],
  warnings: string[],
  final_report: FinalReport,
  board: ProjectBoard,
}
```

`ok=false` when active work, blocked work, pending reviews, edit-scope
conflicts, or unsafe final-report flags remain. Warnings include stale
holders and missing acknowledgements.

---

## Common patterns

### Send and wait

```js
send({ from: "me", to: "you", message: "..." })
const replies = await inbox({ agent: "me", wait_s: 30 })
```

### Synchronous Q&A

```js
const reply = await ask({ from: "me", to: "you", question: "..." })
```

### Async Q&A

```js
const pending = ask_async({ from: "me", to: "you", question: "..." })
// keep working; later check message_status(pending.ask.id) or inbox_status("me")
```

### Listener loop

```js
while (true) {
  const previews = await inbox_previews({ agent: "me", wait_s: 110 })
  if (previews.some((m) => m.truncated)) {
    // Use get_message({ include_content:false }) or ask for a file path/artifact
    // before pulling a huge body into the model context.
  }
  const msgs = await inbox({ agent: "me", wait_s: 110, limit: 1 })
  for (const m of msgs) {
    const answer = handle(m)
    if (m.kind === "ask") reply({ from: "me", ask_id: m.id, answer })
    else send({ from: "me", to: m.from_agent, message: answer,
                thread_id: m.thread_id })
  }
}
```

### Reliable processing (at-least-once)

```js
while (true) {
  const msgs = await inbox({ agent: "me", wait_s: 110, claim_s: 300 })
  for (const m of msgs) {
    try {
      doWork(m)
      ack({ agent: "me", message_id: m.id })
    } catch (e) {
      // don't ack — message will redeliver after claim expires
    }
  }
}
```

### Broadcast to a team

```js
subscribe({ agent: "me", channel: "alerts" })
send_channel({ from: "ci", channel: "alerts", message: "deploy failed" })
```

### Message a scoped team

```js
register({ name: "pm", project: "movie-app", area: "*", team: "ios-ui" })
send_team({ from: "pm", team: "ios-ui", message: "sync on navigation" })
const reply = await ask_team({
  from: "pm",
  team: "ios-ui",
  capability: "design",
  question: "which detail layout should we implement first?"
})
```
