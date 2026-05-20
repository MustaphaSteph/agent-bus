# Concepts

The mental model in eight nouns and one verb.

## Agent

A named participant on the bus. Created with `register(name, capabilities?)`.
Persistent — survives any session restart. A name is just a string; the
session that uses it is whatever is currently calling `send`/`inbox` with
that name.

A session is not the same as an agent. An agent is a row in SQLite. A
session is a running Claude Code / Codex chat that has chosen to use a
given name.

```
register({ name: "alpha", capabilities: ["react", "css"] })
```

`capabilities` is an array of tags. They're used by `ask_best` and
capability-required tasks. `role` and `routing_weight` are optional
directory/routing hints; higher weight wins before freshness when
multiple agents match.

## Project And Area

A soft scope derived from cwd. MCP sessions default `project` by walking
up to `.git` and using the repo folder name; CLI read commands do the
same. If a repo contains `.agent-bus.json`, sessions can also derive an
`area` from path patterns such as `ios/**` or `backend/**`. Agent names
remain globally unique, so project-specific names such as
`agent-bus-verifier` are still recommended.

Project/area scoping reduces noise without isolating the bus:

- `agents.project` and `agents.area` are filter attributes. `NULL`
  agents are legacy/global for that dimension.
- `messages.project` and `messages.area` are copied from the sender at
  insert time. Scoped `recent`, `log`, and `watch` include matching
  messages plus `NULL` legacy/global messages.
- `tasks.project` and `tasks.area` are set at creation, defaulting to the
  requester agent. Scoped task lists hide `NULL` tasks for concrete
  filters; `project: "*"` / `area: "*"` broadens the view.
- `ask_best` searches the asker's project/area by default and fails
  loudly with a hint to pass `project: "*"` or `area: "*"` for broader
  routing.

Direct `send`, `ask`, and `reply` still work across projects and areas by
explicit agent name.

## Message

A row in the `messages` table. Fields you care about:

- `id`: auto-increment integer
- `from_agent`, `to_agent`: who sent it, who it's for
- `kind`: `msg`, `ask`, or `reply`
- `content`: the payload (string, no size cap)
- `priority`: `low`, `normal`, `high`, or `urgent`; inbox returns higher
  priority messages first.
- `thread_id`: the conversation it belongs to (auto-generated if you don't
  provide one)
- `project`, `area`: copied from the sender agent at insert time
- `reply_to`: for `reply` kind, points back at the `ask` id
- `channel`: for channel broadcasts, the channel name (otherwise NULL)
- `status`: `pending`, `delivered`, or `answered`
- `created_at`, `delivered_at`, `replied_at`

## Kinds and statuses

| Kind | When | Status flow |
|---|---|---|
| `msg` | Fire-and-forget direct message or channel fan-out | `pending` → `delivered` |
| `ask` | Synchronous question expecting a reply | `pending` → `delivered` → `answered` |
| `reply` | Answer to a specific `ask` | `pending` → `delivered` |

`inbox` only returns rows whose status is `pending`. Once `inbox` returns
a row, it flips to `delivered` (or `answered` after `reply` for the
original ask).

## Thread

A `thread_id` carried by every message. When you `send` without one, the
bus generates a new id (`t_<timestamp>_<rand>`). When you `reply` to an
ask, the reply inherits the ask's thread.

`thread(thread_id)` returns all messages in the thread in chronological
order — useful for reading back a multi-message exchange between two
agents.

Conversations don't have a database table of their own; the thread_id is
the glue. Lossless: drop the thread_id everywhere and you still have
working messaging, just no easy way to reconstruct chains.

## Channel

A named topic with N subscribers. Created implicitly when the first agent
subscribes. Stored in the `subscriptions` table as `(channel, agent)`
pairs.

```
subscribe({ agent: "carol", channel: "frontend-team" })
send_channel({ from: "alice", channel: "frontend-team", content: "..." })
```

`send_channel` fans out: it inserts one `messages` row per subscriber
(sender excluded). To the recipients, channel messages look like any
other `msg` in their inbox — except `m.channel` is set.

## Task

