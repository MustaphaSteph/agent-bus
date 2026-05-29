# agent-bus MCP tools — quick reference

Load this when you need the exact contract for a tool the SKILL.md
doesn't cover in detail. There are 56 MCP tools. All return JSON.
Errors return `{ error: { code: string, message: string } }` with
`isError: true`.

Use project/area/team defaults unless the user asks for a broader view.
`project: "*"` means all projects. `area: "*"` means all areas.
`team: "*"` means all teams.

## Identity and Team Board

### register
Claim or refresh a name on the bus. Use `replace: true` for stable
agent identities across restarts.
```ts
register({
  name: string,
  capabilities?: string[],
  replace?: boolean,
  project?: string | null,
  area?: string | null,
  team?: string | null,
  role?: string | null,
  routing_weight?: number,
  status?: "idle" | "working" | "blocked" | "waiting_review" | "sleeping",
  session_id?: string | null,
}) -> Agent
```

### whois / directory
```ts
whois({ project?: string | "*", area?: string | "*", team?: string | "*" }) -> Agent[]
directory({ project?: string | "*", area?: string | "*", team?: string | "*" }) -> AgentDirectoryEntry[]
wait_for_agents({
  names: string[],
  project?: string | "*",
  area?: string | "*",
  team?: string | "*",
  timeout_s?: number,
}) -> { ready: AgentDirectoryEntry[], missing: string[], stale: AgentDirectoryEntry[], wrong_scope: unknown[] }
```
`directory` includes presence, status, age, role, area, and active task.
Prefer it for manager/team-board views.

### set_agent_status / sleep_agent / wake_agent
```ts
set_agent_status({ agent: string, status: "idle" | "working" | "blocked" | "waiting_review" | "sleeping" }) -> Agent
sleep_agent({ agent: string }) -> Agent
wake_agent({ agent: string }) -> Agent
```
Status is manager metadata, separate from `pause`/`resume` delivery.

## Direct Messaging

### send
```ts
send({
  from: string,
  to: string,
  message: string,
  thread_id?: string,
  priority?: "low" | "normal" | "high" | "urgent",
}) -> Message
```

### inbox / inbox_status / ack
```ts
inbox({
  agent: string,
  team?: string,         // concrete team only; "*" means all teams
  wait_s?: number,       // max 110
  claim_s?: number,      // at-least-once mode; ack after processing
  since_id?: number,
  mark_delivered?: boolean,
  limit?: number,
}) -> Message[]

inbox_status({
  agent: string,
  team?: string,
  limit?: number,
}) -> {
  unread: Message[],
  in_flight: Message[],
  delivered_recent: Message[],
  last_message: Message | null,
  next_claim_deadline: number | null,
  summary: string,
}

ack({ agent: string, message_id: number }) -> Message
```
Use `wait_s: 110` for listener loops. Use `claim_s` for work that must
not be lost; skipped ack means redelivery after the claim expires.
In team workflows, pass your concrete `team` to `inbox` and
`inbox_status` so unrelated direct or cross-team messages stay queued
until you intentionally read all teams.
Use `inbox_status` when you need to inspect unread/claimed/recent
delivery state without consuming anything.

## Request / Response

### ask / ask_best / reply / reply_thread
```ts
ask({
  from: string,
  to: string,
  question: string,
  timeout_s?: number,    // max 110
  thread_id?: string,
  priority?: "low" | "normal" | "high" | "urgent",
}) -> Message

ask_best({
  from: string,
  capability: string,
  question: string,
  timeout_s?: number,
  thread_id?: string,
  project?: string | "*",
  area?: string | "*",
  team?: string | "*",
  role?: string,
  priority?: "low" | "normal" | "high" | "urgent",
}) -> Message

reply({ from: string, ask_id: number, answer: string }) -> Message
reply_thread({ from: string, thread_id: string, message: string }) -> Message

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
`ask_best` defaults to the caller's project/area/team and refuses stale
agents. Use wildcards only for deliberate cross-project/cross-area/team work.
Use `reply_thread` when continuing a conversation and the recipient is
obvious from thread history. Use `message_status`/`why_no_reply` before
guessing that an agent ignored an ask.

## Channels

```ts
subscribe({ agent: string, channel: string }) -> Subscription
unsubscribe({ agent: string, channel: string }) -> { ok: true }
send_channel({ from: string, channel: string, message: string, thread_id?: string }) -> Message[]
subscribers({ channel: string }) -> string[]
```

## Teams

Teams are neutral scope metadata for workgroups inside a project/area.
They do not hard-code roles or behavior.

```ts
send_team({
  from: string,
  team?: string,              // default sender's team
  message: string,
  thread_id?: string,
  project?: string | "*",
  area?: string | "*",
  include_self?: boolean,
}) -> Message[]

