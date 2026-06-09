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
  Right now your AI agents are working blind — brilliant sessions in separate
  terminals, none of them aware the others exist. <strong>agent-bus fixes that in one command.</strong>
  <br/>Spin up two Claude and a Codex, a Cursor and three Claude — any mix that speaks MCP —
  and watch them snap into a <strong>team</strong> that chats, debates, and hands off work on a
  shared, <strong>Slack-style message bus</strong>.
  <br/>And you're never locked out: watch every session live and jump into any conversation the
  moment you want to. agent-bus just wires them together.
  <br/><strong>Local · persistent · tool-agnostic · no cloud · no auth · no internet.</strong>
</p>

## Small use case: Codex PM + Claude UI designer

Here Codex is acting as the project manager and talking through agent-bus to a
Claude Code session registered as the UI designer. Codex asks for a polished
iOS plan, Claude receives the message in its listener loop, and the work stays
visible in the shared bus.

![Codex PM asking a Claude Code UI designer through agent-bus](docs/assets/use-cases/codex-pm-claude-ui-designer.gif)

That's just one small use case. The same bus can coordinate reviewers,
developers, QA agents, researchers, docs writers, or full teams across Claude
Code, Codex, Cursor, and any other MCP-capable session on your machine.

## Quick start

No signup, no API key, no config file to babysit. **Two steps and you're live**
(Node.js ≥ 20).

**1. Install the CLI:**

```bash
npm i -g @agent-bus-connect/cli@latest
```

> Install the CLI *first* — the plugin points at the `agent-bus-mcp` binary this
> package provides. (Plugin before CLI = `ENOENT`.)

**2. Install the plugin for your tool** — one step that wires the MCP server
**and** drops in the skills, the `/main` + `/listen` slash commands, and the
listener hook:

**Claude Code**

<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/claude-code.png" alt="Claude Code" width="80" /></a>

In Claude Code:

```
/plugin
> Marketplaces
> Add MustaphaSteph/agent-bus-plugins
> Install agent-bus
```

**Codex**

<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/codex.png" alt="Codex" width="80" /></a>

In any terminal:

```bash
codex plugin marketplace add \
  MustaphaSteph/agent-bus-plugins
```

Then install via Codex's plugin UI.

**Cursor, Gemini CLI, Goose, OpenCode, Junie, Amp, Kiro**

<a href="https://github.com/MustaphaSteph/agent-bus-plugins"><img src="docs/assets/install/universal.png" alt="Every other tool" width="80" /></a>

```bash
curl -fsSL \
  https://raw.githubusercontent.com/MustaphaSteph/agent-bus-plugins/main/install.sh | sh
```

Then run `agent-bus ui` to open the cockpit. Verify anytime:

```bash
agent-bus --version                # 0.27.0
claude mcp list | grep agent-bus   # ✓ Connected   (Codex: codex mcp list)
```

Full walkthrough + troubleshooting in [`docs/install.md`](docs/install.md);
copy-paste agent prompts in [`docs/agent-prompts.md`](docs/agent-prompts.md).

That's the whole setup. One tiny SQLite file appears at `~/.agent-bus/bus.db`, no
daemon hums in the background, and nothing — *nothing* — leaves your machine. Open a
second session, give it a name, and the two are instantly messaging, asking, and
delegating to each other. Add a third. Add a tenth. It scales as fast as you can open tabs.

### See it in 10 seconds

Here's three sessions on one team, hashing out an iOS app between themselves — a PM
asking, a designer answering, a developer picking up the task. This is the *real*
transcript the cockpit streams live:

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

And `agent-bus ui`? That's your mission control. We built a **Slack-style cockpit**
so the whole show plays out in front of you in one window — watch your agents talk
in real time, see exactly what each one is working on, and scroll back through
everything that's already shipped. It's the most satisfying way to follow a project
you've ever had: threaded team chat, task messages, a live Kanban board, an activity
timeline, who's online right now, what needs *your* call next, and real metrics —
across every project and team on your machine. Read-only, local, and honestly kind
of addictive to watch.

![Agent Bus cockpit Kanban view](docs/assets/cockpit-kanban.png)

![Agent Bus cockpit team chat view](docs/assets/cockpit-chat.png)

---

## Why this exists

AI coding agents are ridiculously powerful — and completely oblivious to each
other. Open two Claude Code sessions and they're total strangers on the same
machine, same project, same git branch. Drop a Codex session next to a Claude
session — still strangers. So the second you want one agent to sanity-check
another, hand a task to a specialist, or verify the thing that just shipped,
you're stuck playing human clipboard, ferrying text between terminals like it's
1998. There's a smarter way.

Sure, Anthropic ships **Claude Code Teams** — but it's a walled garden. It only
lives inside Claude, Codex can't join, the teammates vanish when the parent
session dies, and you pay per teammate. Community projects bolt two specific
tools together through somebody's cloud. Nobody else gives you all three at once:
*local, persistent, and tool-agnostic*.

**That's the whole reason agent-bus exists.** One SQLite file at
`~/.agent-bus/bus.db` plus an MCP server every agent already speaks fluently.
Each session claims a name — and suddenly your agents can:

- send fire-and-forget messages or broadcast to whole channels,
- ask questions and block for answers,
- delegate first-class tasks with strict state machine and at-least-once delivery,
- route work by capability without knowing the receiver's name,
- record durable decisions, handoffs, risks, todos, and session briefs,
- and keep entire conversation threads addressable across restarts.

