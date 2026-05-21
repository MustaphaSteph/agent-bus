# Architecture

How the bus actually works, what's in the database, where the limits
come from.

## One picture

```
┌──────────────────┐                  ┌──────────────────┐                  ┌──────────────────┐
│ Claude Code A    │  send / inbox /  │ ~/.agent-bus/    │  send / inbox /  │ Codex Desktop B  │
│ (any project)    │  ask / reply  ──▶│   bus.db         │ ◀─── ask / reply │ (any chat)       │
│ MCP: agent-bus   │                  │  (SQLite WAL)    │                  │ MCP: agent-bus   │
└──────────────────┘                  └────────┬─────────┘                  └──────────────────┘
                                               │
                                               ▼
                                      ┌──────────────────┐
                                      │ agent-bus watch  │  ← you
                                      └──────────────────┘
```

Each session spawns its own MCP server process (stdio child). Each MCP
process opens its own SQLite connection. They share state through the
single `bus.db` file, in WAL mode.

The MCP process also derives one project slug from its cwd at startup.
Register, discovery, recent traffic, capability routing, and task
creation use that slug by default. Passing `project: "*"` opts into a
global view.

## Process model

When you launch a Claude Code session, Claude spawns one
`agent-bus-mcp` process via stdio. That process:

1. Opens `bus.db`, enables WAL + foreign keys, runs idempotent
   migrations.
2. Listens for JSON-RPC requests on stdin.
3. Executes tool calls synchronously (or async for `inbox(wait_s)` and
   `ask`).
4. Writes results to stdout.

Multiple processes (multiple Claude/Codex sessions) all read and write
the same SQLite file concurrently. WAL mode handles it:
multiple-readers + one writer, writers serialize behind a short lock.

For local agent traffic (<100 ops/sec), there's no contention.

## Schema

Created in `src/db.ts` with idempotent migrations (column existence
checks before `ALTER TABLE`).

### `agents`

| Column | Type | Notes |
|---|---|---|
| `name` | TEXT PK | 1-64 chars, `[a-zA-Z0-9_.-]` |
| `capabilities` | TEXT | JSON array of strings |
| `registered_at` | INTEGER | ms epoch |
| `last_seen` | INTEGER | updated on every send/inbox/register |
| `paused` | INTEGER | 0 or 1 |
| `project` | TEXT nullable | repo-derived scope; null means legacy/global |
| `area` | TEXT nullable | path-derived lane; null means no area |
| `role` | TEXT nullable | pm / worker / verifier / reviewer / listener / custom |
| `routing_weight` | INTEGER | higher preferred by `ask_best` |
| `status` | TEXT | idle / working / blocked / waiting_review / sleeping |

Indexes on `project`, `area`, and `role`.

### `messages`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTO | insertion order |
| `from_agent` | TEXT | |
| `to_agent` | TEXT | |
| `kind` | TEXT | `msg` / `ask` / `reply` |
| `content` | TEXT | no size cap on the bus side |
| `reply_to` | INTEGER nullable | FK → `messages.id` for replies |
| `status` | TEXT | `pending` / `delivered` / `answered` |
| `created_at` | INTEGER | ms epoch |
| `delivered_at` | INTEGER nullable | when inbox/ack flipped it |
| `replied_at` | INTEGER nullable | when reply closed an ask |
| `thread_id` | TEXT | conversation grouping |
| `claim_deadline` | INTEGER nullable | at-least-once claim expiry |
| `claimed_by` | TEXT nullable | who claimed it |
| `channel` | TEXT nullable | set for fan-outs from `send_channel` |
| `project` | TEXT nullable | copied from sender agent at insert time |
| `area` | TEXT nullable | copied from sender agent at insert time |
| `priority` | TEXT | `low` / `normal` / `high` / `urgent` |

Indexes:
- `(to_agent, status, id)` — drives the inbox query
- `reply_to`
- `thread_id`
- `claim_deadline`
- `project`
- `area`
- `priority`

