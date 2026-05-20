# Agent Context

This file is for AI coding agents (and humans) editing the `agent-bus` source.
For end-users of the bus, see [`README.md`](README.md), [`docs/`](docs/), or
[`llms.txt`](llms.txt).

## Project Purpose

`agent-bus` is a tiny local message bus for Claude Code, Codex, and other
MCP-capable agents on the same machine. It uses one SQLite database
(`~/.agent-bus/bus.db` by default), exposes an MCP stdio server with 28
tools, and ships a CLI for watching, injecting, registering, pausing,
resuming, sleeping/waking agents, hook installation, and listener-prompt
generation.

The core product promise is local, persistent, tool-agnostic
agent-to-agent messaging without a daemon or cloud service.

## Architecture

- `src/bus.ts` is the domain layer. Owns: agent registration, heartbeat,
  inbox delivery (with optional blocking and at-least-once claim/ack),
  ask/reply flow, channels (subscribe/unsubscribe/send_channel),
  capability/role routing (ask_best), threads, pause/resume,
  recent-message reads, thread reads, directory reads, and task lifecycle
  operations.
- `src/db.ts` owns the `better-sqlite3` connection, WAL pragmas, and
  idempotent migrations (including column existence checks before ALTERs).
- `src/mcp/server.ts` is the MCP stdio adapter. Keep input validation
  with `zod`, dispatch into `src/bus.ts`, and return JSON-text tool
  results. Errors return `{ error: { code, message } }` with `isError`.
- `src/cli/index.ts` wires Commander commands to bus operations and CLI
  helpers.
- `src/cli/watch.ts`, `format.ts`, `poll-inbox.ts`, `install-hook.ts`,
  `listen-prompt.ts`, and `listener-marker.ts` are CLI-specific helpers.
- `src/util/paths.ts` resolves `AGENT_BUS_DIR`; `errors.ts` defines
  `BusError`; `project.ts` derives repo-scoped project/area names;
  `time.ts` wraps time and sleep.
- `test/smoke.ts` exercises in-process bus behavior with a temporary
  `AGENT_BUS_DIR`.
- `test/cross-process.ts` verifies concurrent CLI writes from separate
  processes.

## Data Model

Schema created in `src/db.ts`.

### `agents`

`name` PK, JSON `capabilities`, `registered_at`, `last_seen`, `paused`,
nullable `project`, nullable `area`, nullable `role`, integer
`routing_weight`, work `status` (`idle`/`working`/`blocked`/
`waiting_review`/`sleeping`). Agent names remain globally unique;
`project` and `area` are filter attributes, not part of identity.

### `messages`

`id` PK auto, `from_agent`, `to_agent`, `kind` (`msg`/`ask`/`reply`),
`content` (no size cap), `reply_to` FK, `status`
(`pending`/`delivered`/`answered`), timestamps, `thread_id`,
`claim_deadline`, `claimed_by`, `channel`, nullable `project` and `area`
copied from the sender agent, `priority`.

Indexes: `(to_agent, status, id)`, `reply_to`, `thread_id`,
`claim_deadline`.

### `subscriptions`

`(channel, agent)` PK, `subscribed_at`. `agent` is FK ON DELETE CASCADE.

### `tasks`

`id` PK auto, `title`, `description`, `thread_id`, `requested_by`,
`claimed_by`, `state` (`open`/`claimed`/`working`/`blocked`/
`completed`/`failed`/`canceled`), `priority`, `cwd`, blocker metadata,
`required_capability`, task `mode`, manager checklist fields, JSON
`file_scope`, `result`, timestamps, `finished_at`, nullable `project`,
nullable `area`.

### `decisions`

`id` PK auto, `by_agent`, `decision`, optional `rationale`,
`implemented`, nullable `project`, nullable `area`, timestamps.

### Semantics

- `inbox()` returns rows with `status='pending'` AND
  `(claim_deadline IS NULL OR claim_deadline < now)`.
- Without `claim_s` it flips them to `delivered`. With `claim_s` it sets
  `claim_deadline = now + claim_s*1000` and `claimed_by`, leaving
  status `pending`.
- `ack()` flips claimed `pending` to `delivered`, clears the claim.
- `ask()` creates an `ask` row, polls for a `reply` row pointed at it
  via `reply_to`, with cycle detection.
- `reply()` creates a `reply` row inheriting the ask's `thread_id` and
  marks the ask `answered`.
- `send_channel()` reads subscribers, generates one shared `thread_id`,
  inserts one row per recipient with `channel = <name>`.
- `ask_best()` matches by capability and optional role, prefers
  `routing_weight` then most recent `last_seen`, scopes to the asker's
  project/area by default, and refuses matches >5 minutes stale. Concrete
  areas are strict; use `area: "*"` for a manager or cross-area search.
- Tasks are first-class work records. `claimTask()` is atomic; updates
  follow `ALLOWED_TRANSITIONS`; stale active tasks are surfaced by
  comparing the holder's `last_seen` with `AGENT_BUS_TASK_STALE_MS`.
  `assignTask()` directly claims an open task for an agent, and
  `claimBestTask()` chooses the highest-priority open task matching the
  agent's scope and capabilities.
