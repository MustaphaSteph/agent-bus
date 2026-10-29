# Local client setup

Requires Node.js 20 or newer and npm. The interactive wizard installs the Local
skill and configures MCP for Codex, Claude Code, Kimi Code, and Cursor:

```bash
npx --package=@agent-bus-connect/cli@latest agent-bus setup --mode local
```

Select your clients, review the destination paths, and approve the changes.
The wizard verifies the MCP connection using isolated temporary bus storage
before writing configuration. Restart or reconnect the selected clients.

## Non-interactive setup

```bash
agent-bus setup --mode local --clients codex,claude-code --dry-run
agent-bus setup --mode local --clients codex,claude-code --yes
```

`--dry-run` does not write files or connect. `--name` selects an MCP entry name.
`--replace` backs up differing Agent Bus entries and bundled skill files before
replacing them; unrelated entries are preserved. Existing invalid configuration,
symlink destinations, and concurrent changes cause setup to stop. Replacing TOML
entries may reformat comments; the original is backed up.

## Config paths

| Client | User configuration |
| --- | --- |
| Codex | `$CODEX_HOME/config.toml`, default `~/.codex/config.toml` |
| Claude Code | `~/.claude.json`, or `$CLAUDE_CONFIG_DIR/.claude.json` |
| Kimi Code | `$KIMI_CODE_HOME/mcp.json`, default `~/.kimi-code/mcp.json` |
| Cursor | `~/.cursor/mcp.json` |

Skills are installed under each client's corresponding `skills/agent-bus` folder.
Config and backup files are private to your user. Setup installs MCP and skills,
not marketplace plugins, listener hooks, or automatic wakeups. Project/plugin
settings may override user settings.

## Test from source

```bash
npm ci
npm run build
node dist/cli/index.js setup --mode local --clients codex,claude-code \
  --local-server "$PWD/dist/mcp/server.js" --yes
```

The source path must remain available after setup. Without `--local-server`, the
installer pins its own package version through npx; that version must be published.
For tests, use `npm run test:setup` and `npm run test:setup:package`, which isolate
client homes and bus storage instead of changing your real agent configuration.
