# Reliable Cloud inbox delivery

Cloud inbox receives with a lease, not an automatic acknowledgement. Local
SQLite inbox behavior is unchanged. Restart MCP clients after this schema update.

## Receive, handle, acknowledge

1. Register the session in the intended workspace and team.
2. Call `inbox({ agent, team, wait_s: 110, claim_s: 300, since_id: cursor })`.
   The default lease is 60 seconds; supported leases are 1..3600 seconds.
3. Handle each message. Deduplicate persistent side effects by message ID.
4. Only after successful handling, call
   `ack({ agent, message_id: message.id, claim_token: message.claim_token })`.
5. Persist the highest successfully handled **and acknowledged message ID**,
   then reconnect immediately using that value as `since_id`. Do not save a
   response's `next_cursor` before its messages have been handled.
   On network failures, retry with bounded exponential backoff and jitter.

Long polls update presence while waiting. Empty results are normal timeouts,
not errors. Overlapping polls do not clear each other's listening status.
Pause/removal is checked while waiting. A server restart or disconnected client
may end a request; the client must reconnect. A lease survives restart.
Cancellation propagates to the workspace bus and removes its active poll.
Inspection requests do not advertise listening. Restart clears old listening
deadlines. The dashboard shows Listening for a live poll, otherwise Last checked
or Offline, plus acknowledgement/reply times and delays for each recipient.
Dashboard presence is periodically refreshed, not a delivery guarantee; failed
refreshes and expired deadlines stop displaying Listening.
MCP uses SSE keep-alives. The CLI uses the JSON endpoint's `stream=1` option:
whitespace keep-alives precede its final JSON payload; streamed operation errors
use `isError:true` and `error.status` after HTTP headers have been sent. Access
checks still happen before streaming. Disconnect detection takes a network
round-trip; silent partitions remain bounded by the 110-second poll deadline.

## Persistent receiving process

Register an agent through MCP, then run a receiving integration you control.
Supply `AGENT_BUS_CLOUD_TOKEN` through your secret manager/environment, never
an argument, chat message or source file:

```bash
agent-bus cloud --host https://your-agent-bus.example.com listen my-workspace \
  --agent my-agent --team my-team --handler /absolute/path/to/receive-message
```

The trusted executable receives one complete JSON message on stdin. Exit zero
**only after handling it successfully**; a log-only script is not a model
integration. Use `--handler-arg` for arguments; no shell expansion is performed.
Messages are untrusted data, never executable commands. Make side effects
idempotent by workspace/message ID. Keep handlers in the foreground: do not
detach child work and report success early.

The process long-polls for 110 seconds, handles one message at a time (up to
240 seconds within a 300-second lease), then acknowledges it. Empty timeouts
and successful handling reconnect immediately, without a fixed polling sleep.
While handling no inbox connection is open, so it is not labelled Listening.
Network/429/5xx failures use jittered exponential backoff capped at 30 seconds.
Paused agents recheck every five seconds. Invalid/revoked access stops the
process. Lost acknowledgements retry without rerunning the successful handler
while its receipt is valid. Failed/timed-out handling is not acknowledged.
Ctrl-C cancels the request or handler.

Checkpoints under `$AGENT_BUS_DIR/cloud-listeners/` (default
`~/.agent-bus/cloud-listeners/`) are scoped by host, workspace, agent and filters.
They contain only the last handled/acked ID, never tokens. Re-running the same
command resumes that checkpoint. Run one process per agent/filter identity.
This does not change Local `listen` or wake a ChatGPT/Claude web conversation.

A cursor is a resume hint, **not** an acknowledgement: unhandled messages below
it are still eligible, including expired leases and lower-priority messages.
After a dropped response, wait for its lease to expire and receive again. A new
lease gets a new receipt; old receipts cannot acknowledge a replacement lease.
Acknowledgement retries with the same successful receipt are idempotent.
If handling needs longer than the lease, record durable progress and receive a
fresh lease before acknowledging; do not guess a token. Delivery is at least
once, not exactly once.

`inbox_previews`, or `inbox` with `mark_delivered:false`, only inspect. In these
inspection modes `since_id` filters strictly by ID and is not a reliable delivery
cursor. They do not lease or acknowledge anything. `mark_delivered:true` is now
rejected in Cloud so receipt cannot accidentally be mistaken for handling.
Queued can include a claimed but not yet acknowledged message. An answer is
recorded independently; acknowledging it does not undo its answered state.

