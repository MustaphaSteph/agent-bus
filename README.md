<p align="center">
  <img src="docs/assets/banner.png" alt="agent-bus — connect AI agent sessions locally" />
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
- and keep entire conversation threads addressable across restarts.

All of it works across Claude Code, Codex CLI, Codex Desktop, Cursor —
anything that speaks MCP. No daemon, no cloud, no auth, no internet. Just
a file and a process.

### What this unlocks

- **Pair debugging.** Ask a second Claude session to verify what the first one just shipped, without re-explaining context.
- **Specialist routing.** Register one session as the React expert, another as the Postgres expert. Use `ask_best(capability=…)` and the bus picks.
- **Worker pool.** Drop a listener session into `/listen` mode and delegate slow tasks to it while you keep moving in your main terminal.
- **Cross-tool collaboration.** Use Claude for code, Codex for tests, a third session for the database — all reading the same shared context through the bus.
- **Multi-project isolation.** Sessions default to the repo-derived project, so `whois`, `recent`, `tasks`, and `ask_best` stay scoped until you explicitly ask for global.
- **Human-in-the-loop relay.** `agent-bus watch` shows everything live; `agent-bus inject` lets you nudge any agent from the terminal.

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
project from the current repo and use it as the default read/routing
scope. Listeners get push-like delivery via blocking `inbox(wait_s)`.

## Install

**Prerequisites:** Node.js ≥ 20.

### 1. Install agent-bus globally

```bash
npm i -g @agent-bus-connect/cli
```

That puts two binaries on your PATH:

- `agent-bus` — the CLI (`watch`, `whois`, `log`, `tasks`, `inject`, …)
- `agent-bus-mcp` — the MCP stdio server that Claude Code / Codex spawn

The npm package lives under the `@agent-bus-connect` scope; the project,
the CLI commands, the MCP server identifier, and the docs all still say
`agent-bus`.

Prefer building from source? `git clone … && npm install && npm run build && npm link` works too.

### 2. Register with Claude Code

```bash
claude mcp add -s user agent-bus -- agent-bus-mcp
```

### 3. Register with Codex CLI + Codex Desktop

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

### 4. (Recommended) Install the `/listen` slash command

The "Try it" example below uses `/listen alpha`, which is a Claude Code
slash command. One-time install:

```bash
mkdir -p ~/.claude/commands
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/listen.md \
  -o ~/.claude/commands/listen.md
```

### 5. Verify

```bash
agent-bus --version                # 0.4.0
claude mcp list | grep agent-bus   # ✓ Connected
```

Full install details + troubleshooting: [`docs/install.md`](docs/install.md).

## Try it

Open two new Claude Code sessions.

**Terminal A** (the listener — `/listen` registers `alpha` and starts the inbox loop):

```
/listen alpha
```

**Terminal B** (the sender — explicit register since there's no slash command for "talk"):

```
Use agent-bus to register me as "beta", then send alpha "what is 17 × 23?"
and wait for the reply with inbox(wait_s=30).
```

**Terminal C** (you, watching):

```bash
agent-bus watch
```

`watch`, `log`, `whois`, and `tasks` default to the current
repo-derived project. Use `--project all` when you want the whole local
bus.

> Every session needs to `register` once. `/listen` does it for you; the sender does it explicitly. After that, the name persists in `~/.agent-bus/bus.db` and any session can reuse it.

### What you'll see

Within a couple of seconds:

**Terminal C** (the watcher) shows the live message flow:

```
agent-bus watch
  online  alpha  [listening]
  online  beta
---
14:52:01 #1 beta → alpha  msg
  what is 17 × 23?
14:52:03 #2 alpha → beta  msg
  391
```

**Terminal A** (the listener) narrates the exchange and goes back to waiting:

```
listening as alpha
← from beta: "what is 17 × 23?"  → answered: "391"
```

**Terminal B** (the sender) prints alpha's reply and the conversation ends:

```
alpha replied: 391
```

That's the entire loop: register → send → block on inbox → message lands → answer is sent back → asker unblocks. All through one SQLite file, no network, no daemon. From here, swap the math for "review my last commit", "run the test suite", "summarize this PR", or anything else you'd want a peer session to handle.

## What you get

- **20 MCP tools** — direct messages, synchronous ask/reply, channels (fan-out), capability routing, conversation threads, at-least-once delivery with claim+ack, and first-class tasks with strict state machine.
- **Cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent share the same bus.
- **Persistent** — agents, messages, channels, threads, and tasks survive restarts via SQLite WAL.
- **Project-scoped by default** — MCP sessions derive a local project from cwd; global views are explicit with `project: "*"` or `--project all`.
- **Zero infra** — no daemon, no cloud, no auth. One file at `~/.agent-bus/bus.db`.
- **Listener resilience** — Claude Code Stop hook keeps listeners alive even when they fall out of the agent loop.

## Documentation

| | |
|---|---|
| [`docs/install.md`](docs/install.md) | Install for Claude Code, Codex CLI, Codex Desktop |
| [`docs/concepts.md`](docs/concepts.md) | Mental model: agents, messages, threads, channels, claims, tasks |
| [`docs/tools.md`](docs/tools.md) | All 20 MCP tools — signatures, errors, examples |
| [`docs/cli.md`](docs/cli.md) | `agent-bus` CLI reference |
| [`docs/patterns.md`](docs/patterns.md) | Listener mode, async chat, capability routing, broadcast, ack/retry, threading |
| [`docs/architecture.md`](docs/architecture.md) | Schema, internals, tuning, what it can and can't do |
| [`docs/troubleshooting.md`](docs/troubleshooting.md) | Common errors and fixes |
| [`docs/openapi.yaml`](docs/openapi.yaml) | OpenAPI 3.1 spec — lint-clean, also rendered to `docs/api-static.html` |
| [`llms.txt`](llms.txt) | Single-file context to drop into an AI agent so it can use the bus |
| [`AGENTS.md`](AGENTS.md) | Codebase layout and rules for contributors editing `src/` |

## License

[MIT](LICENSE).
