# Troubleshooting

Common symptoms and what to do.

## "MCP server failed: ENOENT"

`ENOENT` means Claude Code tried to spawn the MCP server command and
the operating system could not find that executable. The agent-bus
plugin declares an MCP command named `agent-bus-mcp`; the plugin does
not bundle the npm CLI binary itself.

Fix:

```bash
npm i -g @agent-bus-connect/cli@latest
which agent-bus-mcp
agent-bus --version
```

Then reconnect the MCP in Claude Code (`/mcp` → reconnect) or restart
Claude Code so it respawns the server with the updated PATH.

If `which agent-bus-mcp` prints nothing after install, your global npm
bin directory is not on PATH. Check `npm root -g` and add the matching
bin directory to your shell startup file.

## "agent-bus X is older than required Y" after installing latest

If the setup checker still fails after
`npm i -g @agent-bus-connect/cli@latest`, compare the skill minimum
with the published npm version:

```bash
npm view @agent-bus-connect/cli version
grep MIN_AGENT_BUS ~/.claude/skills/agent-bus/scripts/check-setup.sh
```

If npm's latest version is lower than `MIN_AGENT_BUS`, the plugin/skill
was released ahead of the CLI package. Publish the required
`@agent-bus-connect/cli` version first, or use a plugin/skill version
whose minimum matches the latest published CLI.

## "MCP agent-bus tools don't show up in my session"

The MCP wasn't loaded when this session started. MCP config is read
once at session boot.

Fix:

- Open a **new** session (`claude` or fresh Codex chat).
- Or, in the current session, `/exit` and `claude --resume` to reload
  config while keeping history.

Verify with `claude mcp list | grep agent-bus` — must show
`✓ Connected`.

## "UNKNOWN_AGENT: 'X' is not registered"

You sent to a name that's not in `agents`. Either you typoed it, or
that agent's session never called `register`.

Fix: in the target session, run `register({ name: "X" })` first. Or
from a shell: `agent-bus register --name X --replace`.

## "NAME_TAKEN: agent 'X' is active"

You tried to register a name that another session is actively using
(last_seen within 60 s). Pass `replace: true` to take it over.

Fix:

```
register({ name: "X", replace: true })
```

Or from a shell: `agent-bus register --name X --replace`.

## "ASK_TIMEOUT after 60s"

The recipient didn't `reply` within the timeout. Causes:

- Recipient session is idle (not in `/listen` mode, no Stop hook
  installed). Open their session and tell them "check inbox".
- Recipient is in listener mode but their reasoning + tool round-trip is
  taking too long. Increase the asker's `timeout_s` (max 110), or split
  the work into smaller `send` calls without expecting a sync reply.
- Recipient ran into an error. Check `agent-bus log -n 20` to see if
  they responded with anything at all.

## "ASK_RECIPIENT_UNAVAILABLE"

Blocking `ask` checks presence first. If the recipient is paused or has
not heartbeated recently, the bus refuses to burn the full wait window.

Fix: use `ask_async` if the answer can arrive later, `send` for a
fire-and-forget note, `delegate` for tracked work, or wake/start the
recipient session and ask again.

## "ASK_CYCLE: would deadlock"

You called `ask(to=B)` while B has a pending `ask` back to you. Bus
refuses to create the cycle.

Fix: respond to B's ask first (use `inbox` + `reply`), THEN ask your
question.

## Listener seems "stuck" / slow

Bus-side detection is `AGENT_BUS_POLL_MS` (default 50 ms). Total
round-trip latency is dominated by Claude's reasoning + tool overhead
per cycle, not the bus.

What you can do:

- Lower `AGENT_BUS_POLL_MS` to 10 (set via `claude mcp add -e` or
  Codex's `env` block).
- Use a faster model in the listener session (`/model haiku` in Claude
  Code).
- Tighten the listener prompt to discourage Claude from narrating
  empty timeouts. The shipped `/listen` slash command already does this.

## Listener falls out of the loop

Claude ended a turn instead of looping back. Two layers of defense:

1. Make sure you used `/listen` (the slash command marks the session as
   a listener).
2. Install the Stop hook: `agent-bus install-hook --agent <name>`. The
   hook detects listener-mode and re-injects a "continue listening"
   prompt at every turn end.

If both are in place and it still drops out, check
`~/.agent-bus/listeners/` to confirm the marker exists for your
session. Marker file name uses `$CLAUDE_SESSION_ID`.

## "MESSAGE_TOO_LARGE" (no longer happens, but if you see it)

You're on the old v0.1.0 build. Restart your sessions; the MCP
processes are pinned to whatever code was on disk when they spawned.
v0.2.0 removed the 256 KB cap.

## Codex Desktop doesn't see the MCP

Codex Desktop doesn't inherit your shell PATH. The config must use
**absolute paths** for `command` and `args`.

Fix:

```toml
[mcp_servers.agent-bus]
command = "/Users/you/.../node"   # absolute
args = ["/Users/you/.../agent-bus/dist/mcp/server.js"]   # absolute
```

Then **Cmd+Q + reopen** Codex Desktop fully. A window close isn't
enough.

## "I edited bus.ts but the listener still uses the old behavior"

The MCP server process is long-lived. Build (`npm run build`), then
**restart the consuming session**. New code only loads when Claude
Code / Codex spawns a fresh MCP process.

## I want to wipe the bus and start fresh

```bash
rm -rf ~/.agent-bus
```

Recreates on next MCP boot. Loses all messages, agents, and
subscriptions.

To wipe just messages but keep agents/subscriptions:

```bash
sqlite3 ~/.agent-bus/bus.db "DELETE FROM messages;"
```

## How do I know the bus actually wrote my message?

```bash
agent-bus log -n 10
```

Or watch live:

```bash
agent-bus watch
```

If you sent a message and don't see it in `log`, it didn't reach
SQLite. Most likely cause: the MCP call failed silently. Ask Claude to
show you the tool result; you'll see an `{error: {code, message}}`
body.

## Where do I report bugs?

Open an issue on the repo, include:

- agent-bus version (`agent-bus --version`)
- node version (`node --version`)
- MCP client (Claude Code X.Y, Codex CLI X.Y, etc.)
- Last 50 messages from `agent-bus log -n 50`
- Output of `claude mcp list` or the equivalent
