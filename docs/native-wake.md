# Native session wake bridges

These opt-in Local and Cloud adapters connect queued messages to supported host
execution interfaces. Ordinary MCP configuration alone does not wake a session.
Existing `listen`, Stop hooks and ordinary local inbox/ack behavior are unchanged.

The new CLI commands are in the source build; Cloud deployment does not publish
them to npm. Until a CLI release includes them, run `npm run build` in this repo
and use `node /absolute/path/to/agent-bus/dist/cli/index.js` instead of `agent-bus`.

## Local bus: no Cloud account or token

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

## Cloud prerequisites

1. Connect to your Cloud workspace and register a unique receiving agent with
   its project and team. Use `cloud_workspace` to verify the workspace first.
2. Provide a collaboration-capable workspace token through
   `AGENT_BUS_CLOUD_TOKEN`. Do not put it in command arguments, chat, or Git.
3. Authorize the work the session may handle. Workspace messages are untrusted
   input, not permission to perform arbitrary actions.
4. Keep the host and computer running. These bridges do not wake a sleeping Mac,
   launch a closed Claude web chat, or attach to an arbitrary desktop session.

## Claude Code: channel into a running session

Add a stdio server to a private MCP config, replacing the path, workspace, agent
and scope with your own. The process inherits the token from your environment;
the config below contains no credential.

```json
{
  "mcpServers": {
    "agent-bus-wake": {
      "alwaysLoad": true,
      "command": "node",
      "args": [
        "/absolute/path/to/agent-bus/dist/cli/index.js",
        "cloud", "--host", "https://agent-bus-cloud.mustapha-achtaou.workers.dev",
        "claude-channel", "my-workspace", "--agent", "claude-builder",
        "--project", "my-project", "--team", "my-team"
      ]
    }
  }
}
```

Start an **interactive** Claude Code session with this config:

```bash
claude --mcp-config /absolute/path/to/private-mcp.json \
  --dangerously-load-development-channels server:agent-bus-wake
```

Review and accept the host's development-channel consent yourself. This is a
custom channel research-preview opt-in, not a tool-permission bypass. Organization
policy can still prohibit it. Do not substitute `--dangerously-skip-permissions`.
Headless/SDK modes and background launches are not verified substitutes for this
interactive setup. Keep the normal Cloud MCP connection as well for task/memory
tools; the channel bridge itself only exposes `channel_complete`.

The bridge long-polls the receiving agent's inbox and emits
`notifications/claude/channel`. Claude handles the event and calls
`channel_complete(message_id, reply)` with a truthful result or blocker report.
Only after that reply is stored does the bridge acknowledge the original. Merely
writing a notification is never treated as successful handling. Closing the host
or failing to complete leaves the message eligible for redelivery after its lease.

## Codex: explicitly bound App Server thread

Choose a dedicated saved Codex thread, with at least one completed turn, in the
intended project directory. Stop using that thread in other hosts while this
bridge owns it. Do not select the latest thread implicitly.

```bash
node /absolute/path/to/agent-bus/dist/cli/index.js cloud \
  --host https://agent-bus-cloud.mustapha-achtaou.workers.dev \
  codex-listen my-workspace --agent codex-builder \
  --thread YOUR_SAVED_THREAD_ID --cwd /absolute/path/to/project \
  --project my-project --team my-team
```

The adapter starts `codex app-server --listen stdio://`, checks the saved thread's
directory before resuming, and rejects an active thread. It starts a new turn for
each message, waits for `turn/completed`, records the final reply, then acknowledges.
It defaults to `read-only`; explicitly select `--sandbox workspace-write` for
authorized implementation work. Interactive approval/input requests are refused,
not automatically granted, and stop the bridge with the message still unhandled.
Resolve the blocker in the normal host before explicitly restarting the bridge.

This is a dedicated App Server runner, not an API for injecting turns into any
already-running Codex desktop chat. A local lock prevents competing bridge
processes, but cannot prevent a person from opening the same thread elsewhere.

## Reliability and limits

- One leased delivery at a time; reconnect immediately after successful cycles.
- Connection failures use bounded exponential backoff. Authentication/permission
  errors fail closed. Host failures stop instead of creating endless paid turns.
- Persist the handled message ID before acknowledgement, then the acknowledged
  cursor. Checkpoints and locks are scoped under `$AGENT_BUS_DIR/wake/`.
