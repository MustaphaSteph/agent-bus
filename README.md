<p align="center">
  <img src="docs/assets/banner.png" alt="agent-bus — connect AI agent sessions locally" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@agent-bus-connect/cli"><img src="https://img.shields.io/npm/v/@agent-bus-connect/cli.svg?label=npm" alt="npm version" /></a>
  <a href="https://github.com/MustaphaSteph/agent-bus/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@agent-bus-connect/cli.svg" alt="license" /></a>
  <a href="https://www.npmjs.com/package/@agent-bus-connect/cli"><img src="https://img.shields.io/npm/dm/@agent-bus-connect/cli.svg" alt="downloads" /></a>
  <a href="https://agentskills.io"><img src="https://img.shields.io/badge/Agent_Skills-compatible-2563eb.svg" alt="Agent Skills compatible" /></a>
  <a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="https://img.shields.io/badge/plugins-Claude_%2B_Codex-7c3aed.svg" alt="Plugin marketplaces" /></a>
</p>

<p align="center">
  <strong>Local · Private · Fast · Open source</strong>
</p>

<p align="center">
  Let multiple AI agent sessions on the same machine talk to each other.
  Claude Code, Codex, Cursor, anything that speaks MCP.
</p>

---

## Why this exists

AI coding agents are powerful — they just don't know about each other.
Open two terminals of Claude Code and they're complete strangers on the
same machine, same project, same git branch. Open a Codex window next to
a Claude window — still strangers. The moment you want one agent to ask
another for a second opinion, hand off a task to a specialist, or verify
the work the other just shipped, you're back to copy-pasting between
terminals like it's 1998.

Anthropic's own answer is **Claude Code Teams** — but it only lives
inside Claude. Codex can't join, the teammates die with the parent
session, and you pay per-teammate billing. Community projects bridge two
specific tools through a specific cloud service. Nothing out there is
*local, persistent, and tool-agnostic at the same time*.

**agent-bus is that thing.** One SQLite file at `~/.agent-bus/bus.db`
plus an MCP server every agent already knows how to talk to. Each
session registers a name. Now they can:

- send fire-and-forget messages or broadcast to whole channels,
- ask questions and block for answers,
- delegate first-class tasks with strict state machine and at-least-once delivery,
- route work by capability without knowing the receiver's name,
- record durable decisions, handoffs, risks, todos, and session briefs,
- and keep entire conversation threads addressable across restarts.

All of it works across Claude Code, Codex CLI, Codex Desktop, Cursor —
anything that speaks MCP. No daemon, no cloud, no auth, no internet. Just
a file and a process.

### What this unlocks

- **Pair debugging.** Ask a second Claude session to verify what the first one just shipped, without re-explaining context.
- **Specialist routing.** Register one session as the React expert, another as the Postgres expert. Use `ask_best(capability=…)` and the bus picks.
- **Role-aware teams.** Register agents as `pm`, `worker`, `verifier`, `reviewer`, or `listener`; routing can prefer role and weight.
- **Scoped workgroups.** Add an optional `team` so UI, backend, review, or temporary feature squads can route messages and boards inside one project without hard-coded behavior.
- **Worker pool.** Drop a listener session into `/listen` mode and delegate slow tasks to it while you keep moving in your main terminal.
- **Cross-tool collaboration.** Use Claude for code, Codex for tests, a third session for the database — all reading the same shared context through the bus.
- **Session memory.** Pin handoffs, record gotchas, and generate a `session_brief` so a fresh agent can pick up without reading raw chat history.
- **Project and area isolation.** Sessions default to the repo-derived project, and can derive a project-specific `area` from `.agent-bus.json`, so `whois`, `recent`, `tasks`, and `ask_best` stay scoped until you explicitly ask for global.
- **Manager workflow controls.** Track agent state (`idle`, `working`, `blocked`, `waiting_review`, `sleeping`), wait for expected rosters, assign pending work before workers register, split read scope from edit scope, require acknowledgements, gate completion on review, record test evidence, hand off work with pinned memory, and generate final merge-readiness reports.
- **Human-in-the-loop relay.** `agent-bus watch` shows everything live; `agent-bus team-chat --team <name>` focuses one workgroup conversation; `agent-bus inject` lets you nudge any agent from the terminal.

## How it works

```
┌──────────────────┐                  ┌──────────────────┐                  ┌──────────────────┐
│ Claude Code A    │  send / inbox /  │ ~/.agent-bus/    │  send / inbox /  │ Codex Desktop B  │
│ (any project)    │  ask / reply  ──▶│   bus.db         │ ◀─── ask / reply │ (any chat)       │
│ MCP: agent-bus   │                  │  (SQLite WAL)    │                  │ MCP: agent-bus   │
└──────────────────┘                  └────────┬─────────┘                  └──────────────────┘
                                               │
                                               │  reads/writes
                                               ▼
                                      ┌──────────────────┐
                                      │ agent-bus watch  │  ← you, in a 3rd terminal
                                      │ (live tail)      │
                                      └──────────────────┘
```

