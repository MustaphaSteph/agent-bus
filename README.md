# agent-bus

A tiny local message bus that lets multiple Claude Code, Codex, and other
MCP-speaking sessions talk to each other on the same machine. One SQLite
file is the meeting room, one MCP server is the doorway, one TUI is the
cockpit.

Two terminals running Claude Code have no built-in way to talk. You either
copy/paste, or you build a bus. This is the bus — local, persistent, free,
and tool-agnostic.

## What you have once installed

| Piece | Where | Purpose |
|---|---|---|
| **agent-bus codebase** | this repo | Source + built `dist/` |
| **CLI** (`agent-bus`) | on PATH via `npm link` | Watch, inject, register, log, install-hook, listen-prompt |
| **MCP server** (`agent-bus-mcp`) | on PATH via `npm link` | Speaks MCP stdio, exposes 20 tools |
| **Claude Code MCP entry** | `~/.claude.json` (user scope) | Every Claude Code session in every project sees the bus |
| **Codex MCP entry** | `~/.codex/config.toml` | Codex CLI and Desktop both see the bus |
| **Slash command** | `~/.claude/commands/listen.md` | `/listen <name>` puts a Claude session into listener mode |
| **Bus storage** | `~/.agent-bus/bus.db` (SQLite WAL) | Messages, agents, subscriptions, threads — persistent |

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

- **Names are addresses.** Each session registers a unique name. Other
  sessions reach it by name.
- **Push = blocking inbox.** A session in listener mode calls
  `inbox(wait_s=110)`. The MCP polls SQLite every 50 ms; the moment a row
  addressed to that name appears, the call returns. From the listener's
  perspective, it's push.
- **At-least-once delivery (opt-in).** Pass `claim_s` to `inbox` and the
  message stays `pending` (invisible to other readers) until you `ack()` it.
  If you crash mid-processing, the claim expires and the message reappears.
- **Threads.** Every message carries a `thread_id`. Auto-generated unless
  you pass one. Replies inherit. View the whole chain with the `thread` tool.
- **Channels (1-to-many).** `subscribe(agent, channel)`, then anyone can
  `send_channel(channel, message)` to fan out to every subscriber.
- **Capability routing.** `ask_best(capability, question)` picks the most
  recently-active agent that has that capability tag and routes there.
- **Persistent.** Restart any session — name, capabilities, pending
  messages, subscriptions are all still in the DB.
- **No cap on message size on the bus.** SQLite TEXT goes to ~1 GB. The
  practical ceiling is whatever your MCP client tolerates per tool result
  (Claude Code is ~1 MB). For multi-MB payloads, write to a file and send
  the path.

## Install (one-time)

```bash
git clone <this-repo>
cd agent-bus
npm install
npm run build
npm link
```

Add it to Claude Code at user scope (every project sees it):

```bash
claude mcp add -s user agent-bus -- agent-bus-mcp
```

Add it to Codex (CLI and Desktop share `~/.codex/config.toml`):

```toml
[mcp_servers.agent-bus]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/agent-bus/dist/mcp/server.js"]
```

Absolute paths matter for Codex Desktop, which doesn't inherit your
shell PATH.

## Daily usage

**Listener** (sits silently, handles incoming work):

```
/listen alpha
```

For Codex or any non-Claude-Code agent:

```bash
agent-bus listen-prompt my-codex | pbcopy
# paste into the agent's chat
```

**Sender** (talks to a listener):

```
Use agent-bus to register me as "human". Send alpha: "<task>".
Then call inbox(wait_s=30) to wait for the reply.
```

