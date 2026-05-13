# Install

agent-bus is two binaries (`agent-bus` and `agent-bus-mcp`) plus a SQLite
database at `~/.agent-bus/bus.db`. Install once, then add to each MCP
client you want to participate.

## 1. Build and link

```bash
git clone <repo-url> agent-bus
cd agent-bus
npm install
npm run build
npm link
```

`npm link` symlinks the two CLI bins (`agent-bus`, `agent-bus-mcp`) onto
your shell PATH. Verify:

```bash
which agent-bus
which agent-bus-mcp
agent-bus --version
```

## 2. Add to Claude Code

Register the MCP at **user scope** so every Claude Code session in every
project sees the bus.

```bash
claude mcp add -s user agent-bus -- agent-bus-mcp
```

Optional but recommended — set a faster polling cadence for the listener
pattern:

```bash
claude mcp remove -s user agent-bus
claude mcp add -s user agent-bus -e AGENT_BUS_POLL_MS=10 -- agent-bus-mcp
```

Verify:

```bash
claude mcp list | grep agent-bus
```

## 3. Add to Codex (CLI + Desktop)

Both Codex CLI and Codex Desktop read `~/.codex/config.toml`. Append an
`[mcp_servers.agent-bus]` block with **absolute paths** — Codex Desktop
does not inherit your shell PATH.

Find the absolute paths to your node and to `agent-bus-mcp`:

```bash
readlink -f "$(which agent-bus-mcp)"
readlink -f "$(which node)"
```

Then edit `~/.codex/config.toml` (or whatever the equivalent on your
system) to add:

```toml
[mcp_servers.agent-bus]
command = "/absolute/path/to/node"
args = ["/absolute/path/to/agent-bus/dist/mcp/server.js"]
env = { AGENT_BUS_POLL_MS = "10" }
```

Restart Codex Desktop (Cmd+Q + reopen). Verify with Codex CLI:

```bash
codex mcp list | grep agent-bus
```

## 4. Install the `/listen` slash command (Claude Code only)

If you cloned this repo, copy the slash command into your global Claude
Code commands directory:

```bash
mkdir -p ~/.claude/commands
cp <repo>/docs/commands/listen.md ~/.claude/commands/listen.md
```

The repository already ships `~/.claude/commands/listen.md` on this
machine; if you're setting up a new machine, get it from
[patterns.md](patterns.md#listener-mode).

## 5. (Optional) Install the Stop hook

Adds turn-end auto-inbox + listener-resume so a Claude Code session that
falls out of the listener loop auto-recovers.

```bash
agent-bus install-hook --agent <your-agent-name>
```

Removes it later with:

```bash
agent-bus uninstall-hook
```

## 6. Smoke test

In one terminal:

```bash
agent-bus watch
```

In another:

```bash
agent-bus register --name test-a --replace
agent-bus register --name test-b --replace
agent-bus inject --from test-a --to test-b "hello"
```

The watcher should show the message. If it does, the bus itself works.

To test that an MCP client sees the bus, open a new Claude Code or Codex
session and ask:

```
List the agent-bus MCP tools and call whois.
```

You should see all 20 tools and the test agents you just created.

## Where things live

| Path | Purpose |
|---|---|
| `~/.agent-bus/bus.db` | SQLite database (messages, agents, subscriptions) |
| `~/.agent-bus/listeners/` | Per-session listener markers (used by the Stop hook) |
| `~/.claude/commands/listen.md` | Claude Code slash command |
| `~/.claude.json` | Claude Code MCP registration |
| `~/.codex/config.toml` | Codex MCP registration |

Override the bus directory with `AGENT_BUS_DIR=/some/path` on the MCP
server's environment (useful for tests or sandboxing).

## Updating

When this repository is updated:

```bash
cd agent-bus
git pull
npm install
npm run build
```

The MCP server processes inside currently-running Claude Code / Codex
sessions are using the old binary. Restart any session that should pick
up the new code.