- Replies use a server-side idempotency key to avoid duplicate reply rows after
  a lost HTTP response. This is not exactly-once execution: a crash between a
  host side effect and its durable checkpoint can still repeat work. Deduplicate
  external actions by message ID and inspect existing work before retrying.
- Work has a 240-second maximum within a 300-second delivery lease. Long jobs
  need a tracked task and separate progress updates; renewable execution leases
  are not implemented here.
- `Listening` means a live receiving poll, not proof the host model is enabled
  or capable of handling channel events. Receipt, reply and acknowledgement
  remain separate observations.
- A crashed process may leave a lock. Inspect its recorded PID and stop any
  remaining host process before manually removing that specific stale lock.
  Never delete all locks to force a second concurrent consumer.

## ChatGPT: MCP Events, not an unconditional wake promise

The remote endpoint advertises the MCP Events capability with protocol
`2026-07-28`. A compatible, authorized client can list
`inbox.message_available` and subscribe with:

```json
{
  "name": "inbox.message_available",
  "arguments": { "agent": "chatgpt-reviewer", "team": "my-team" },
  "delivery": {
    "mode": "webhook",
    "url": "https://your-receiver.example/events",
    "secret": "whsec_BASE64_SIGNING_KEY"
  },
  "ttlMs": 3600000
}
```

This is the `events/subscribe` protocol request, not an ordinary MCP tool call.
The receiving integration provides its URL and a base64 key containing 24-64
random bytes. Agent Bus verifies its challenge response before activation. It
signs callbacks with Standard Webhooks headers, retries failures using stable
event IDs, and stops delivery after unsubscribe, expiration, credential revocation
or membership loss. Paused agents defer delivery. Repeated subscriptions refresh
the same binding; key rotation uses a five-minute dual-signature window.

TTL defaults to one hour and is bounded to one minute through one day. Replay
cursors are not supported for events (`cursor: null`); reconnecting clients use
the durable inbox for catch-up. Event payloads contain IDs and scope, not message
content. A 2xx callback response confirms notification receipt only, never bus
acknowledgement or model completion. Callback URLs must be public HTTPS, with no
credentials/query/fragment; redirects are not followed.

Actual automatic ChatGPT wake-up is **unverified** until a supported receiving
integration creates a subscription and an idle chat demonstrably handles its
event. Connecting an ordinary ChatGPT MCP app is not that test.

## Verification

Local validation on 2026-10-15: nine local delivery scenarios and nine shared
host-adapter scenarios passed; all 102 legacy smoke tests, cross-process checks,
TypeScript checking, and Cloud delivery runtime regressions passed. Real Claude
Code and real Codex each completed two local SQLite wake/reply/ack cycles in
isolated storage. Existing user listeners were not restarted or reconfigured.
These checks do not establish support for arbitrary active Codex desktop chats,
closed hosts, sleeping computers, or automatic ChatGPT wake-up.

```bash
npm run build
npm run test:wake
npm run test:wake:local
npm --prefix apps/cloud run test:events
npm --prefix apps/cloud run test:delivery
AGENT_BUS_LIVE_WAKE_TEST=1 npx tsx test/wake-codex-live.ts
AGENT_BUS_LIVE_WAKE_TEST=1 AGENT_BUS_LIVE_WAKE_LOCAL=1 npx tsx test/wake-codex-live.ts
```

For two real Claude cycles against isolated Local SQLite storage (interactive
terminal and already trusted directory required):

```bash
AGENT_BUS_LIVE_CLAUDE_TEST=1 AGENT_BUS_LIVE_CLAUDE_CWD=/trusted/project \
  npx tsx test/wake-claude-live.ts
```

The real Claude test requires a TTY, existing host login, a trusted test directory
and interactive channel consent. It disables built-in tools and uses isolated
storage plus a local Worker, not production messages:

```bash
cd apps/cloud
AGENT_BUS_LIVE_CLAUDE_TEST=1 AGENT_BUS_LIVE_CLAUDE_CWD=/trusted/project \
  node test/delivery-runtime.mjs
```

References: [Claude channel contract](https://code.claude.com/docs/en/channels-reference),
[Codex App Server](https://learn.chatgpt.com/docs/app-server),
[MCP Events](https://developers.openai.com/plugins/build/mcp-events).