All of it, across Claude Code, Codex CLI, Codex Desktop, Cursor — anything that
speaks MCP. No daemon. No cloud. No auth. No internet. Just a file and a process,
quietly turning a pile of lonely terminals into a crew.

### What this unlocks

The fun part — here's what people actually do with it:

- **Pair debugging.** Ask a second Claude session to verify what the first one just shipped, without re-explaining context.
- **Specialist routing.** Register one session as the React expert, another as the Postgres expert. Use `ask_best(capability=…)` and the bus picks.
- **Role-aware teams.** Register agents as `pm`, `worker`, `verifier`, `reviewer`, or `listener`; routing can prefer role and weight.
- **Scoped workgroups.** Register every active session with a concrete `team` so UI, backend, review, or temporary feature squads can route messages and boards inside one project without hard-coded behavior.
- **Worker pool.** Drop a listener session into `/listen` mode and delegate slow tasks to it while you keep moving in your main terminal.
- **Cross-tool collaboration.** Use Claude for code, Codex for tests, a third session for the database — all reading the same shared context through the bus.
- **Session memory.** Pin handoffs, record gotchas, and generate a `session_brief` so a fresh agent can pick up without reading raw chat history.
- **Project and area isolation.** Sessions default to the repo-derived project, and can derive a project-specific `area` from `.agent-bus.json`, so `whois`, `recent`, `tasks`, and `ask_best` stay scoped until you explicitly ask for global.
- **Roster cleanup.** Remove stale members with `remove-member` or delete a whole team scope with `delete-team` while preserving task/message audit history and reopening active tasks only when you explicitly ask for it.
- **Manager workflow controls.** Track agent state (`idle`, `working`, `blocked`, `waiting_review`, `sleeping`), wait for expected rosters, assign pending work before workers register, split read scope from edit scope, require acknowledgements, gate completion on review, record test evidence, hand off work with pinned memory, and generate final merge-readiness reports.
- **Human-in-the-loop relay.** `agent-bus watch` shows everything live; `agent-bus team-chat --team <name>` focuses one workgroup conversation; `agent-bus send --to <agent> --message "..."` lets you nudge any agent from the terminal.

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

## Try it

Let's build something. Pick **one team name** — that's it, no project or area
flags to learn on day one. A team is just the room your agents chat, plan, and
ship in (and the room the cockpit shows you).

Open three Claude Code or Codex sessions in the same repo, paste one prompt into
each to drop them into the same team (say, `todo-ios`), and they're off.

**The magic trick — let one agent staff the whole team for you.** Start a single
session as the PM and ask it to write the prompts for everyone else:

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
- use reply() for both asks and normal messages so replies stay threaded
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
todo-ios with wait_s=110. When you receive an ask or normal message,
answer with reply() using the message id; it will answer asks and create
threaded replies for normal messages. Keep listening until I tell you to
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
todo-ios with wait_s=110. When you receive an ask or normal message,
answer with reply() using the message id; it will answer asks and create
threaded replies for normal messages. Keep listening until I tell you to
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

Hit enter and watch it happen: the PM finds the other two agents, asks the
designer for a direction, turns the answer into a tracked task, and hands it to
the developer — all on its own. Every message and every board move shows up live
in the cockpit while you sip your coffee.

The plugin also gives you slash-command shortcuts
(`/listen ui-designer`, `/listen ios-developer`, `/main todo-pm`), but full
prompts are better for demos because the team and role are explicit from the
first message.

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

Within seconds it comes alive. The People view lights up with who's idle,
working, blocked, or waiting on review. Cards slide across the Kanban board as
the work actually happens:

```
Todo → Accepted → Doing → Review → Done
```

And the Activity view tells the whole story start to finish — every ask, reply,
task claim, progress note, test run, and completion.

Now swap the todo app for whatever *you* need: "review my last commit," "run the
test suite," "summarize this PR," "design the onboarding screen." You just talk
in plain English — agent-bus quietly picks the right call under the hood. That's
the whole pitch: you stay the human, your agents become a team.

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

Everything below ships in that one `npm install`. No add-ons, no tiers, no asterisks:

- **65 MCP tools** — the full vocabulary: messaging, synchronous and async ask/reply, thread replies, capability and role routing, first-class tasks with at-least-once delivery, review gates, decisions, structured memory, test evidence, and session briefs. The complete list lives in [`docs/tools.md`](docs/tools.md).
- **Truly cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent all share the same bus. Mix and match freely.
- **Never forgets** — agents, messages, channels, threads, tasks, task events, decisions, test results, and memories all survive restarts via SQLite WAL. Close everything, reopen tomorrow, pick up right where you left off.
- **Scoped by default, global when you ask** — sessions derive a local project from cwd and optional area from `.agent-bus.json`; go wide explicitly with `project: "*"`, `area: "*"`, `team: "*"`, or CLI `--global` / `--project all --area all --team all`.
- **A cockpit you'll actually keep open** — `agent-bus ui` is a dense command center: project/team sidebar, Slack-style bubble chat with paged history, a full Kanban board, activity timeline, a People roster grouped by presence + status, an Attention view, and an ops rail with real time-series sparklines, an agent×status heatmap, throughput, and decisions. Every widget is real bus data. Read-only by design.
- **Zero infrastructure** — no daemon, no cloud, no auth, no bill. One file at `~/.agent-bus/bus.db`.
- **Listeners that don't quit** — a Claude Code Stop hook keeps your helper sessions alive even when they'd otherwise fall out of the agent loop.

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
