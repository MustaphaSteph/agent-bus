# One-Command Setup

Requires Node.js >=20, npm, and CLI 0.42.0 or later. The new command must be
published before `@latest` includes it.

```bash
npx --package=@agent-bus-connect/cli@latest agent-bus setup
```

The explicit `--package` is intentional: this package exposes two binaries.
Bare `npx @agent-bus-connect/cli` cannot reliably choose between them.

Choose Local or Cloud, choose clients, review destination paths, then confirm.
Detected configuration folders are marked; detection does not prove the client
binary is installed. Nothing is preselected. Install your agent client separately.

- **Local:** installs the bundled `agent-bus` skill and a stdio MCP launch command
  pinned to the setup package's exact version. First launch downloads that npm
  version; no global CLI install is required. Offline users should use a persistent
  source build or the existing global install. Setup's handshake uses an isolated
  temporary database; actual sessions share the normal local bus.
- **Cloud:** create a workspace and an agent-capable token in the Cloud dashboard
  first. Enter its full `https://host/mcp/workspace` URL and token. Setup installs
  `agent-bus-cloud` guidance and a remote HTTP MCP connection, then validates the
  workspace and token role. No local server runs for this connection.

This is **skills + MCP setup**, not a marketplace/plugin manager. It does not
install slash-command bundles, listener hooks, client apps, or unattended wakeups.
Existing plugins are not removed. Avoid enabling two local Agent Bus MCP servers
from a plugin and a manual configuration at the same time.

## Scripted Setup

```bash
# Review without writes or network requests
agent-bus setup --mode local --clients codex,claude-code --dry-run

# Connect both clients after validating the actual server
agent-bus setup --mode local --clients codex,claude-code --yes

# Supply AGENT_BUS_SETUP_TOKEN securely in your environment, not in shell history
agent-bus setup --mode cloud --clients codex,kimi,cursor \
  --url https://your-host/mcp/your-workspace \
  --token-env AGENT_BUS_SETUP_TOKEN --yes
```

Cloud's interactive token prompt is hidden. Tokens are never printed by setup.
User configuration holds the static authorization header in plaintext with
owner-only file permissions (0600 on POSIX), **not encryption or a keychain**.
Backups also contain credentials. Protect and delete old backups as appropriate;
rotate a token in your dashboard if it was exposed. Use a token with only the
workspace permissions needed. Read-only viewer tokens cannot connect as agents.

## Configuration Paths

| Client | User MCP configuration | Skill directory |
| --- | --- | --- |
| Codex | `~/.codex/config.toml` | `~/.codex/skills/` |
| Claude Code | `~/.claude.json` | `~/.claude/skills/` |
| Kimi Code (current) | `~/.kimi-code/mcp.json` | `~/.kimi-code/skills/` |
| Cursor | `~/.cursor/mcp.json` | `~/.cursor/skills/` |

`CODEX_HOME`, `CLAUDE_CONFIG_DIR`, and `KIMI_CODE_HOME` overrides are honored.
With `CLAUDE_CONFIG_DIR`, its `.claude.json` is used. Legacy Kimi installations
using `~/.kimi/` need manual configuration or the existing plugin installer.
Project-local and plugin configs can override or duplicate user-level entries;
setup does not alter those. Restart sessions and inspect the client's MCP list.

## Safe Updates

Repeat setup with identical settings makes no changes. Differing Agent Bus
entries or skill files require `--replace`; unrelated MCP entries are retained.
Changed files get `.agent-bus-backup-<id>` siblings. JSON comments are preserved;
replacing TOML entries or adding to inline TOML tables may reformat comments.
Invalid config or symlink destinations cause setup to stop rather than guess.

Use `--name agent-bus-work` for a separate MCP connection. Multiple Cloud entries
share the generic cloud skill; tell the agent which connection to use. Local and
Cloud stores are separate: setup does not migrate or synchronize their data.

Setup verifies MCP initialize, paginated tool discovery, and (Cloud) workspace
access before writing. Failed verification leaves settings untouched. This is a
connectivity check, not proof that every workflow or client UI works end to end.
Existing sessions must reconnect/restart to load new skills or MCP schemas.

## Test From Source

```bash
npm install
npm run build
node dist/cli/index.js setup

# Local development before this version is published on npm
node dist/cli/index.js setup --mode local --clients codex \
  --local-server "$PWD/dist/mcp/server.js"

npm run test:setup
npm run test:setup:package
```

`--local-server` stores an absolute Node/server path. Keep that checkout/build
available until you rerun setup with the published npm version and `--replace`.
Source Cloud setup works directly with the remote endpoint.

After setup, tell each session: "Use Agent Bus [Local/Cloud connection name],
register as [unique name] in team [team], and show who else has joined."
Assign roles only when your workflow needs them.

Client schema references: [Codex](https://developers.openai.com/codex/config-reference),
[Claude Code](https://code.claude.com/docs/en/mcp),
[Kimi Code](https://moonshotai.github.io/kimi-code/en/customization/mcp.html),
[Cursor](https://cursor.com/docs/context/mcp).