Each session spawns its own MCP server process and reads/writes the same
SQLite file in WAL mode. Names are addresses. MCP sessions derive a
project from the current repo and can derive an area from `.agent-bus.json`
as the default read/routing scope. Listeners get push-like delivery via
blocking `inbox(wait_s)`.

## Install

**Install order matters:** install the npm CLI first, then install the
Claude/Codex plugin. The plugin declares the MCP server command, but the
`@agent-bus-connect/cli` npm package provides the actual `agent-bus-mcp`
binary. If you install the plugin first, Claude Code can fail with
`ENOENT` because `agent-bus-mcp` is not on PATH yet.

### 1. Install agent-bus globally

**Prerequisite:** Node.js ≥ 20.

```bash
npm i -g @agent-bus-connect/cli@latest
which agent-bus-mcp
agent-bus --version
```

That puts two binaries on your PATH:

- `agent-bus` — the CLI (`watch`, `whois`, `log`, `tasks`, `kanban`, `done`, `inject`, …)
- `agent-bus-mcp` — the MCP stdio server that Claude Code / Codex spawn

The npm package lives under the `@agent-bus-connect` scope; the project,
the CLI commands, the MCP server identifier, and the docs all still say
`agent-bus`.

Prefer building from source? `git clone … && npm install && npm run build && npm link` works too.

### 2. Install the plugin/skill

Pick the one that matches your tool. The plugin/installer wires the MCP
config and installs the skill, slash commands, and listener hook. It
expects `agent-bus-mcp` from step 1 to already be available.

<table>
<tr>
<td align="center" width="33%">
<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/claude-code.png" alt="Claude Code" width="140" /></a>
</td>
<td align="center" width="33%">
<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/codex.png" alt="Codex" width="140" /></a>
</td>
<td align="center" width="33%">
<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/universal.png" alt="Every other tool" width="140" /></a>
</td>
</tr>
<tr>
<td>

In Claude Code:

```
/plugin
> Marketplaces
> Add MustaphaSteph/agent-bus-plugins
> Install agent-bus
```

</td>
<td>

In any terminal:

```bash
codex plugin marketplace add \
  MustaphaSteph/agent-bus-plugins
```

Then install via Codex's plugin UI.

</td>
<td>

For Cursor, Gemini CLI, Goose, OpenCode, Junie, Amp, Kiro:

```bash
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus-plugins/main/install.sh | sh
```

</td>
</tr>
</table>

If you prefer manual setup instead of plugins, the steps below give you
the same MCP connection without slash commands or bundled skills.

### 3. Register with Claude Code manually

```bash
claude mcp add -s user agent-bus -- agent-bus-mcp
```

### 4. Register with Codex CLI + Codex Desktop manually

Both read `~/.codex/config.toml`. Grab the absolute paths:

```bash
readlink -f "$(which node)"            # copy this output
readlink -f "$(which agent-bus-mcp)"   # copy this output too
```

Then add the block (substitute the paths you just copied):

```toml
[mcp_servers.agent-bus]
command = "<paste node path here>"
args = ["<paste agent-bus-mcp path here>"]
```

Absolute paths matter because Codex Desktop doesn't inherit your shell
PATH. After editing, **Cmd+Q + reopen** Codex Desktop fully.

### 5. (Recommended) Install the `/main` and `/listen` slash commands

Two one-line slash commands that make day-to-day use natural:

- `/main <name>` — primes a coordinator session to talk to the bus
  in plain English ("ask the reviewer to…", "delegate this…").
- `/listen <name>` — turns a session into a passive helper that just
  responds when called.

One-time install:

```bash
mkdir -p ~/.claude/commands
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/main.md   -o ~/.claude/commands/main.md
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/listen.md -o ~/.claude/commands/listen.md
```

### 6. Verify

```bash
agent-bus --version                # 0.17.0
claude mcp list | grep agent-bus   # ✓ Connected
```

Full install details + troubleshooting: [`docs/install.md`](docs/install.md).

Need a prompt to paste into Claude, Codex, or Cursor? See
[`docs/agent-prompts.md`](docs/agent-prompts.md) for registration,
listener, verifier, naming, and `replace: true` examples.

## Try it

Open two new Claude Code sessions.

**Terminal A** — the helper. Type:

```
/listen helper-a
```

That session registers as `helper-a` and quietly waits for messages.

**Terminal B** — your main session. Type:

```
/main me
```

Then talk to it like a person:

```
Ask helper-a what 17 × 23 is.
```

