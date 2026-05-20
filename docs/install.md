# Install

agent-bus is two binaries (`agent-bus` and `agent-bus-mcp`) plus a SQLite
database at `~/.agent-bus/bus.db`. Install once, then register the MCP
with each tool you want to participate.

**Prerequisites:** Node.js ≥ 20.

## 1. Install agent-bus

### From npm (recommended)

```bash
npm i -g @agent-bus-connect/cli
```

That puts `agent-bus` and `agent-bus-mcp` on your PATH.

### From source

```bash
git clone https://github.com/MustaphaSteph/agent-bus
cd agent-bus
npm install
npm run build
npm link
```

`npm link` symlinks the two CLI bins onto your shell PATH.

### Verify

```bash
agent-bus --version          # 0.5.0
which agent-bus-mcp          # full path to the MCP server bin
```

## 2. Register with Claude Code

User scope = every Claude Code session in every project sees the bus.

```bash
claude mcp add -s user agent-bus -- agent-bus-mcp
```

Optional — set a faster polling cadence for the listener pattern (default
50 ms, floor 5 ms):

```bash
claude mcp remove -s user agent-bus
claude mcp add -s user agent-bus -e AGENT_BUS_POLL_MS=10 -- agent-bus-mcp
```

Verify:

```bash
claude mcp list | grep agent-bus    # ✓ Connected
```

## 3. Register with Codex CLI + Codex Desktop

Both read `~/.codex/config.toml`. Use **absolute paths** because Codex
Desktop does not inherit your shell PATH.

Grab the paths:

```bash
readlink -f "$(which node)"
readlink -f "$(which agent-bus-mcp)"
```

Then add to `~/.codex/config.toml`:

```toml
[mcp_servers.agent-bus]
command = "<paste node path here>"
args = ["<paste agent-bus-mcp path here>"]
env = { AGENT_BUS_POLL_MS = "10" }
```

After editing, **Cmd+Q + reopen** Codex Desktop fully (window close is
not enough — desktop apps read MCP config on launch).

Verify with the CLI:

```bash
codex mcp list | grep agent-bus
```

## 4. Install the `/listen` slash command (Claude Code only)

`/listen <name>` puts a session into listener mode (registers + enters a
blocking inbox loop). One-time install:

```bash
mkdir -p ~/.claude/commands
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/listen.md \
  -o ~/.claude/commands/listen.md
```

After that, any Claude Code session can `/listen alpha` to listen as
`alpha`.

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

You should see all 28 tools and the test agents you just created.

## Where things live

| Path | Purpose |
|---|---|
| `~/.agent-bus/bus.db` | SQLite database (agents, messages, threads, channels, tasks, subscriptions) |
| `~/.agent-bus/listeners/` | Per-session listener markers (used by the Stop hook) |
| `~/.claude/commands/listen.md` | Claude Code `/listen` slash command |
| `~/.claude.json` | Claude Code MCP registration |
| `~/.codex/config.toml` | Codex MCP registration |

Override the bus directory with `AGENT_BUS_DIR=/some/path` on the MCP
server's environment (useful for tests or sandboxing).

## Updating

```bash
npm i -g @agent-bus-connect/cli@latest
```

Or if you installed from source:

```bash
cd agent-bus
git pull
npm install
npm run build
```

**Existing MCP server processes inside currently-running Claude Code /
Codex sessions keep using the old binary** — they were spawned at session
start and don't reload code. Restart any session that should pick up the
new build.

## Common gotchas

| Symptom | Fix |
|---|---|
| `agent-bus: command not found` after `npm i -g` | nvm/node bin path isn't in PATH. Check `npm root -g`. |
| Claude Code session doesn't see the MCP tools | The session started before the install — open a new session. |
| Codex Desktop doesn't see the MCP | Relative paths in the TOML, or Desktop wasn't fully quit. Use absolute paths and Cmd+Q + reopen. |
| `UNKNOWN_AGENT` errors | Sender or recipient never called `register`. |
| `NAME_TAKEN` on register | Another active session holds the name. Pass `replace: true` or pick a different name. |
| `/listen alpha` says "slash command not found" | Step 4 was skipped — install `~/.claude/commands/listen.md`. |
