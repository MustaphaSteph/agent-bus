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

Two terminals running Claude Code have no built-in way to talk. You either
copy/paste, or you build a bus. This is the bus — one SQLite file is the
meeting room, one MCP server is the doorway, one CLI is the cockpit.

## Quickstart

```bash
git clone https://github.com/MustaphaSteph/agent-bus
cd agent-bus
npm install && npm run build && npm link

# Claude Code (user scope — every project sees it)
claude mcp add -s user agent-bus -- agent-bus-mcp
```

For Codex CLI and Desktop, see [`docs/install.md`](docs/install.md).

## Try it

Open two new Claude Code sessions.

**Terminal A** (the listener):

```
/listen alpha
```

**Terminal B** (the sender):

```
Use agent-bus to register me as "beta", then send alpha "what is 17 × 23?"
and wait for the reply with inbox(wait_s=30).
```

**Terminal C** (you, watching):

```bash
agent-bus watch
```

## What you get

- **20 MCP tools** — direct messages, synchronous ask/reply, channels (fan-out), capability routing, conversation threads, at-least-once delivery with claim+ack, and first-class tasks with strict state machine.
- **Cross-tool** — Claude Code, Codex CLI, Codex Desktop, and any MCP-speaking agent share the same bus.
- **Persistent** — agents, messages, channels, threads, and tasks survive restarts via SQLite WAL.
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