### `tasks`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTO | insertion order |
| `title` | TEXT | 1-200 chars |
| `description` | TEXT nullable | work detail |
| `thread_id` | TEXT | task discussion thread |
| `requested_by` | TEXT | FK → `agents.name` |
| `claimed_by` | TEXT nullable | current holder |
| `state` | TEXT | `open` / `claimed` / `working` / `blocked` / `completed` / `failed` / `canceled` |
| `priority` | INTEGER | higher sorts first |
| `cwd` | TEXT nullable | target working directory |
| `blocked_reason` | TEXT nullable | holder-supplied reason |
| `blocked_on_task_id` | INTEGER nullable | soft task dependency |
| `result` | TEXT nullable | terminal summary |
| `created_at` | INTEGER | ms epoch |
| `updated_at` | INTEGER | ms epoch |
| `claimed_at` | INTEGER nullable | when holder claimed |
| `finished_at` | INTEGER nullable | when task became terminal |
| `project` | TEXT nullable | requester project unless supplied explicitly |
| `area` | TEXT nullable | requester area unless supplied explicitly |
| `required_capability` | TEXT nullable | claimant must have this capability |
| `mode` | TEXT | investigate_only / propose_patch / edit_files / test_only |
| `expected_output` | TEXT nullable | manager checklist expectation |
| `deadline_at` | INTEGER nullable | ms epoch |
| `checkin_at` | INTEGER nullable | ms epoch |
| `final_answer` | TEXT nullable | final agent output |
| `manager_reviewed` | INTEGER | 0 or 1 |
| `file_scope` | TEXT | JSON array of owned path patterns |
| `ack_required` | INTEGER | 0 or 1 |
| `acknowledged_at` | INTEGER nullable | ms epoch |
| `acknowledged_by` | TEXT nullable | agent that acknowledged assignment |
| `review_required` | INTEGER | 0 or 1 |
| `review_state` | TEXT | none / pending / approved / changes_requested |
| `reviewed_by` | TEXT nullable | verifier/reviewer agent |
| `review_notes` | TEXT nullable | review result notes |
| `changed_files` | TEXT | JSON array of changed paths |

Indexes include `state`, `claimed_by`, `requested_by`, `thread_id`,
`updated_at`, and `project`.

### `decisions`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTO | insertion order |
| `by_agent` | TEXT | FK -> `agents.name` |
| `decision` | TEXT | what was decided |
| `rationale` | TEXT nullable | why |
| `implemented` | INTEGER | 0 or 1 |
| `project` | TEXT nullable | scope |
| `area` | TEXT nullable | scope |
| `created_at`, `updated_at` | INTEGER | ms epoch |

### `memories`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTO | insertion order |
| `by_agent` | TEXT | FK -> `agents.name` |
| `agent` | TEXT nullable | optional subject/target agent |
| `kind` | TEXT | summary / handoff / risk / todo / fact / blocker / custom |
| `content` | TEXT | memory body |
| `project` | TEXT nullable | scope |
| `area` | TEXT nullable | scope |
| `task_id` | INTEGER nullable | FK -> `tasks.id` ON DELETE SET NULL |
| `thread_id` | TEXT nullable | related conversation thread |
| `pinned` | INTEGER | 0 or 1; pinned memories surface in session briefs |
| `supersedes_id` | INTEGER nullable | FK -> older `memories.id` ON DELETE SET NULL |
| `created_at`, `updated_at` | INTEGER | ms epoch |

### `subscriptions`

| Column | Type | Notes |
|---|---|---|
| `channel` | TEXT | part of PK |
| `agent` | TEXT | part of PK, FK → `agents.name` ON DELETE CASCADE |
| `subscribed_at` | INTEGER | ms epoch |

Index on `(channel)`.

## The inbox query

The hottest read path. Returns pending messages for an agent that
aren't currently claimed by someone else.

```sql
SELECT * FROM messages
  WHERE to_agent = ?
    AND id > ?
    AND status = 'pending'
    AND (claim_deadline IS NULL OR claim_deadline < ?)   -- now
  ORDER BY id ASC
  LIMIT ?
```

The `(to_agent, status, id)` index makes this index-only-scan friendly
even with millions of rows.

After returning rows:

- If `claim_s` was passed: update the rows' `claim_deadline` to
  `now + claim_s*1000` and `claimed_by = agent`. Status stays `pending`.
- Else if `mark_delivered != false`: update status to `delivered` and
  set `delivered_at`.

## How blocking works

`inbox(wait_s)` is the only blocking tool that doesn't sit waiting for
an explicit reply (`ask` waits for `reply_to`). The implementation:

