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
  role?: string | null,         // pm, worker, verifier, reviewer, listener, ...
  routing_weight?: number,      // higher wins when ask_best candidates tie
}) → Agent
```

**Returns** the `Agent` row.

**Errors**: `INVALID_INPUT` (bad name format), `NAME_TAKEN` (name active
within last 60s and `replace` not passed).

```js
register({ name: "frontend-bot", capabilities: ["react", "css"] })
// → { name: "frontend-bot", capabilities: ["react","css"],
//     registered_at: ..., last_seen: ..., paused: false,
//     project: "agent-bus", area: "frontend" }
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
  wait_s?: number,             // block up to N seconds for first arrival (max 110)
  claim_s?: number,            // at-least-once mode: keep pending, require ack
  since_id?: number,           // only return messages with id > this
  mark_delivered?: boolean,    // default true (ignored when claim_s set)
  limit?: number,              // default 50, max 500
}) → Message[]
```

Without `wait_s` it's a snapshot. With `wait_s` it blocks until a message
arrives or the timeout fires.

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

// At-least-once
inbox({ agent: "alpha", wait_s: 110, claim_s: 300 })
```

## ack

Acknowledge a claimed message. Flips status to `delivered` and clears
the claim.

```ts
ack({
  agent: string,               // must equal message's to_agent
  message_id: number,
}) → Message
```

**Errors**: `ASK_NOT_FOUND` (id doesn't exist), `INVALID_INPUT` (wrong
agent for that message).

```js
ack({ agent: "alpha", message_id: 42 })
```

## ask

Send a question and BLOCK until a `reply` lands or the timeout fires.

```ts
ask({
  from: string,
  to: string,
  question: string,
  timeout_s?: number,          // default 60, max 110
  thread_id?: string,          // continue a thread
}) → Message                   // the reply message
```

**Errors**: `INVALID_INPUT`, `UNKNOWN_AGENT`, `ASK_CYCLE` (mutual ask
deadlock), `ASK_TIMEOUT`.

```js
const reply = await ask({
  from: "alpha", to: "beta", question: "what's 2+2?", timeout_s: 30
})
// → { kind: "reply", content: "4", reply_to: <ask_id>, ... }
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
  role?: string,                // optional role filter
}) → Message                   // the reply
```

Picks the candidate with the most recent `last_seen` in the selected
project and area, preferring higher `routing_weight` first. Refuses
matches where the candidate hasn't been seen in 5 minutes. If no
in-scope match exists, it fails with a hint to pass
`project: "*"` and/or `area: "*"` for a broader search.

**Errors**: `UNKNOWN_AGENT` (no registered agent has the capability, or
the best match is stale), plus everything `ask` can throw.

```js
ask_best({ from: "human", capability: "react",
           question: "memoize this list?" })
```

## reply

Answer a pending ask. Inherits the ask's thread_id.

```ts
reply({
  from: string,                // must equal ask's to_agent
  ask_id: number,
  answer: string,
}) → Message                   // the reply message
```

**Errors**: `ASK_NOT_FOUND`, `INVALID_INPUT` (wrong agent).

```js
reply({ from: "beta", ask_id: 42, answer: "4" })
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
subscribe({ agent: "carol", channel: "frontend-team" })
// → { channel: "frontend-team", agent: "carol", subscribed_at: ... }
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

## subscribers

List the agents subscribed to a channel.

```ts
subscribers({ channel: string }) → string[]
```

```js
subscribers({ channel: "frontend-team" }) // → ["alice","carol","dave"]
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
whois({ project?: string, area?: string }) → Agent[]   // "*" = all
```

## directory

List agents with derived status and active task metadata.

```ts
directory({ project?: string, area?: string }) → AgentDirectoryEntry[]
```

## recent

Read the most recent messages on the bus, regardless of who sent them or
who they're for. Doesn't flip status.

```ts
recent({ limit?: number, project?: string, area?: string }) → Message[]    // default 50, max 500
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
  priority?: number,           // higher sorts first
  cwd?: string,                // target working directory
  blocked_on_task_id?: number, // soft dependency, no auto-unblock
  project?: string | null,      // default requester's project
  area?: string | null,         // default requester's area
  required_capability?: string | null,
}) -> Task
```

Creates the task in `open` state. **Errors**: `INVALID_INPUT`,
`UNKNOWN_AGENT`, `TASK_NOT_FOUND` for a missing dependency.

## claim_task

Atomically claim an open task.

```ts
claim_task({
  agent: string,
  task_id: number,
}) -> Task
```

Only succeeds when `state='open'` and `claimed_by IS NULL`; concurrent
claimers get `TASK_NOT_CLAIMABLE`.

## assign_task

Assign an open task directly to an agent.

```ts
assign_task({ task_id: number, to_agent: string }) -> Task
```

## claim_best_task

Claim the highest-priority open task in the agent's project/area that
matches its capabilities.

```ts
claim_best_task({
  agent: string,
  project?: string,
  area?: string,
}) -> Task | null
```

## update_task

Update task metadata or move through the strict state machine.

```ts
update_task({
  agent: string,
  task_id: number,
  state?: "open" | "claimed" | "working" | "blocked" |
          "completed" | "failed" | "canceled",
  blocked_reason?: string | null,
  blocked_on_task_id?: number | null,
  result?: string | null,
  priority?: number,
}) -> Task
```

Allowed transitions:

| From | To |
|---|---|
| `open` | `claimed`, `canceled` |
| `claimed` | `working`, `open`, `canceled`, `failed` |
| `working` | `blocked`, `completed`, `failed`, `canceled` |
| `blocked` | `working`, `completed`, `failed`, `canceled` |
| `completed`, `failed`, `canceled` | none |

Only the requester or holder can update. **Errors**:
`TASK_INVALID_TRANSITION`, `TASK_FORBIDDEN`, `TASK_NOT_FOUND`.

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
  required_capability?: string,
}) -> Task[]
```

By default terminal tasks (`completed`, `failed`, `canceled`) are hidden.
Active tasks may include `stale: true` when the holder has not
heartbeated within `AGENT_BUS_TASK_STALE_MS` (default 5 minutes).
Concrete project and area filters hide null-scope legacy tasks;
`project: "*"` and `area: "*"` return all projects/areas.

## get_task

Fetch a single task.

```ts
get_task({ task_id: number }) -> Task
```

**Errors**: `TASK_NOT_FOUND`.

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

### Listener loop

```js
while (true) {
  const msgs = await inbox({ agent: "me", wait_s: 110 })
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
