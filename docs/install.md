# Install

agent-bus is two binaries (`agent-bus` and `agent-bus-mcp`) plus a SQLite
database at `~/.agent-bus/bus.db`. Install the CLI once, then connect each
tool you want on the bus — either with our **one-click plugin** (easiest)
or by registering the MCP **manually**.

**Prerequisites:** Node.js ≥ 20.

> **TL;DR (Claude Code):**
> ```bash
> npm i -g @agent-bus-connect/cli@latest      # 1. install the CLI
> ```
> then in Claude Code: `/plugin` → add marketplace `MustaphaSteph/agent-bus-plugins` → install **agent-bus**. Done — MCP, skill, slash commands, and listener hook are all wired for you.

## 1. Install agent-bus

**Install order matters:** install this npm CLI **first**, then the plugin.
The plugin only declares the MCP server *command* — the actual
`agent-bus-mcp` binary comes from this package. Install the plugin first and
Claude Code can fail with `ENOENT` because `agent-bus-mcp` isn't on PATH yet.

### From npm (recommended)

```bash
npm i -g @agent-bus-connect/cli@latest
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
agent-bus --version                # 0.23.1
which agent-bus-mcp          # full path to the MCP server bin
```

## 2. Install the plugin (recommended — the easy path)

The plugin/installer does the wiring for you: it registers the MCP server,
and installs the **skill**, the **slash commands** (`/main`, `/listen`), and
the **listener Stop hook** — all in one step. It expects `agent-bus-mcp`
from step 1 to already be on PATH.

**If you install the plugin, you can skip the manual sections 3–6 entirely.**

### Claude Code

In a Claude Code session:

```
/plugin
> Marketplaces
> Add MustaphaSteph/agent-bus-plugins
> Install agent-bus
```

Then confirm it connected:

```bash
claude mcp list | grep agent-bus    # ✓ Connected
```

### Codex CLI / Codex Desktop

In any terminal:

```bash
codex plugin marketplace add MustaphaSteph/agent-bus-plugins
```

Then install **agent-bus** from Codex's plugin UI. After installing, fully
**Cmd+Q + reopen** Codex Desktop (it reads MCP config on launch).

### Cursor, Gemini CLI, Goose, OpenCode, Junie, Amp, Kiro (universal installer)

One script wires the MCP config and bundled assets for every other
MCP-speaking tool:

```bash
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus-plugins/main/install.sh | sh
```

Plugin source, supported tools, and per-tool notes live in the
[agent-bus-plugins repo](https://github.com/MustaphaSteph/agent-bus-plugins).

---

Prefer to wire things up yourself, or on a tool the installer doesn't cover?
The manual steps below give you the exact same MCP connection without the
bundled skill and slash commands.

## 3. Register with Claude Code (manual)

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

## 4. Register with Codex CLI + Codex Desktop (manual)

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

## 5. Install the `/main` and `/listen` slash commands (Claude Code, manual)

> The plugin in step 2 already installs these. Only do this if you registered
> the MCP by hand.

- `/main <name>` puts a session into manager mode (talk to the bus in plain English).
- `/listen <name>` puts a session into listener mode (registers + enters a blocking inbox loop).

One-time install:

```bash
mkdir -p ~/.claude/commands
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/main.md   -o ~/.claude/commands/main.md
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/listen.md -o ~/.claude/commands/listen.md
```

After that, any Claude Code session can `/listen alpha` to listen as
`alpha`, or `/main pm` to drive the team as `pm`.

## 6. (Optional) Install the Stop hook (manual)

> The plugin in step 2 already installs this. Only do this if you registered
> the MCP by hand.

Adds turn-end auto-inbox + listener-resume so a Claude Code session that
falls out of the listener loop auto-recovers.

```bash
agent-bus install-hook --agent <your-agent-name>
```

Removes it later with:

```bash
agent-bus uninstall-hook
```

## 7. Smoke test

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

You should see all 62 tools and the test agents you just created.

## Where things live

| Path | Purpose |
|---|---|
| `~/.agent-bus/bus.db` | SQLite database (agents, messages, threads, channels, tasks, subscriptions) |
| `~/.agent-bus/listeners/` | Per-session listener markers (used by the Stop hook) |
| `~/.claude/commands/main.md` | Claude Code `/main` slash command |
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
| Claude Code `/mcp` shows `ENOENT` for `agent-bus-mcp` | The plugin config points at `agent-bus-mcp`, but the npm CLI package is not installed or is not on Claude Code's PATH. Run `npm i -g @agent-bus-connect/cli@latest`, verify `which agent-bus-mcp`, then reconnect `/mcp` or restart Claude Code. |
| Setup checker says `agent-bus X is older than required Y` after installing `latest` | The skill/plugin version is ahead of the published npm CLI. Verify with `npm view @agent-bus-connect/cli version`. Publish the required CLI version first, or install a plugin/skill version whose `MIN_AGENT_BUS` matches the latest published CLI. |
| Claude Code session doesn't see the MCP tools | The session started before the install — open a new session. |
| Codex Desktop doesn't see the MCP | Relative paths in the TOML, or Desktop wasn't fully quit. Use absolute paths and Cmd+Q + reopen. |
| `UNKNOWN_AGENT` errors | Sender or recipient never called `register`. |
| `NAME_TAKEN` on register | Another active session holds the name. Pass `replace: true` or pick a different name. |
| `/listen alpha` says "slash command not found" | Install the plugin (step 2), or do the manual step 5 — `~/.claude/commands/listen.md` is missing. |
