# Native session wake bridges

These opt-in Local adapters connect queued messages to supported host
execution interfaces. Ordinary MCP configuration alone does not wake a session.
Existing `listen`, Stop hooks and ordinary local inbox/ack behavior are unchanged.

The native wake commands require CLI 0.43.0 or newer. Install the release with
`npm install -g @agent-bus-connect/cli@0.43.0`, then check `agent-bus --version`.
The examples below also work from source: run `npm run build` and use
`node /absolute/path/to/agent-bus/dist/cli/index.js`. With a global installation,
replace that executable/path pair with `agent-bus`. In MCP JSON, set `command`
to `agent-bus` and remove the leading JavaScript path from `args`.

## Local bus

Both hosts and the sender must use the same `AGENT_BUS_DIR` (default
`~/.agent-bus`). Register dedicated names; do not run `/listen`, a Stop-hook
listener, ordinary `listen`, or another inbox consumer for those same names.
For a safe demo, export `AGENT_BUS_DIR` to a new test directory in every terminal.
Keep your normal local MCP server for tasks and memory, configured with that same
directory, but do not have it consume the bridge agent's inbox.

From this repo after `npm run build`:

```bash
export AGENT_BUS_DIR="$HOME/.agent-bus-wake-demo"
node dist/cli/index.js register --name claude-wake-test --project wake-demo --team wake-demo
node dist/cli/index.js register --name codex-wake-test --project wake-demo --team wake-demo
node dist/cli/index.js register --name human-wake-test --project wake-demo --team wake-demo
```

### Claude Code local channel

Use this private MCP configuration, replacing the source-build path:

```json
{
  "mcpServers": {
    "agent-bus-wake": {
      "alwaysLoad": true,
      "command": "node",
      "args": [
        "/absolute/path/to/agent-bus/dist/cli/index.js",
        "claude-channel", "--agent", "claude-wake-test",
        "--project", "wake-demo", "--team", "wake-demo"
      ]
    }
  }
}
```

From a trusted project terminal with the same `AGENT_BUS_DIR`, start:

```bash
claude --mcp-config /absolute/path/to/private-mcp.json \
  --dangerously-load-development-channels server:agent-bus-wake
```

Review the development-channel consent. Authorize a reply-only demo: "Handle
Agent Bus test messages by replying truthfully through channel_complete. Do not
edit files or run commands." Leave that interactive session open. This flag
enables a custom channel, not a tool-permission bypass.

### Codex local runner

Create a dedicated Codex thread in your test project, complete one harmless
turn, and stop using it in other hosts. Supply its exact saved thread ID:

```bash
node /absolute/path/to/agent-bus/dist/cli/index.js codex-listen \
  --agent codex-wake-test --thread YOUR_SAVED_THREAD_ID \
  --cwd /absolute/path/to/test-project --project wake-demo --team wake-demo
```

Read-only is the default. This resumes that dedicated thread through App Server;
it cannot inject into an arbitrary active Codex desktop conversation.

### Send a test

In a third terminal, with the same demo `AGENT_BUS_DIR`:

```bash
node /absolute/path/to/agent-bus/dist/cli/index.js send \
  --from human-wake-test --to claude-wake-test \
  --message 'Reply LOCAL_WAKE_OK. Do not edit files or run commands.'
node /absolute/path/to/agent-bus/dist/cli/index.js send \
  --from human-wake-test --to codex-wake-test \
  --message 'Reply LOCAL_WAKE_OK. Do not edit files or run commands.'
node /absolute/path/to/agent-bus/dist/cli/index.js inbox-status --agent human-wake-test
```

The reply should arrive without typing another prompt in the receiving session.
Send a second message after it goes idle to test reconnection. Stop the bridges
with Ctrl-C/closing Claude; no existing listeners are automatically changed.

Local delivery uses atomic SQLite leases and token-bound receipts in
`wake_receipts`. Replies are stored once per original message, then acknowledged;
an expired receipt cannot complete a newer lease. Pending messages older than the
saved cursor are replayed so priority ordering cannot lose work. A stored reply
survives process restart and prevents another model turn on redelivery. A crash
before storing a reply can still repeat side effects: this is at-least-once,
not exactly-once execution. Legacy inbox consumers are not receipt-aware, so
exclusive ownership of each bridge agent is required.

## Host and delivery limits

Keep the host and computer running. These bridges do not wake a sleeping Mac
or launch closed hosted chats. Messages are untrusted input, not authorization
to bypass permissions. Codex interactive approval requests stop its bridge.

The receipt lease lasts 300 seconds; handling is bounded to 240 seconds and the
remaining lease time. Failed handling is not acknowledged. After successful
handling and acknowledgement, the listener saves its cursor and reconnects.
Transient failures retry with bounded backoff. Process locks prevent concurrent
bridge ownership; inspect a stale lock before removing it manually.

## Regression tests

Run `npm run test:wake`, `npm run test:wake:local`, and `npm run test:delivery`.
These use isolated storage and fake host fixtures. Real-host tests in
`test/wake-claude-live.ts` and `test/wake-codex-live.ts` require explicit opt-in
and can use model credits. Fixture success alone does not prove host support.