Your main session translates "ask helper-a …" into the right bus call,
helper-a wakes up, computes, and the answer comes back to you in plain
English. No tool names. No JSON.

**Terminal C** (optional, you watching):

```bash
agent-bus watch
agent-bus team-chat --team frontend --watch
```

`watch` defaults to the current repo-derived project and, when
configured, the current subfolder area; it hides old `{no-project}`
traffic by default so demos stay focused. Use `agent-bus watch --global`
when you want the whole local bus. `log`, `whois`, `tasks`, `kanban`,
`team-chat`, and `done` use `--project all --area all --team all` for
global views.

Record durable context when a session is about to hand off work:

```bash
agent-bus remember --by me --kind handoff --pinned \
  "helper-a verified auth; next session should inspect billing retries"

agent-bus brief --agent me
agent-bus memories --kind handoff --pinned
```

Use the manager board and scope checks when multiple agents may edit the
same app:

```bash
agent-bus board
agent-bus team-board --team frontend
agent-bus team-chat --team frontend
agent-bus team-chat --team frontend --from coordinator "status update?"
agent-bus tasks --team frontend
agent-bus kanban --team frontend
agent-bus kanban --team frontend --all
agent-bus kanban --team frontend --watch
agent-bus done --team frontend
agent-bus task 12
agent-bus task-start 12 --by agent-a
agent-bus task-testing 12 --by agent-a --message "running simulator smoke"
agent-bus task-done 12 --by agent-a --result "implemented and tests passed"
agent-bus wait-for-agents --names agent-a,agent-b,reviewer --area all
agent-bus scope-conflicts --files "package-a/**,shared/**"
agent-bus ack-task 12 --agent agent-a --response claimed
agent-bus review-task 12 --reviewer reviewer --approve
agent-bus test-result --by reviewer --task 12 --command "npm test" --status passed --summary "suite passed"
agent-bus handoff 12 --from agent-a --to agent-b \
  --reason "agent-a stopping; remaining checks need another session" \
  --memory "Task handoff summary for the next session."
```

Use `kanban` for the workflow view: `Todo`, `Accepted`, `Doing`,
`Testing`, `Review`, and `Blocked`; pass `--state-columns` for the raw
task states. `task-start`, `task-testing`, `task-phase`, and
`task-done` are CLI shortcuts for moving tasks while recording durable
events. Use `done` when you only want finished work, and `task <id>`
when you need the full evidence bundle for one task.

Optional area config at the repo root:

```json
{
  "project": "my-app",
  "areas": {
    "area-a": ["area-a/**"],
    "area-b": ["area-b/**"],
    "docs": ["docs/**"]
  }
}
```

For separated folders that belong to the same product, use the same
`project` and a fixed `area` in each folder:

```json
{
  "project": "shop",
  "area": "area-a"
}
```

```json
{
  "project": "shop",
  "area": "area-b"
}
```

Those sessions are in different paths, but agent-bus treats them as one
logical project with separate lanes.

For repeated app builds under one parent folder, initialize each app
subfolder as its own neutral project scope:

```bash
mkdir AppOne && cd AppOne
agent-bus team init-folder --project app-one --area app
```

That writes `{"project":"app-one","area":"app"}`. The agents or your
own prompts decide the team structure and behavior.

### Use one session as a coordinator

In an existing project, open one AI session at the repo root and make it
the coordinator:

```text
You are <coordinator-name> for this repo. Use agent-bus as the coordination layer.

Register as <coordinator-name> with role pm, area "*", capabilities
["planning","coordination"], replace true.

Your job:
- inspect the project structure
- wait for the expected roster with wait_for_agents before assuming workers are available
- create tasks with clear mode, expected_output, and file_scope
- use edit_scope for files a worker may change, and read_scope for verifier/test-only review
- set ack_required for assigned work and review_required for implementation tasks
- use delegate for long work that needs ownership/progress tracking; use allow_pending_agent when the worker session has not registered yet
- check project_board and scope conflicts before overlapping edits
- use ask_best when no exact agent is named
- create review/test-only tasks only when the user wants independent review
- record decisions with record_decision
- record pinned handoffs with remember(kind="handoff", pinned=true)
- record progress and phase changes with record_task_event
- use send_team only for discussion/FYI; use delegate_team when a team assignment must appear on team-board, kanban, or done views
- use wait_for_task for long-running work and task_result before verification or handoff
- use inbox_status/message_status/why_no_reply to diagnose delivery before assuming an agent ignored a message
- after a bus answer arrives, tell me what came back and continue locally; do not keep waiting on unrelated bus messages
- record build/lint/test evidence with record_test_result
- use session_brief at start and review_gate/final_report before commit/push
- cancel superseded work with cancel_task instead of leaving it active
- do not let agents edit outside their file_scope/edit_scope
- do not push/deploy unless I explicitly approve

First call directory and session_brief, then tell me who is available
and what the next task should be.
```

