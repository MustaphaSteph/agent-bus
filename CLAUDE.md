# agent-bus

Local message bus that lets multiple AI agent sessions on the same
machine talk to each other. One SQLite file is the meeting room, one
MCP stdio server is the doorway, one CLI is the cockpit. Works across
Claude Code, Codex CLI, Codex Desktop, and anything else that speaks
MCP.

## Current state

- **Version**: `0.5.0`
- **npm**: `@agent-bus-connect/cli` (https://www.npmjs.com/package/@agent-bus-connect/cli)
- **GitHub**: https://github.com/MustaphaSteph/agent-bus (public, MIT)
- **Latest npm/tag**: npm `0.5.0`, git tag `v0.5.0`
- **28 MCP tools** — messaging, ask/reply, channels, capability/role
  routing, directory, tasks, assignment, agent status, decisions, final
  reports
- **48 passing smoke tests** + cross-process

## Where to look

| Task | Read first |
|---|---|
| Anything contributor-facing | [`AGENTS.md`](AGENTS.md) — the canonical contributor guide |
| Mental model of the system | [`docs/concepts.md`](docs/concepts.md) |
| Adding/changing an MCP tool | [`docs/tools.md`](docs/tools.md) + grep `src/mcp/server.ts` |
| Schema or migrations | `src/db.ts` (idempotent column-existence pattern) |
| Domain logic | `src/bus.ts` (the pure layer, ~1000 lines) |
| CLI commands | `src/cli/index.ts` + sibling files |
| Tests | `test/smoke.ts` (in-process), `test/project-flow.ts`, `test/task-flow.ts`, `test/cross-process.ts` |
| OpenAPI spec | `docs/openapi.yaml` — lint-clean, renders to `docs/api-static.html` |
| LLM context | `llms.txt` — single-file primer for an agent USING the bus |
| Plugin skills | `skills/agent-bus/` — canonical skill vendored into `agent-bus-plugins` |

## Architecture rules (don't break these)

1. **Three layers, one direction.** `db.ts` ← `bus.ts` ← (`mcp/server.ts` AND `cli/*`). The bus layer is pure domain. MCP and CLI are thin adapters. Adapters never import from each other.
2. **No filesystem awareness in `bus.ts`.** Cwd derivation lives in `src/util/project.ts`. Adapters call it and pass the result to `bus.ts` as a `project` argument. Bus.ts stores what it's given (or NULL).
3. **`BusError` with a typed code** for every expected user-facing failure. Codes live in `src/util/errors.ts`.
4. **All public input validated at the boundary.** MCP uses Zod schemas in `mcp/server.ts`. Bus functions also validate names/channels/projects via regex helpers in `bus.ts`. Defense in depth.
5. **Parameterized SQLite statements.** Never concat user data into SQL. Always `better-sqlite3` prepared statements.
6. **All paths go through `AGENT_BUS_DIR`** via `src/util/paths.ts` so tests can isolate state.
7. **Strict TypeScript.** `noUncheckedIndexedAccess` is on. `??`-everything that could be undefined.

## Build & test (run these before declaring a behavior change done)

```bash
npm run typecheck          # tsc --noEmit
npm test                   # in-process smoke (40 tests)
npx tsx test/project-flow.ts
npx tsx test/task-flow.ts
npx tsx test/cross-process.ts
npm run docs:lint          # OpenAPI lint via @redocly/cli
npm run build              # emits dist/
npm run docs:build         # regenerates docs/api-static.html
```

For the listener pattern to feel snappy during dev, set
`AGENT_BUS_POLL_MS=10` on the MCP env.

## When you add a new MCP tool

The pattern, in order:

1. Add the operation to `src/bus.ts` (validates inputs, throws `BusError`, returns a typed result).
2. Add a Zod schema and dispatch case in `src/mcp/server.ts`. Update the `TOOLS` array with description + JSON Schema.
3. Add coverage to `test/smoke.ts` (happy path + every expected error).
4. Update `docs/openapi.yaml` (schemas + path) and re-lint with `npm run docs:lint`.
5. Update `docs/tools.md`, `llms.txt`, `AGENTS.md`, `CLAUDE.md`, and
   `skills/agent-bus/` blurbs. Bump the "X MCP tools" count if
   applicable.
6. Rebuild `dist/` so the new code reaches MCP clients on next session start.
7. Sync `agent-bus-plugins` with `npm run sync-skill` and update plugin
   manifests/docs when the skill or slash-command behavior changes.

## Working with other agents on this same project (self-hosting)

This project uses its own bus to coordinate. Other sessions may already
be registered:

- `claude-agent-bus-project` — typically the Claude session doing core
  domain work (bus.ts, MCP server, schema).
- `codex-agent-bus-project` — typically the Codex session doing CLI,
  tests, docs.

When you start a fresh Claude Code session in this repo:

1. Run `agent-bus whois` to see who's online.
2. If you intend to coordinate with another session, `register` as
   something descriptive (e.g. `claude-<your-task>`). The bus auto-scopes
   to project `agent-bus` since this repo has `.git`.
3. Use a fresh thread for new v0.5+ work unless the user names an
   existing thread.
4. Ping with `send` first; switch to `ask` only if a synchronous reply
   is required.

The collaboration pattern that has worked:

- One agent takes schema + bus.ts + MCP (the "domain" side).
- The other takes CLI + tests + docs/plugin context (the "shell" side).
- Use areas (`backend`, `ios`, `frontend`, `docs`) and `file_scope` on
  tasks to prevent agents from overlapping.
- Use task `mode` (`investigate_only`, `propose_patch`, `edit_files`,
  `test_only`) so verifier sessions do not edit by accident.
- Use `directory()` for the team board, `sleep_agent`/`wake_agent` for
  manager state, `record_decision` for durable decisions, and
  `final_report` before commit/push/deploy.
- Both verify independently before declaring done.

## Things to be careful about

- **The MCP server process is long-lived.** Editing `src/*.ts` or
  rebuilding doesn't reload code in running Claude/Codex sessions —
  they need to restart to pick up new binaries. Tell the user.
- **Idempotent migrations.** Any new SQLite column must use
  `CREATE TABLE IF NOT EXISTS` for new tables and column-existence
  checks before `ALTER TABLE ADD COLUMN`. v0.3 / v0.4 DBs are already
  in the wild; never break them.
- **`ask` is capped at 110 s** (Claude Code's tool timeout). Anything
  longer must use `send` + `inbox(wait_s)`.
- **Don't add a `project` column to channels.** Channels are
  intentionally cross-cutting. Fan-out copies sender's `project` to
  each `messages.project` row, which is enough for scoped watching.
- **Agent names stay globally unique.** We considered composite
  identity (`name@project`) in v0.4 design and rejected it — too many
  paths to change. Convention is project-specific naming (e.g.
  `claude-vorec-fe`).
- **`ask` rejects mutual cycles** (`ASK_CYCLE`). If you see one, the
  protocol is wrong, not the implementation.
- **The `ideas/` directory is gitignored.** It's the scratch / local
  brainstorm folder. Anything you'd publish goes in `docs/` instead.

## Tunables (env vars on the MCP server)

| Variable | Default | Effect |
|---|---|---|
| `AGENT_BUS_DIR` | `~/.agent-bus` | Where `bus.db` and listener markers live |
| `AGENT_BUS_POLL_MS` | `50` (floor 5) | SQLite poll interval during blocking `inbox(wait_s)` and `ask` waits |
| `AGENT_BUS_TASK_STALE_MS` | `300000` | Holder stale threshold for active tasks |

## Recent ground covered

- **v0.3.0** (commit ~`140804b`): first-class tasks with strict state
  machine, atomic claim, stale detection. 6 task tools.
- **v0.4.0** (commit `9fb0242`): project scoping. Nullable `project`
  column on agents/tasks/messages. Auto-derived from cwd at MCP/CLI
  boundary. Read paths default scoped; cross-project send/ask still
  works. `ask_best` fails loud with hint when no in-project match.
- **v0.5.0**: area scoping, role/routing weights, priority inbox,
  directory/team board, task modes and file scopes, assignment and
  claim-best helpers, agent sleep/wake/status, decisions, final report,
  updated Agent Skill and plugin sync.
- **README/docs/plugins + npm publish**: package lives at
  `@agent-bus-connect/cli`. Public docs, `llms.txt`, canonical skill,
  Claude/Codex plugin skills, and plugin manifests now describe the
  v0.5 manager workflow.

## Future ideas

Speculative / not-on-the-roadmap brainstorms live in `ideas/` (local
only, gitignored). The shippable ones graduate to GitHub issues or
PRs.