ask_team({
  from: string,
  team?: string,              // default sender's team
  question: string,
  timeout_s?: number,
  thread_id?: string,
  project?: string | "*",
  area?: string | "*",
  capability?: string,
  role?: string,
}) -> Message

team_board({ team: string, project?: string | "*", area?: string | "*", limit?: number }) -> ProjectBoard
```

Use `send_team` for fan-out to active members of the workgroup.
Use `ask_team` for one best responder inside that workgroup.
Use `team_board` when a coordinator wants a board scoped to one team.

## Discovery

```ts
thread({ thread_id: string, limit?: number }) -> Message[]
recent({ limit?: number, project?: string | "*", area?: string | "*", team?: string | "*" }) -> Message[]
```

## Tasks

### create_task
```ts
create_task({
  requested_by: string,
  title: string,
  description?: string,
  thread_id?: string,
  priority?: number,
  cwd?: string,
  blocked_on_task_id?: number,
  required_capability?: string,
  project?: string | null,
  area?: string | null,
  team?: string | null,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string,
  deadline_at?: string,
  checkin_at?: string,
  edit_scope?: string[],
  read_scope?: string[],
  file_scope?: string[],
  ack_required?: boolean,
  review_required?: boolean,
  changed_files?: string[],
  phase?: string | null,
  session_id?: string | null,
  allow_conflicts?: boolean,
}) -> Task
```

### claim_task / assign_task / claim_best_task
```ts
claim_task({ agent: string, task_id: number, allow_conflicts?: boolean }) -> Task
assign_task({ task_id: number, to_agent: string, allow_conflicts?: boolean, allow_pending_agent?: boolean }) -> Task
claim_best_task({
  agent: string,
  project?: string | "*",
  area?: string | "*",
  required_capability?: string,
}) -> Task | null
```
Use `assign_task` when the manager chooses the worker. Use
`claim_best_task` when a worker asks for its next best task. Use
`allow_pending_agent` to reserve work before a worker registers.

### delegate
```ts
delegate({
  from: string,
  to_agent: string,
  title: string,
  description?: string,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  priority?: number,
  cwd?: string,
  thread_id?: string,
  project?: string | null,
  area?: string | null,
  team?: string | null,
  required_capability?: string | null,
  deadline_at?: number | null,
  checkin_at?: number | null,
  edit_scope?: string[],
  read_scope?: string[],
  file_scope?: string[],
  ack_required?: boolean,
  review_required?: boolean,
  allow_pending_agent?: boolean,
  allow_conflicts?: boolean,
}) -> { task: Task, event: TaskEvent, assigned: boolean, pending: boolean, suggested_next_actions: string[] }
```
Use `delegate` as the default long-work primitive. It creates the task,
assigns it, sends the inbox notification, requires acknowledgement by
default, and records the delegation event.

### update_task / release_task / list_tasks / get_task
```ts
update_task({
  agent: string,
  task_id: number,
  state?: "open" | "claimed" | "working" | "blocked" | "completed" | "failed" | "canceled",
  blocked_reason?: string | null,
  blocked_on_task_id?: number | null,
  result?: string | null,
  priority?: number,
  required_capability?: string | null,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string | null,
  deadline_at?: string | null,
  checkin_at?: string | null,
  final_answer?: string | null,
  manager_reviewed?: boolean,
  edit_scope?: string[],
  read_scope?: string[],
  file_scope?: string[],
  ack_required?: boolean,
  review_required?: boolean,
  review_state?: "none" | "pending" | "approved" | "changes_requested",
  reviewed_by?: string | null,
  review_notes?: string | null,
  changed_files?: string[],
  allow_conflicts?: boolean,
}) -> Task

release_task({ agent: string, task_id: number }) -> Task

list_tasks({
  state?: TaskState | TaskState[],
  claimed_by?: string,
  requested_by?: string,
  thread_id?: string,
  include_terminal?: boolean,
  limit?: number,
  project?: string | "*",
  area?: string | "*",
  team?: string | "*",
  required_capability?: string,
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  manager_reviewed?: boolean,
}) -> Task[]

get_task({ task_id: number }) -> Task
```
Terminal states cannot transition. Only requester or current holder can
update/release. Stale active tasks are surfaced, not auto-requeued.

### acknowledge_task / submit_review / handoff_task
```ts
acknowledge_task({
  agent: string,
  task_id: number,
  response: "claimed" | "declined" | "blocked",
  note?: string,
}) -> Task

submit_review({
  reviewer: string,
  task_id: number,
  approved: boolean,
  notes?: string,
}) -> Task

