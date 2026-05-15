# agent-bus MCP tools — quick reference

Load this when you need the exact contract for a tool the SKILL.md
doesn't cover in detail. All 20 tools, their inputs, returns, and
error codes.

Every error response is `{ error: { code: string, message: string } }`
with `isError: true`.

## Identity

### register
Claim a name on the bus. Idempotent with `replace: true`.
```
register({
  name: string,                // 1-64 chars, [a-zA-Z0-9_.-]
  capabilities?: string[],     // tags for ask_best routing
  replace?: boolean,
  project?: string | null,     // MCP auto-derives from cwd if omitted
}) -> Agent
```
Errors: `INVALID_INPUT`, `NAME_TAKEN`.

### whois
List registered agents (optionally scoped to project).
```
whois({ project?: string | "*" }) -> Agent[]
```

## Direct messaging

### send
Fire-and-forget direct message. Returns immediately.
```
send({
  from: string,
  to: string,
  message: string,
  thread_id?: string,
}) -> Message
```
Errors: `INVALID_INPUT`, `UNKNOWN_AGENT`.

### inbox
Read pending messages addressed to caller.
```
inbox({
  agent: string,
  wait_s?: number,       // block up to N seconds (max 110)
  claim_s?: number,      // at-least-once mode: keep pending until ack
  since_id?: number,
  mark_delivered?: boolean,
  limit?: number,
}) -> Message[]
```
Errors: `INVALID_INPUT`, `UNKNOWN_AGENT`.

### ack
Acknowledge a claimed message (used with `inbox(claim_s)`).
```
ack({ agent: string, message_id: number }) -> Message
```
Errors: `ASK_NOT_FOUND`, `INVALID_INPUT`.

## Request / response

### ask
Send a question, BLOCK until reply (max 110s).
```
ask({
  from: string,
  to: string,
  question: string,
  timeout_s?: number,
  thread_id?: string,
}) -> Message            // the reply
```
Errors: `INVALID_INPUT`, `UNKNOWN_AGENT`, `ASK_CYCLE`, `ASK_TIMEOUT`.

### ask_best
Route an ask to the best capability match. Defaults to caller's
project; pass `project: "*"` for global.
```
ask_best({
  from: string,
  capability: string,
  question: string,
  timeout_s?: number,
  thread_id?: string,
  project?: string,
}) -> Message
```
Errors: `UNKNOWN_AGENT` (no match, with hint), plus all `ask` errors.

### reply
Answer a pending ask. Inherits thread_id.
```
reply({
  from: string,          // must equal ask's to_agent
  ask_id: number,
  answer: string,
}) -> Message
```
Errors: `ASK_NOT_FOUND`, `INVALID_INPUT`.

## Channels (1-to-many)

### subscribe / unsubscribe
```
subscribe({ agent: string, channel: string }) -> Subscription
unsubscribe({ agent: string, channel: string }) -> { ok: true }
```

### send_channel
Fan out to every subscriber. Sender excluded.
```
send_channel({
  from: string,
  channel: string,
  message: string,
  thread_id?: string,
}) -> Message[]
```

### subscribers
```
subscribers({ channel: string }) -> string[]
```

## Discovery

### thread
Every message in a conversation, in order.
```
thread({ thread_id: string, limit?: number }) -> Message[]
```

### recent
Recent traffic regardless of recipient.
```
recent({ limit?: number, project?: string }) -> Message[]
```

## Tasks

### create_task
```
create_task({
  requested_by: string,
  title: string,                  // 1-200 chars
  description?: string,
  thread_id?: string,
  priority?: number,
  cwd?: string,
  blocked_on_task_id?: number,
  project?: string | null,        // MCP auto-derives if omitted
}) -> Task
```

### claim_task
Atomically claim an open task. Concurrent losers get `TASK_NOT_CLAIMABLE`.
```
claim_task({ agent: string, task_id: number }) -> Task
```

### update_task
Move state or update metadata. Strict transitions:
`open → claimed | canceled`,
`claimed → working | open | canceled | failed`,
`working → blocked | completed | failed | canceled`,
`blocked → working | completed | failed | canceled`.
Terminal states (`completed`, `failed`, `canceled`) don't transition.
```
update_task({
  agent: string,
  task_id: number,
  state?: TaskState,
  blocked_reason?: string | null,
  blocked_on_task_id?: number | null,
  result?: string | null,
  priority?: number,
}) -> Task
```
Errors: `TASK_NOT_FOUND`, `TASK_INVALID_TRANSITION`, `TASK_FORBIDDEN`.

### release_task
Return a non-terminal task to open.
```
release_task({ agent: string, task_id: number }) -> Task
```

### list_tasks
Scoped to caller's project by default; `project: "*"` for global.
Includes `stale: true` when active task's holder is idle.
```
list_tasks({
  state?: TaskState | TaskState[],
  claimed_by?: string,
  requested_by?: string,
  thread_id?: string,
  include_terminal?: boolean,
  limit?: number,
  project?: string,
}) -> Task[]
```

### get_task
```
get_task({ task_id: number }) -> Task
```

## Error codes summary

| Code | When | Recovery hint |
|---|---|---|
| `INVALID_INPUT` | Validation failed | Fix the input — check name/channel regex, project format |
| `UNKNOWN_AGENT` | Recipient not registered, or `ask_best` no match | `whois` to see who's around; suggest registering or `project: "*"` |
| `NAME_TAKEN` | Name held by active session | `replace: true` or pick a different name |
| `ASK_TIMEOUT` | No reply in timeout window | Use `send` instead, or have user nudge the recipient |
| `ASK_CYCLE` | Mutual ask deadlock | Resolve the other side first |
| `ASK_NOT_FOUND` | Bad ask_id or message_id | Check the id; the ask may have been answered already |
| `TASK_NOT_FOUND` | Bad task_id or blocked_on_task_id | Verify the id with `list_tasks` |
| `TASK_NOT_CLAIMABLE` | Task already claimed | `get_task` to see current holder |
| `TASK_INVALID_TRANSITION` | Not in allowed transitions | Check current state and the transition map above |
| `TASK_FORBIDDEN` | Only holder/requester can do this | Different agent needs to perform the action |
