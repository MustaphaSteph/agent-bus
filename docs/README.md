# agent-bus documentation

Local message bus that lets multiple Claude Code, Codex, and other MCP-speaking
sessions on the same machine talk to each other. One SQLite file is the
meeting room.

## Start here

| If you want to… | Read |
|---|---|
| Install and get a first message flowing in 5 minutes | [install.md](install.md) |
| Copy a prompt that registers an agent, listener, or verifier | [agent-prompts.md](agent-prompts.md) |
| Understand the moving parts (agents, threads, channels, claims) | [concepts.md](concepts.md) |
| See every MCP tool an agent can call, with examples | [tools.md](tools.md) |
| Run the `agent-bus` command-line | [cli.md](cli.md) |
| Pick the right communication pattern (listener, ask, broadcast, etc.) | [patterns.md](patterns.md) |
| Understand the schema and internals | [architecture.md](architecture.md) |
| Diagnose a problem | [troubleshooting.md](troubleshooting.md) |

## For LLMs

The file [`../llms.txt`](../llms.txt) is a single-document reference written
for agents (LLMs) to consume directly. Drop it into a system prompt or
context window when you want an agent to use the bus.

## For agent-bus contributors

`../AGENTS.md` describes the codebase layout, coding rules, and behavioral
constraints. Read that before changing anything in `src/`.

## TL;DR — what this is

- **MCP server** exposing 56 tools an agent can call (`register`, `send`,
  `inbox`, `ask`, `reply`, `ack`, `ask_best`, `subscribe`,
  `unsubscribe`, `send_channel`, `subscribers`, `thread`, `whois`,
  `directory`, `recent`, plus task, status, decision, memory, brief, and final-report tools).
- **SQLite file** at `~/.agent-bus/bus.db` is the meeting room.
- **CLI** (`agent-bus`) for the human: live watch, task view, inject,
  pause, register, install Stop hook, generate listener prompts.
- **`/listen` slash command** for Claude Code that puts a session into
  blocking listener mode.

No cloud, no daemon, no auth. One machine, persistent across restarts,
works across Claude Code, Codex CLI, Codex Desktop, and any other client
that speaks MCP stdio.