A queryable unit of work in the `tasks` table. Use tasks when you need
coordination state, not just an event. A task has a title, optional
description, thread_id, project, area, requester, optional holder, state,
priority, optional `required_capability`, cwd, blocker metadata, result,
and timestamps.

The state machine is strict:

| From | To |
|---|---|
| `open` | `claimed`, `canceled` |
| `claimed` | `working`, `open`, `canceled`, `failed` |
| `working` | `blocked`, `completed`, `failed`, `canceled` |
| `blocked` | `working`, `completed`, `failed`, `canceled` |
| `completed`, `failed`, `canceled` | none |

`claim_task` is atomic. If two agents try to claim the same open task,
one wins and the other gets `TASK_NOT_CLAIMABLE`.

`assign_task` moves an open task directly to a named agent. `claim_best_task`
lets a worker claim the highest-priority open task in its scope that
matches its capabilities.

Tasks do not auto-requeue when an agent goes stale. `list_tasks` surfaces
`stale: true` for active tasks whose holder has not heartbeated within
`AGENT_BUS_TASK_STALE_MS` (default 5 minutes). A human or orchestrator can
then release or reassign the task explicitly.

## Claim

The opt-in mechanism for at-least-once delivery.

By default `inbox` marks rows `delivered` as it returns them. If you pass
`claim_s=N`, the rows stay `pending` but get a `claim_deadline` of
`now + N seconds`. While the claim is live, the rows are invisible to
other `inbox` calls.

You then `ack(message_id)` after successfully processing each row. Ack
flips the row to `delivered` permanently.

If you crash, time out, or otherwise fail to ack, the claim expires and
the row becomes visible again to the next `inbox` call. That's the
retry mechanism.

```
inbox({ agent: "alpha", claim_s: 300 })       // claim for 5 min
// ...do work...
ack({ agent: "alpha", message_id: 42 })       // finalize
```

The trade-off is on the recipient: if you ack twice (network retry, code
bug), only the first ack matters; subsequent acks are no-ops. Idempotency
of the actual work is on you.

## Pause

`pause(agent)` and `resume(agent)` (CLI commands; no MCP tool for these)
make `inbox` return empty for a given agent while messages keep queuing.
Useful for taking an agent offline temporarily without losing messages.

## Heartbeat

Every `send`, `inbox`, and `register` updates the agent's `last_seen`
timestamp. `whois` sorts by it. `ask_best` uses it to refuse stale
matches (an agent that hasn't been seen in 5 minutes is treated as
unavailable for routing).

There is no explicit heartbeat tool. Just being active on the bus is the
heartbeat.

## The verb: dispatch

Every MCP tool call goes through one dispatch function in
`src/mcp/server.ts`. Each tool:

1. Validates input with Zod.
2. Calls a pure function in `src/bus.ts`.
3. Returns a JSON-stringified result, or a `BusError` with a code.

Error codes:

| Code | Meaning |
|---|---|
| `INVALID_INPUT` | Argument failed validation (bad name, missing field, etc.) |
| `UNKNOWN_AGENT` | Referenced an agent that isn't registered |
| `NAME_TAKEN` | Tried to register a name that's actively held (use `replace: true`) |
| `ASK_TIMEOUT` | `ask` exceeded `timeout_s` without a reply |
| `ASK_CYCLE` | `ask` would create a mutual deadlock |
| `ASK_NOT_FOUND` | Referenced an ask id that doesn't exist |
| `TASK_NOT_FOUND` | Referenced a task id that doesn't exist |
| `TASK_INVALID_TRANSITION` | Tried to move a task through an impossible state transition |
| `TASK_NOT_CLAIMABLE` | Tried to claim a task that is not open and unheld |
| `TASK_FORBIDDEN` | Tried to update or release a task without requester/holder rights |
| `INTERNAL` | Bug or unexpected exception |

## What this is NOT

- Not a full queue system. Tasks have priority and claim ownership, but
  there are no consumer groups or automatic requeue semantics.
- Not a chat protocol. Messages have no JSON schema; the bus doesn't
  parse or validate `content` beyond "must be a string".
- Not a security boundary. Anyone with shell access can write to your
  `bus.db`. Single-user, single-machine only.
- Not a distributed system. One machine, one SQLite file. No replication,
  no consensus.
