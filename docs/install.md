# Install

agent-bus installs in two steps: the **CLI** (one npm command) and the
**plugin** (one click in your tool). The plugin is how you install agent-bus —
it connects the MCP server *and* installs the bundled **skills**, the `/main`
and `/listen` **slash commands**, and the **listener Stop hook**. Those skills
are what teach your agents to use the bus well, so the plugin is the supported
path on every tool.

**Prerequisites:** Node.js ≥ 20.

> **TL;DR (Claude Code):**
> ```bash
> npm i -g @agent-bus-connect/cli@latest      # 1. install the CLI
> ```
> then in Claude Code: `/plugin` → add marketplace `MustaphaSteph/agent-bus-plugins` → install **agent-bus**. Done — MCP, skills, slash commands, and listener hook are all wired for you.

## 1. Install the CLI

**Install order matters:** install this npm CLI **first**, then the plugin.
The plugin only declares the MCP server *command* — the actual
`agent-bus-mcp` binary comes from this package. Install the plugin first and
your tool can fail with `ENOENT` because `agent-bus-mcp` isn't on PATH yet.

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
agent-bus --version                # 0.27.0
which agent-bus-mcp          # full path to the MCP server bin
```

## 2. Install the plugin

The plugin does all the wiring for you: it registers the MCP server, and
installs the **skills**, the **slash commands** (`/main`, `/listen`), and the
**listener Stop hook** — one step, nothing to edit by hand. It expects
`agent-bus-mcp` from step 1 to already be on PATH.

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

```bash
codex mcp list | grep agent-bus
```

### Cursor, Gemini CLI, Goose, OpenCode, Junie, Amp, Kiro (universal installer)

One script wires the MCP config and the bundled skills/commands for every
other MCP-speaking tool:

```bash
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus-plugins/main/install.sh | sh
```

Plugin source, the full list of supported tools, and per-tool notes live in the
[agent-bus-plugins repo](https://github.com/MustaphaSteph/agent-bus-plugins).

## 3. Smoke test

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

You should see all 65 tools and the test agents you just created.

## Where things live

| Path | Purpose |
|---|---|
| `~/.agent-bus/bus.db` | SQLite database (agents, messages, threads, channels, tasks, subscriptions) |
| `~/.agent-bus/listeners/` | Per-session listener markers (used by the Stop hook) |
| `~/.claude/commands/main.md` | Claude Code `/main` slash command (installed by the plugin) |
| `~/.claude/commands/listen.md` | Claude Code `/listen` slash command (installed by the plugin) |
| `~/.claude.json` | Claude Code MCP registration |
| `~/.codex/config.toml` | Codex MCP registration |

Override the bus directory with `AGENT_BUS_DIR=/some/path` on the MCP
server's environment (useful for tests or sandboxing).

## Updating

Update the CLI, then make sure the plugin is current in your tool's plugin UI:

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
| `/mcp` shows `ENOENT` for `agent-bus-mcp` | The plugin points at `agent-bus-mcp`, but the npm CLI isn't installed or isn't on your tool's PATH. Run `npm i -g @agent-bus-connect/cli@latest`, verify `which agent-bus-mcp`, then reconnect `/mcp` or restart the session. |
| Setup checker says `agent-bus X is older than required Y` after installing `latest` | The plugin/skill version is ahead of the published npm CLI. Verify with `npm view @agent-bus-connect/cli version`. Publish the required CLI version first, or install a plugin version whose `MIN_AGENT_BUS` matches the latest published CLI. |
| Session doesn't see the MCP tools | The session started before the install — open a new session. |
| Codex Desktop doesn't see the MCP | The plugin install didn't fully apply, or Desktop wasn't fully quit. Reinstall the plugin and Cmd+Q + reopen. |
| `UNKNOWN_AGENT` errors | Sender or recipient never called `register`. |
| `NAME_TAKEN` on register | Another active session holds the name. Pass `replace: true` or pick a different name. |
| `/listen alpha` says "slash command not found" | The plugin didn't install the slash commands — reinstall it (step 2). |