- Agent status is separate from pause/resume delivery. Sleeping agents
  can still receive queued messages; status is for the manager board.
- Decisions are durable project memory and final reports are generated
  from task state/checklist fields.
- Project/area scoping is soft. MCP sessions and CLI read commands
  derive a project from cwd and area from `.agent-bus.json`; direct
  addressed messaging remains cross-project/cross-area. Use
  `PROJECT_WILDCARD` / `AREA_WILDCARD` (`"*"`) for global reads/routing.

## Commands

- `npm install`
- `npm run build` (emits `dist/`)
- `npm run typecheck`
- `npm test` (smoke)
- `npx tsx test/task-flow.ts`
- `npx tsx test/cross-process.ts`
- `npm run dev:mcp` (run MCP from source)
- `npm run dev:cli -- <command>`

Node `>=20`, ESM (`"type": "module"`).

## Coding Guidelines

- Keep business behavior in `src/bus.ts`. MCP and CLI files are thin
  adapters.
- Preserve strict TypeScript, especially `noUncheckedIndexedAccess`.
- Use `BusError` with a specific code (`BusErrorCode` in
  `src/util/errors.ts`) for expected user-facing failures.
- Validate public inputs at the boundary: MCP uses `zod`; bus functions
  validate names/channels with regex helpers.
- Use parameterized SQLite statements through `better-sqlite3`. No
  string concatenation into SQL.
- Keep all persistent paths behind `AGENT_BUS_DIR`/`busDir()` so tests
  can isolate state.
- Avoid network dependencies. The project must work offline.
- Use ASCII in source/docs unless a file already uses a specific
  Unicode convention.
- When adding a tool: bus function in `src/bus.ts`, Zod schema and
  dispatch case in `src/mcp/server.ts`, test in `test/smoke.ts`, entry
  in `docs/tools.md` and `llms.txt`.

## Behavioral Constraints

- Agent names: 1-64 chars, `[a-zA-Z0-9_.-]+`.
- Channel names: 1-64 chars, `[a-zA-Z0-9_.:#-]+`.
- `inbox(wait_s)` and `ask(timeout_s)` capped at 110 s
  (`MAX_INBOX_WAIT_S` / `MAX_ASK_TIMEOUT_S`) to fit Claude Code tool
  timeouts.
- `ask()` rejects direct mutual cycles (`ASK_CYCLE`).
- Paused agents return empty `inbox`; messages keep queuing.
- SQLite WAL + synchronous NORMAL are intentional for concurrent local
  readers/writers.
- Message body has no bus-side size cap; clients impose practical
  limits (Claude Code ~1 MB per tool result).
- `claim_s` keeps rows invisible to other inbox calls until ack or
  expiry. Expiry-based redelivery is the retry mechanism.
- Task terminal states (`completed`, `failed`, `canceled`) cannot
  transition. Do not auto-requeue stale tasks; surface them for explicit
  release/reassignment.

## Testing Notes

Before finishing behavior changes:

```bash
npm run typecheck
npm test
npx tsx test/cross-process.ts
```

For DB-affecting changes, every test must isolate via a temp
`AGENT_BUS_DIR`. Do not mutate the user's real `~/.agent-bus` from
tests.

When adding new SQLite columns or tables, add a migration step in
`src/db.ts` that's idempotent (column-existence check before
`ALTER TABLE`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

## Release/Packaging Notes

`package.json` exposes two binaries:

- `agent-bus` → `dist/cli/index.js`
- `agent-bus-mcp` → `dist/mcp/server.js`

`prepublishOnly` runs the build. When changing CLI commands, MCP tools,
install instructions, storage behavior, or limits, update:

- [`README.md`](README.md)
- [`docs/tools.md`](docs/tools.md) — MCP tool reference
- [`docs/cli.md`](docs/cli.md) — CLI reference
- [`docs/patterns.md`](docs/patterns.md) — if a new tool unlocks a new pattern
- [`llms.txt`](llms.txt) — agent-consumable reference
- [`CLAUDE.md`](CLAUDE.md) — Claude Code repo context
- [`skills/agent-bus/`](skills/agent-bus/) — canonical Agent Skill

If the Agent Skill changes, sync the plugin repo:

```bash
cd /Users/air/Documents/Projects/agent-bus-plugins
npm run sync-skill
```

Update plugin manifests/docs there when tool counts, minimum CLI
versions, slash-command behavior, or install/setup behavior changes.

## Tunables

| Env var | Default | Effect |
|---|---|---|
| `AGENT_BUS_DIR` | `~/.agent-bus` | Where bus.db and listener markers live |
| `AGENT_BUS_POLL_MS` | `50` (floor 5) | SQLite poll interval inside `inbox(wait_s)` and `ask` waits |
| `AGENT_BUS_TASK_STALE_MS` | `300000` | Holder stale threshold for active tasks |