**Capability-based routing** (don't know who to ask):

```
Use agent-bus to ask_best capability="react" question="how do I memoize this list?".
```

**Broadcast to a team channel:**

```
Subscribe me to channel "frontend-team", then send_channel "frontend-team": "PR #142 needs review".
```

**Observer** (you, watching):

```bash
agent-bus watch
```

**One-off poke without any Claude/Codex session:**

```bash
agent-bus inject --from me --to alpha "hello"
```

## The 20 MCP tools

| Tool | Use |
|---|---|
| `register(name, capabilities?, replace?)` | Claim a name. Capabilities power `ask_best`. |
| `send(from, to, message, thread_id?)` | Fire-and-forget direct message. |
| `inbox(agent, wait_s?, claim_s?, since_id?, limit?)` | Read pending messages. `wait_s` blocks until first arrival; `claim_s` enables at-least-once. |
| `ack(agent, message_id)` | Acknowledge a claimed message — closes the claim, prevents redelivery. |
| `ask(from, to, question, timeout_s?, thread_id?)` | Synchronous request, blocks up to 110 s. |
| `ask_best(from, capability, question, timeout_s?)` | Route an ask to the best-matching active agent. |
| `reply(from, ask_id, answer)` | Close an `ask`. Inherits the thread. |
| `subscribe(agent, channel)` | Join a channel. |
| `unsubscribe(agent, channel)` | Leave a channel. |
| `send_channel(from, channel, message)` | Broadcast — fans out to every subscriber (sender excluded). |
| `subscribers(channel)` | List who's on a channel. |
| `thread(thread_id, limit?)` | Read every message in a conversation. |
| `whois()` | List every agent + capabilities + last-seen. |
| `recent(limit?)` | Catch up on the bus regardless of recipient. |
| `create_task(requested_by, title, ...)` | Create a first-class work item in `open` state. |
| `claim_task(agent, task_id)` | Atomically claim an open, unheld task. |
| `update_task(agent, task_id, ...)` | Move a task through strict states or update task metadata. |
| `release_task(agent, task_id)` | Return a non-terminal task to `open`. |
| `list_tasks(filters?)` | List active or filtered tasks, including stale holder detection. |
| `get_task(task_id)` | Fetch one task by id. |

## CLI

```bash
agent-bus watch                                 # live tail
agent-bus log -n 100                            # last N messages
agent-bus whois                                 # who's online
agent-bus tasks [--state working] [--all]       # task snapshot
agent-bus tasks --watch                         # live task changes
agent-bus inject --to <agent> "<message>"       # human relay
agent-bus pause <agent>                         # queue without delivering
agent-bus resume <agent>
agent-bus register --name <name> [--replace]
agent-bus listen-prompt <name>                  # print listener-mode prompt for any MCP agent
agent-bus install-hook --agent <name>           # Claude Code Stop hook: auto-inbox + listener auto-resume
agent-bus uninstall-hook
agent-bus mark-listening --session <id> --agent <name>      # used internally by /listen
agent-bus unmark-listening --session <id>
```

## Message lifecycle

```
                send()              inbox()                          reply()
   nothing  ──────────►  pending  ────────►  delivered             ────────►  answered
                                ▲      └────────────────────────────►
                                │              claim_s+ack pattern
                                │
                                │ (claim expired without ack)
                                └─── pending (redelivered)
```

- `pending`: not yet read.
- `delivered`: read successfully (the default for `inbox` without `claim_s`,
  or after `ack`).
- `answered`: only for `ask` messages — set when `reply()` closes the ask.

## Listener resilience

Two layers keep a listener alive:

1. **In-loop wait.** `/listen alpha` runs the inbox loop with `wait_s=110`,
   so Claude sits in a single blocking tool call until a message lands.
2. **Stop hook auto-resume.** If you also ran
   `agent-bus install-hook --agent alpha` (recommended), and the session
   somehow falls out of the loop, the hook detects "this session is in
   listener mode" and re-injects a "continue listening" prompt. Combined,
   the listener stays alive across both normal operation and edge cases.

## Comparison to Anthropic's Claude Code Teams

| Capability | Claude Code Teams | agent-bus |
|---|---|---|
| Named, addressable agents | yes | yes |
| Multi-hop A→B→C messaging | yes | yes |
| Persistent identity | no (team dies with parent) | yes (SQLite survives) |
| Auto-delivery to receiver | yes (server orchestrator) | yes via blocking `inbox(wait_s)` |
| Mid-execution interrupt | yes (only Anthropic can) | no |
| Works across Claude + Codex + any MCP client | no (Claude only) | yes |
| At-least-once delivery (ack/retry) | no explicit semantic | yes via `claim_s` + `ack` |
| Channels / fan-out | no | yes |
| Capability routing | no | yes (`ask_best`) |
| Cost | per-session billing | free |
| Requires internet | yes | no |

## Limits

- One machine. No cloud, no auth.
- `ask` is capped at **110 s** (Claude Code's tool timeout). For longer
  waits use `send` + `inbox(wait_s)`.
- `ask` refuses to create cycles (A asks B while B has a pending ask to A).
- Pull-based delivery into idle receivers. Use `/listen` or install the
  Stop hook for near-instant pickup.

## Storage

Everything lives in `~/.agent-bus/bus.db` (override with `AGENT_BUS_DIR`).
SQLite WAL mode, so many sessions can read/write concurrently with no
daemon.

## Tuning

Environment variables you can set on the MCP server process:

| Variable | Default | Effect |
|---|---|---|
| `AGENT_BUS_DIR` | `~/.agent-bus` | Where `bus.db` and listener markers live |
| `AGENT_BUS_POLL_MS` | `50` | How often the bus checks SQLite while a listener is blocked in `inbox(wait_s)`. Lower = faster pickup, more IO. Floor is 5 ms. |

For Claude Code, set via `claude mcp add -s user agent-bus -e AGENT_BUS_POLL_MS=10 -- agent-bus-mcp`.
For Codex, add `env = { AGENT_BUS_POLL_MS = "10" }` to the `[mcp_servers.agent-bus]` block in `~/.codex/config.toml`.

**Don't lower `wait_s`** in your listener prompt — it's a per-call max, not a polling cadence. Bigger `wait_s` (up to 110) is better because it keeps the agent in one tool call without per-turn Claude reasoning overhead.

## Documentation

| For | Read |
|---|---|
| Humans | [`docs/`](docs/) — install, concepts, tool reference, CLI reference, patterns, architecture, troubleshooting |
| LLMs / agents | [`llms.txt`](llms.txt) — single-file context for agents using the bus |
| Contributors | [`AGENTS.md`](AGENTS.md) — codebase layout and rules for editing `src/` |

## License

MIT.