Start workers in Claude Code, Codex, or another MCP-capable tool:

```text
Register yourself as <worker-name> with role worker, area <area>,
team <team>, capabilities <capability-list>, replace true. Listen only
to team <team> with inbox(agent="<worker-name>", team="<team>",
wait_s=110, claim_s=300) and inbox_status(agent="<worker-name>",
team="<team>"). Work assigned tasks. Only edit files inside the task
file_scope. Reply with Summary, Files changed, Risks, and Tests.
```

```text
Register yourself as <reviewer-name> with role reviewer, area "*",
capabilities <capability-list>, replace true. Follow the task mode. For
test_only/review tasks, inspect changes and report bugs and risks
without implementation edits unless explicitly reassigned.
```

Then tell the manager things like:

```text
Create scoped tasks for this goal.
Assign each task to the matching available agent.
Ask the reviewer to review the current diff.
Record a pinned handoff memory for what remains.
```

> `/main` and `/listen` each register their session once. After that the
> names live in `~/.agent-bus/bus.db` and survive restarts. The
> coordinator phrases — "ask helper-a", "delegate this", "get a second
> opinion" — are translated by the slash command's playbook into the
> right `ask` / `send` / `ask_best` calls under the hood.

### What you'll see

Within a couple of seconds:

**Terminal C** (the watcher) shows the live message flow:

```
agent-bus watch
  online  helper-a  [listening]
  online  me
---
14:52:01 #1 me → helper-a  ASK
  what is 17 × 23?
14:52:03 #2 helper-a → me  REPLY ↪#1
  391
```

**Terminal A** (helper-a) narrates briefly and goes back to listening:

```
listening as helper-a
← from me: "what is 17 × 23?"  → answered: "391"
```

**Terminal B** (your main session) prints the answer back in plain English:

```
helper-a says: 391.
```

From here, swap the math for "review my last commit", "run the test suite", "summarize this PR", "find every call to useAuth in the codebase", or anything else you'd want a peer session to handle. You stay conversational; the agent picks the right bus call.

## What you get

- **57 MCP tools** — direct messages, synchronous ask/reply, thread replies, non-consuming inbox diagnostics, message/reply diagnostics, team-scoped send/ask/boards, channels (fan-out), capability and role routing, conversation threads, at-least-once delivery with claim+ack, roster waiting, first-class tasks, one-call direct and team delegation, task waiting, pending assignment, split read/edit scope, task progress events, result bundles, cancellation, review gates, agent status controls, decisions, structured memories, test evidence, session briefs, and final reports.
- **Cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent share the same bus.
- **Persistent** — agents, messages, channels, threads, tasks, task events, decisions, test results, and memories survive restarts via SQLite WAL.
- **Project/area/team-scoped by default** — MCP sessions derive a local project from cwd and optional area from `.agent-bus.json`; agents can also register a neutral `team` workgroup. Global views are explicit with `project: "*"`, `area: "*"`, `team: "*"`, CLI `agent-bus watch --global`, or CLI `--project all --area all --team all` on other read commands.
- **Terminal project management views** — `agent-bus team-chat` shows one team's conversation, `agent-bus kanban` groups active work into Todo/Accepted/Doing/Testing/Review/Blocked lanes, `agent-bus done` shows terminal task history, and `agent-bus task <id>` gives a readable task evidence bundle.
- **Zero infra** — no daemon, no cloud, no auth. One file at `~/.agent-bus/bus.db`.
- **Listener resilience** — Claude Code Stop hook keeps listeners alive even when they fall out of the agent loop.

## Documentation

| | |
|---|---|
| [`docs/install.md`](docs/install.md) | Install for Claude Code, Codex CLI, Codex Desktop |
| [`docs/agent-prompts.md`](docs/agent-prompts.md) | Copy-paste prompts for registering agents, listeners, and verifiers |
| [`docs/concepts.md`](docs/concepts.md) | Mental model: agents, messages, threads, channels, claims, tasks, memories |
| [`docs/tools.md`](docs/tools.md) | All MCP tools — signatures, errors, examples |
| [`docs/cli.md`](docs/cli.md) | `agent-bus` CLI reference |
| [`docs/patterns.md`](docs/patterns.md) | Listener mode, async chat, capability routing, broadcast, ack/retry, threading |
| [`docs/architecture.md`](docs/architecture.md) | Schema, internals, tuning, what it can and can't do |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common errors and fixes |
| [`docs/openapi.yaml`](docs/openapi.yaml) | Core synthetic OpenAPI 3.1 mapping; [`docs/tools.md`](docs/tools.md) is authoritative for the full MCP surface |
| [`llms.txt`](llms.txt) | Single-file context to drop into an AI agent so it can use the bus |

## License

[MIT](LICENSE).