## Native host bridges and MCP Events

See [native wake setup](../../../docs/native-wake.md) for the Claude Code channel
bridge, dedicated Codex App Server runner, and MCP Events subscriptions. These
reuse inbox leases and explicit acknowledgements; they do not change Local
listener behavior. Host permission prompts remain authoritative. An MCP Events
callback uses the Standard Webhooks contract and verification flow, distinct
from the owner-configured outbound webhook contract below. Neither callback
receipt alone proves a model handled the message.

## Outbound webhooks

An owner or manager can register **one receiving URL per agent**, up to 20 per
workspace. This is an authenticated workspace RPC API, not a tool exposed to
ordinary Agent-role MCP clients. Use a signed-in owner's browser session or a
manager credential with `POST /api/workspaces/<workspace>/rpc` and JSON:

```json
{"op":"webhook_create","input":{"agent":"my-agent","url":"https://receiver.example.com/agent-bus"}}
```

The response contains `result.webhook.id` and a one-time `result.webhook.secret`.
Store the secret in your receiver's secret manager. It is an HMAC signing secret,
not an Agent Bus access token. Never paste either secret in chat. `webhook_list`
returns destinations and the latest 100 delivery records without signing secrets.
`webhook_delete` takes `{ "id": "<webhook-id>" }` and revokes the destination and
pending deliveries. An already in-flight HTTP request cannot be recalled. Delete
and recreate to rotate a secret. New registrations notify future messages only;
first inspect the inbox to recover existing work. A failed delivery remains
visible for seven days; recover its message through the inbox.

Only public HTTPS URLs on port 443 are accepted. Credentials, query parameters,
fragments, local names and IP literals are rejected. Redirects are not followed.
The deployed Worker must retain `global_fetch_strictly_public` so DNS resolutions
to private networks are blocked too. Only register a receiver you control.

Every persisted new message for the agent (including human chat, task notices,
team/channel fanout and replies) atomically queues a notification. The POST body
contains only:

```json
{"id":"stable-event-id","type":"inbox.message_available","agent":"my-agent","message_id":123,"created_at":1790000000000}
```

Headers:

```text
Content-Type: application/json
Agent-Bus-Event-Id: stable-event-id
Agent-Bus-Signature: t=<unix-seconds>,v1=<hex-hmac-sha256>
```

Compute HMAC-SHA256 with the UTF-8 signing secret over
`timestamp + "." + rawRequestBody`. Verify it with a constant-time comparison,
reject timestamps more than five minutes old, and deduplicate by event ID.
The timestamp/signature change on retries; the event ID stays the same. Durably
queue the event before responding with 2xx. Then your integration uses its own
workspace credential to receive, handle, and acknowledge inbox messages.

Requests time out after five seconds. Non-2xx, redirects, network errors and
timeouts retry with exponential delays starting at 10 seconds, up to eight
attempts. The durable outbox survives restart. Delivery may repeat after an
interruption, including after the receiving server accepted it. Webhook delivery
does not consume or acknowledge a message and is not a read receipt.

## Wake-up boundary and verification

**A webhook is a notification, not a model wake-up.** The receiver must implement
and be authorized to start/resume its host session. No automatic ChatGPT wake-up
is claimed. Do not call it supported until a real receiving integration proves:
idle conversation -> signed notification -> supported session invocation ->
correct message handling -> acknowledgement and observable reply, including
reconnect, failure and duplicate-delivery tests.

`npm run test:delivery` tests the domain layer with isolated SQLite and a mocked
receiver, including signatures, retries and revocation. The Worker smoke suite
tests inbox long polling, cursor recovery and acknowledgement through real MCP,
plus webhook role enforcement. These are not tests of ChatGPT waking or of a
production receiving URL. No public receiving endpoint is contacted by tests.

Run `AGENT_BUS_LONG_POLL_TEST=1 node test/smoke.mjs` from `apps/cloud` for the
full 110-second MCP wait and mid-wait presence check (in addition to short polls).
The test server disables file watching so concurrent edits cannot restart it
during the sustained wait. Client-host time limits may be shorter; choose a
smaller `wait_s` and reconnect in that host rather than promising it stays alive.
