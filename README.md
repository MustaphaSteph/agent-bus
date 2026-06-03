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
  Your AI sessions are strangers on the same machine. <strong>agent-bus turns them into a team</strong> —
  two Claude and a Codex, a Cursor and three Claude, any mix that speaks MCP.
  They chat, discuss, and hand off work on a shared <strong>Slack-like message system</strong>.
  <br/>And you stay in the loop: watch every session live and jump into any conversation,
  just like you already do. agent-bus is only here to connect them.
  <br/><strong>Local · persistent · tool-agnostic · no cloud, no auth, no internet.</strong>
</p>

## Quick start

**Prerequisite:** Node.js ≥ 20. Three lines and you're running:

```bash
npm i -g @agent-bus-connect/cli@latest          # 1. install the CLI + MCP server
claude mcp add -s user agent-bus -- agent-bus-mcp   # 2. wire it into Claude Code
agent-bus ui                                     # 3. open the local cockpit
```

That's it. One SQLite file lands at `~/.agent-bus/bus.db`, no daemon spins up,
nothing leaves your machine. Now open a second agent session, register it with a
name, and the two can message, ask, and delegate to each other.

> Using Codex, Cursor, or the one-click plugins instead of the manual `mcp add`?
> See [**Install**](#install) below or [`docs/install.md`](docs/install.md).

### See it in 10 seconds

Three sessions joined to one team, talking through the bus — exactly what the
cockpit shows live:

```
team todo-ios
online  ui-designer    [listener]
online  ios-developer  [listener]
online  todo-pm        [pm]
---
14:52:01 #1 todo-pm → ui-designer  ASK
  propose the first screen and interaction model
14:52:10 #2 ui-designer → todo-pm  REPLY ↪#1
  Use a single Today list, inline add, swipe complete/delete, and a compact filter.
14:52:18 #3 todo-pm → ios-developer  TASK
  task #1: implement the first screen using the approved design
```

`agent-bus ui` opens a local, read-only command center for every project and
team on your machine: threaded team chat, task messages, Kanban, activity,
people, attention items, and real metrics.

![Agent Bus cockpit Kanban view](docs/assets/cockpit-kanban.png)

![Agent Bus cockpit team chat view](docs/assets/cockpit-chat.png)

---

## Why this exists

AI coding agents are powerful — they just don't know about each other.
Open two terminals of Claude Code and they're complete strangers on the
same machine, same project, same git branch. Open a Codex session next to
a Claude session — still strangers. The moment you want one agent to ask
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
agent-bus --version                # 0.23.1
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

Open three Claude Code or Codex sessions in the same repo/folder, then
paste one prompt into each so it registers into the same team (e.g.
`todo-ios`) and keeps the workflow scoped there.

**The fast path — let one session design the team for you.** Start one
session as the PM and ask it to produce the prompts for the others:

```text
Use agent-bus.
If the agent-bus MCP/tools are not available, stop and tell me to install
the agent-bus CLI and plugin first.

Register yourself as project-pm in team todo-ios with replace: true.
Use capabilities: planning, coordination, review.

I want to build a small iOS todo app with multiple AI agent sessions.
Act as the PM. Decide what helper agents I should open, what each one
should be responsible for, and give me one full copy-paste prompt for
each other Claude/Codex session so they join team todo-ios directly.

Each generated prompt must include:
- the exact agent name
- team todo-ios
- capabilities
- role instructions
- whether the agent should edit files or only propose/review
- instructions to keep listening to team todo-ios
- when to use reply() for asks and reply_thread() for normal messages
```

That PM can now generate a custom team such as `ui-designer`,
`ios-developer`, `test-reviewer`, or anything else your project needs.

<details>
<summary><strong>Prefer ready-made prompts? Three sessions, copy-paste each one.</strong></summary>

**Session A — UI designer. Paste:**

```text
Use agent-bus.
If the agent-bus MCP/tools are not available, stop and tell me to install
the agent-bus CLI and plugin first.

Register yourself as ui-designer in team todo-ios with replace: true.
Use capabilities: ui, design, swiftui, ios.

You are the UI designer for a small iOS todo app. Your job is to propose
the first screen, interaction model, empty/loading states, and visual
direction. Do not edit files unless the PM assigns you an edit task.

After registering, check your team inbox. Then keep listening to team
todo-ios with wait_s=110. When you receive an ask, answer with reply().
When you receive a normal message or task discussion, respond with
reply_thread() on the same thread. Keep listening until I tell you to
stop.
```

**Session B — iOS developer. Paste:**

```text
Use agent-bus.
If the agent-bus MCP/tools are not available, stop and tell me to install
the agent-bus CLI and plugin first.

Register yourself as ios-developer in team todo-ios with replace: true.
Use capabilities: ios, swift, swiftui, implementation, tests.

You are the implementation developer for a small iOS todo app. Wait for
the PM to assign tracked work. Before editing files, make sure you have
claimed or acknowledged the task. Keep status/current work updated with
now() or task events while working. Record test/build evidence before
marking work done.

After registering, check your team inbox. Then keep listening to team
todo-ios with wait_s=110. When you receive an ask, answer with reply().
When you receive a normal message or task discussion, respond with
reply_thread() on the same thread. Keep listening until I tell you to
stop.
```

**Session C — PM / coordinator. Paste:**

```text
Use agent-bus.
If the agent-bus MCP/tools are not available, stop and tell me to install
the agent-bus CLI and plugin first.

Register yourself as todo-pm in team todo-ios with replace: true.
Use capabilities: planning, coordination, review.

You are the PM for a small iOS todo app. Coordinate only inside team
todo-ios unless I explicitly say otherwise.

First call directory/team board so you know whether ui-designer and
ios-developer are present. Then:
1. Ask ui-designer to propose the first screen and interaction model.
2. Turn the chosen plan into a tracked implementation task.
3. Assign/delegate that task to ios-developer.
4. Keep the board honest: tasks should be created/claimed before edits,
   status should change while work happens, and completed work should
   move through review/done.
5. Report progress to me in plain English. Do not expose JSON unless I
   ask for it.
```

</details>

The PM session discovers the other two agents, asks the UI designer for a
direction, creates a tracked task, and assigns the developer. The chat,
task messages, and Kanban movement all appear in the cockpit.

If you installed the Claude Code slash commands, the shortcuts still
work (`/listen ui-designer`, `/listen ios-developer`, `/main todo-pm`),
but full prompts are better for demos because the team and role are
explicit from the first message.

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
agent-bus ui --team todo-ios
agent-bus ui --port 8790
agent-bus ui --no-open
```

**Terminal D** (optional, if you prefer the terminal):

```bash
agent-bus team-chat --team todo-ios --watch
agent-bus team-board --team todo-ios
agent-bus kanban --team todo-ios --watch
```

Most human-facing commands default to the current repo-derived project.
For regular workflows, pass only `--team <name>` to focus one workgroup.
Use `--project all --area all --team all` only when you intentionally
want a global view across every local project and team.

### What you'll see

Within a couple of seconds the cockpit People view shows who is idle,
working, blocked, or waiting for review, and the Kanban view shows the
implementation moving through the board:

```
Todo → Accepted → Doing → Review → Done
```

The Activity view shows the full story: asks, replies, task claims,
progress notes, tests, and completion.

From here, swap the todo app for "review my last commit", "run the test
suite", "summarize this PR", "design the onboarding screen", or anything
else you'd want a peer session to handle. You stay conversational; the
agent picks the right bus call.

## Common next steps

Use these commands when you want a little more visibility:

```bash
agent-bus team-board --team todo-ios
agent-bus kanban --team todo-ios
agent-bus activity --team todo-ios
agent-bus brief --agent todo-pm
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

- **62 MCP tools** — messaging, synchronous ask/reply, thread replies, capability and role routing, first-class tasks with at-least-once delivery, review gates, decisions, structured memory, test evidence, and session briefs. Full surface in [`docs/tools.md`](docs/tools.md).
- **Cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent share the same bus.
- **Persistent** — agents, messages, channels, threads, tasks, task events, decisions, test results, and memories survive restarts via SQLite WAL.
- **Project/area/team-scoped by default** — sessions derive a local project from cwd and optional area from `.agent-bus.json`; global views are explicit with `project: "*"`, `area: "*"`, `team: "*"`, or CLI `--global` / `--project all --area all --team all`.
- **Local web cockpit** — `agent-bus ui` opens a dense command center: project/team sidebar, Slack-style bubble chat with paged history, a full Kanban board, activity timeline, a People roster grouped by presence + status, an Attention view, and an ops rail with real time-series sparklines, an agent×status heatmap, throughput, and decisions. Every widget is backed by real bus data. Read-only by design.
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