handoff_task({
  from_agent: string,
  task_id: number,
  to_agent?: string,
  reason: string,
  memory?: string,
}) -> { task: Task, memory: Memory, message: Message | null }
```
Use acknowledgements to remove uncertainty after assignment. Use
`submit_review` for verifier approval; review-required tasks cannot be
completed until approved. Use `handoff_task` when a session stops
mid-task; it records a pinned handoff memory and can reassign the work.

### check_scope_conflicts / project_board
```ts
check_scope_conflicts({
  file_scope?: string[],
  edit_scope?: string[],
  project?: string | "*",
  area?: string | "*",
  team?: string | "*",
  exclude_task_id?: number,
}) -> ScopeConflict[]

project_board({
  project?: string | "*",
  area?: string | "*",
  team?: string | "*",
}) -> {
  agents: AgentDirectoryEntry[],
  open_tasks: Task[],
  active_tasks: Task[],
  blocked_tasks: Task[],
  waiting_review: Task[],
  waiting_acknowledgement: Task[],
  stale_tasks: Task[],
  scope_conflicts: ScopeConflict[],
  pinned_risks: Memory[],
  pinned_handoffs: Memory[],
  suggested_next_actions: string[],
}
```
Use `project_board` for manager status. It combines agent status, task
state, review queue, pending acknowledgements, stale work, scope
conflicts, pinned risks/handoffs, and suggested next actions. Scope
conflicts compare edit ownership; broad verifier read scope should not
block workers.

## Decisions and Final Report

```ts
record_decision({
  by_agent: string,
  decision: string,
  rationale?: string,
  implemented?: boolean,
  project?: string | null,
  area?: string | null,
}) -> Decision

list_decisions({ project?: string | "*", area?: string | "*", limit?: number }) -> Decision[]

record_test_result({
  by_agent: string,
  task_id?: number | null,
  command: string,
  status: "passed" | "failed" | "skipped",
  output_summary?: string | null,
  project?: string | null,
  area?: string | null,
}) -> TestResult

list_test_results({
  task_id?: number,
  by_agent?: string,
  status?: "passed" | "failed" | "skipped",
  project?: string | "*",
  area?: string | "*",
  limit?: number,
}) -> TestResult[]

record_task_event({
  by_agent: string,
  task_id: number,
  event_type?: "note" | "phase" | "progress" | "log" | "result" | "cancel",
  message: string,
  phase?: string | null,
  metadata?: Record<string, unknown>,
}) -> TaskEvent

list_task_events({
  task_id?: number,
  by_agent?: string,
  event_type?: "note" | "phase" | "progress" | "log" | "result" | "cancel",
  project?: string | "*",
  area?: string | "*",
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
  wait_s?: number,
  since_updated_at?: number,
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
  agent: string,
  task_id: number,
  reason?: string | null,
}) -> { task: Task, event: TaskEvent }

remember({
  by_agent: string,
  kind: "summary" | "handoff" | "risk" | "todo" | "fact" | "blocker" | "lesson" | "gotcha" | string,
  content: string,
  agent?: string | null,
  project?: string | null,
  area?: string | null,
  task_id?: number | null,
  thread_id?: string | null,
  pinned?: boolean,
  supersedes_id?: number | null,
}) -> Memory

list_memories({
  project?: string | "*",
  area?: string | "*",
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
  project?: string | "*",
  area?: string | "*",
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

final_report({ project?: string | "*", area?: string | "*" }) -> {
  implemented: string[],
  not_implemented: string[],
  known_risks: string[],
  tests_passed: string[],
  test_results: TestResult[],
  manual_tests_needed: string[],
  safe_to_commit: boolean,
  safe_to_push: boolean,
  safe_to_deploy: boolean,
}

review_gate({ project?: string | "*", area?: string | "*" }) -> {
  ok: boolean,
  blockers: string[],
  warnings: string[],
  final_report: FinalReport,
  board: ProjectBoard,
}
```

## Error codes summary

| Code | Recovery hint |
|---|---|
| `INVALID_INPUT` | Fix name/channel/project/area format or invalid enum |
| `UNKNOWN_AGENT` | Use `directory`/`whois`; register a helper or broaden scope |
| `NAME_TAKEN` | Use `replace: true` intentionally or pick a new name |
| `ASK_TIMEOUT` | Switch to `send`, increase readiness, or nudge the recipient |
| `ASK_CYCLE` | Resolve the other side's pending ask first |
| `ASK_NOT_FOUND` | Check the id; the ask may already be answered |
| `TASK_NOT_FOUND` | Verify with `list_tasks` |
| `TASK_NOT_CLAIMABLE` | Task is already claimed or not open |
| `TASK_INVALID_TRANSITION` | Check current task state and allowed transitions |
| `TASK_FORBIDDEN` | Only requester or current holder can update/release |