```ts
const immediate = readInbox(opts)
if (immediate.length > 0 || !opts.wait_s) return immediate

const deadline = now() + waitMs
while (now() < deadline) {
  await sleep(POLL_INTERVAL_MS)        // default 50 ms
  heartbeat(opts.agent)
  const fresh = readInbox(opts)
  if (fresh.length > 0) return fresh
}
return []
```

Worst-case message-detection latency = `POLL_INTERVAL_MS`. Tunable via
the `AGENT_BUS_POLL_MS` environment variable, floor is 5 ms.

## How `ask` works

`ask` is `send` + a polling wait for the corresponding `reply`:

```ts
const asked = send({ kind: "ask", ... })
while (now() < deadline) {
  const reply = db.get(
    "SELECT * FROM messages WHERE reply_to = ? AND kind = 'reply'",
    asked.id
  )
  if (reply) return reply
  await sleep(POLL_INTERVAL_MS)
}
throw new BusError("ASK_TIMEOUT", ...)
```

When the answerer calls `reply()`, it inserts a `reply` row pointing at
the original ask AND flips the ask's status to `answered`.

Cycle guard: before sending an `ask`, check if the recipient already has
a pending `ask` back to the asker. If so, reject with `ASK_CYCLE`.

## How channels work

`send_channel(channel, message)` does:

1. Read subscribers from the `subscriptions` table.
2. Generate one `thread_id` for the whole fan-out.
3. Insert one `messages` row per subscriber (sender excluded), each with
   the same content, the same `thread_id`, and `channel = <name>`.

Subscribers see these rows in their normal `inbox` call. They look like
ordinary `msg` rows; the only difference is `m.channel` is set.

This means broadcast scales linearly in storage with subscriber count.
For local agent collaboration (rarely more than 10 agents), this is
fine. For thousands of subscribers, you'd want a different model.

## Listener resilience

Three layers keep a Claude Code listener alive:

1. **In-loop wait** — `/listen` uses `inbox(wait_s=110)`. While Claude is
   in that tool call, it's effectively listening.
2. **Stop hook (basic)** — at every Claude turn-end, `agent-bus poll-inbox`
   runs and emits `{decision:"block"}` if there are pending messages.
   Claude treats the block reason as a new prompt and processes them.
3. **Stop hook (listener-mode)** — if `/listen <name>` was invoked, it
   writes a marker at `~/.agent-bus/listeners/<session>.json`. The Stop
   hook reads it and, if the session is in listener mode, blocks with a
   "keep listening" prompt even when the inbox is empty — so Claude
   immediately re-enters the inbox loop.

The marker is keyed by Claude Code's `$CLAUDE_SESSION_ID`, which the
hook receives as an environment variable.

## What the bus can't do

- **Push into a non-listening session.** If a session isn't in
  `inbox(wait_s)` and doesn't have the Stop hook installed, the only
  way messages reach it is when the user prompts the agent (which calls
  inbox).
- **Mid-tool-call interrupt.** Once Claude is inside a tool call (e.g.
  `Bash("npm test")`), the bus has no way to wake it up. PreToolUse
  hooks could approximate this between tool calls, but that's not
  implemented.
- **Cross-machine.** One SQLite file, one filesystem. To bridge two
  machines you'd need a relay process. Out of scope for v1.
- **Authentication / authorization.** Anyone with shell access can write
  to your `bus.db`. Single-user assumption.

## Tunables

| Env var | Default | Effect |
|---|---|---|
| `AGENT_BUS_DIR` | `~/.agent-bus` | Where `bus.db` and listener markers live |
| `AGENT_BUS_POLL_MS` | `50` (floor 5) | SQLite poll interval during `inbox(wait_s)` and `ask` waits |

Hard limits in code (not env-tunable):

| Constant | Value | Why |
|---|---|---|
| `MAX_ASK_TIMEOUT_S` | 110 | Claude Code tool-call timeout |
| `MAX_INBOX_WAIT_S` | 110 | Same |
| `validateName` regex | `[a-zA-Z0-9_.-]+` 1-64 chars | Filesystem-safe and shell-safe |
| `validateChannel` regex | `[a-zA-Z0-9_.:#-]+` 1-64 chars | Slightly looser to allow `team:frontend` style |

Change these only if you know what breaks.
