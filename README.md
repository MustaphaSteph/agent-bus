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
- **Scoped workgroups.** Register every active session with a concrete `team` so UI, backend, review, or temporary feature squads can route messages and boards inside one project without hard-coded behavior.
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

- `/main <name>` — primes a team manager session
  to talk to the bus in plain English ("ask the reviewer to…",
  "delegate this…", "show team board").
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
agent-bus --version                # 0.22.0
claude mcp list | grep agent-bus   # ✓ Connected
```

Full install details + troubleshooting: [`docs/install.md`](docs/install.md).

Need a prompt to paste into Claude, Codex, or Cursor? See
[`docs/agent-prompts.md`](docs/agent-prompts.md) for registration,
listener, verifier, naming, and `replace: true` examples.

## Try it

For normal use, pick **one team name** and use it everywhere. You do
not need project or area flags to get started. A team is the workgroup
boundary for chat, boards, and the web cockpit.

Example team:

```text
frontend
```

Open two new Claude Code or Codex sessions in the same repo/folder.

**Terminal A** — the worker/listener. Type:

```
/listen helper-a
```

When it asks for a team, answer with the same team name:

```
frontend
```

That session registers as `helper-a` in team `frontend` and quietly
waits for team-scoped messages and tasks.

**Terminal B** — the manager for the same team. Type:

```
/main me
```

When it asks for a team, answer:

```
frontend
```

Then talk to it like a person:

```
Ask helper-a what 17 × 23 is.
```

Your manager session translates "ask helper-a …" into the right
team-scoped bus call, helper-a wakes up, computes, and the answer comes
back to you in plain English. No tool names. No JSON.

**Open the visual cockpit**:

```bash
agent-bus ui
```

By default it opens:

```text
http://127.0.0.1:8787
```

The cockpit is read-only and local-only. It shows every project and
team, team chat with threaded replies, task messages, Kanban, activity,
people, attention items, and real metrics. Switch projects and teams in
the browser without restarting anything.

Optional initial view flags:

```bash
agent-bus ui --team frontend
agent-bus ui --port 8790
agent-bus ui --no-open
```

**Terminal C** (optional, if you prefer the terminal):

```bash
agent-bus team-chat --team frontend --watch
agent-bus team-board --team frontend
agent-bus kanban --team frontend --watch
```

Most human-facing commands default to the current repo-derived project.
For regular workflows, pass only `--team <name>` to focus one workgroup.
Use `--project all --area all --team all` only when you intentionally
want a global view across every local project and team.

### What you'll see

Within a couple of seconds:

**Terminal C** (the watcher) shows the team message flow:

```
agent-bus team-chat --team frontend --watch
  team frontend
  online  helper-a  [listener]
  online  me        [pm]
---
14:52:01 #1 me → helper-a  ASK
  what is 17 × 23?
14:52:03 #2 helper-a → me  REPLY ↪#1
  391
```

**Terminal A** (helper-a) narrates briefly and goes back to listening:

```
listening as helper-a team=frontend
← from me: "what is 17 × 23?"  → answered: "391"
```

**Terminal B** (your team manager session) prints the answer back in plain English:

```
helper-a says: 391.
```

From here, swap the math for "review my last commit", "run the test suite", "summarize this PR", "find every call to useAuth in the codebase", or anything else you'd want a peer session to handle. You stay conversational; the agent picks the right bus call.

## Common next steps

Use these commands when you want a little more visibility:

```bash
agent-bus team-board --team frontend
agent-bus kanban --team frontend
agent-bus activity --team frontend
agent-bus brief --agent me
```

For real project work, keep it simple:

- Put every active session in a concrete team.
- Use `send_team` for discussion and `delegate` / `delegate_team` for work that should appear on the board.
- Keep the board honest: create or claim a task before tracked edits, update `now()` / status while working, and move finished work to review or done.
- Use the web cockpit (`agent-bus ui`) when you want the big picture.

Detailed CLI commands, task workflows, memory examples, separated-folder
project setup, and copy-paste agent prompts live in
[`docs/cli.md`](docs/cli.md), [`docs/patterns.md`](docs/patterns.md),
and [`docs/agent-prompts.md`](docs/agent-prompts.md).

## What you get

- **62 MCP tools** — direct messages, synchronous ask/reply, thread replies, truncation-safe inbox previews and exact message fetches, non-consuming inbox diagnostics, message/reply diagnostics, team-scoped send/ask/boards, activity timelines, cockpit dashboards, current-work updates, channels (fan-out), capability and role routing, conversation threads, at-least-once delivery with claim+ack, roster waiting, first-class tasks, one-call direct and team delegation, task waiting, pending assignment, split read/edit scope, task progress events, result bundles, cancellation, review gates, agent status controls, decisions, structured memories, test evidence, session briefs, and final reports.
- **Cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent share the same bus.
- **Persistent** — agents, messages, channels, threads, tasks, task events, decisions, test results, and memories survive restarts via SQLite WAL.
- **Project/area/team-scoped by default** — MCP sessions derive a local project from cwd and optional area from `.agent-bus.json`; active workflows should register a concrete `team` workgroup. Global views are explicit with `project: "*"`, `area: "*"`, `team: "*"`, CLI `agent-bus watch --global`, or CLI `--project all --area all --team all` on other read commands.
- **Terminal project management views** — `agent-bus activity` explains what happened recently, `agent-bus cockpit` shows what needs attention next, `agent-bus team-chat` shows one team's conversation, `agent-bus kanban` groups active work into Todo/Accepted/Doing/Testing/Review/Blocked lanes, `agent-bus done` shows terminal task history, and `agent-bus task <id>` gives a readable task evidence bundle.
- **Local web cockpit** — `agent-bus ui` opens a dense "command center" local dashboard: a wide project/team sidebar, a center view-switcher (Slack-style **bubble chat** with cursor-paged history, a full Kanban board, activity timeline, a People roster grouped by presence + status, and an Attention view of what needs a human next), and an ops right rail with real time-series sparklines, an agent×status heatmap, mini-Kanban, throughput, and decisions. Every widget is backed by real bus data. Switch projects and teams live in the browser — no restart. Read-only by design.
- **Large-message recovery** — `agent-bus inbox-previews` shows pending messages without full bodies, and `agent-bus message <id> --no-content` fetches one exact message safely before an agent chooses to pull the full content.
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
