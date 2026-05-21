# agent-bus MCP tools — quick reference

Load this when you need the exact contract for a tool the SKILL.md
doesn't cover in detail. There are 39 MCP tools. All return JSON.
Errors return `{ error: { code: string, message: string } }` with
`isError: true`.

Use project/area defaults unless the user asks for a broader view.
`project: "*"` means all projects. `area: "*"` means all areas.

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
  role?: string | null,
  routing_weight?: number,
  status?: "idle" | "working" | "blocked" | "waiting_review" | "sleeping",
}) -> Agent
```

### whois / directory
```ts
whois({ project?: string | "*", area?: string | "*" }) -> Agent[]
directory({ project?: string | "*", area?: string | "*" }) -> AgentDirectoryEntry[]
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

### inbox / ack
```ts
inbox({
  agent: string,
  wait_s?: number,       // max 110
  claim_s?: number,      // at-least-once mode; ack after processing
  since_id?: number,
  mark_delivered?: boolean,
  limit?: number,
}) -> Message[]

ack({ agent: string, message_id: number }) -> Message
```
Use `wait_s: 110` for listener loops. Use `claim_s` for work that must
not be lost; skipped ack means redelivery after the claim expires.

## Request / Response

### ask / ask_best / reply
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
  role?: string,
  priority?: "low" | "normal" | "high" | "urgent",
}) -> Message

reply({ from: string, ask_id: number, answer: string }) -> Message
```
`ask_best` defaults to the caller's project/area and refuses stale
agents. Use wildcards only for deliberate cross-project/cross-area work.

## Channels

```ts
subscribe({ agent: string, channel: string }) -> Subscription
unsubscribe({ agent: string, channel: string }) -> { ok: true }
send_channel({ from: string, channel: string, message: string, thread_id?: string }) -> Message[]
subscribers({ channel: string }) -> string[]
```

## Discovery

```ts
thread({ thread_id: string, limit?: number }) -> Message[]
recent({ limit?: number, project?: string | "*", area?: string | "*" }) -> Message[]
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
  mode?: "investigate_only" | "propose_patch" | "edit_files" | "test_only",
  expected_output?: string,
  deadline_at?: string,
  checkin_at?: string,
  file_scope?: string[],
  ack_required?: boolean,
  review_required?: boolean,
  changed_files?: string[],
  allow_conflicts?: boolean,
}) -> Task
```

### claim_task / assign_task / claim_best_task
```ts
claim_task({ agent: string, task_id: number, allow_conflicts?: boolean }) -> Task
assign_task({ task_id: number, to_agent: string, allow_conflicts?: boolean }) -> Task
claim_best_task({
  agent: string,
  project?: string | "*",
  area?: string | "*",
  required_capability?: string,
}) -> Task | null
```
Use `assign_task` when the manager chooses the worker. Use
`claim_best_task` when a worker asks for its next best task.

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
  file_scope: string[],
  project?: string | "*",
  area?: string | "*",
  exclude_task_id?: number,
}) -> ScopeConflict[]

project_board({
  project?: string | "*",
  area?: string | "*",
}) -> {
  agents: AgentDirectoryEntry[],
  open_tasks: Task[],
  active_tasks: Task[],
  blocked_tasks: Task[],
  waiting_review: Task[],
  stale_tasks: Task[],
  scope_conflicts: ScopeConflict[],
  pinned_risks: Memory[],
  pinned_handoffs: Memory[],
  suggested_next_actions: string[],
}
```
Use `project_board` for manager status. It combines agent status, task
state, review queue, stale work, scope conflicts, pinned risks/handoffs,
and suggested next actions.

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
  manual_tests_needed: string[],
  safe_to_commit: boolean,
  safe_to_push: boolean,
  safe_to_deploy: boolean,
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
