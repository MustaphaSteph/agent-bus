# Native wake integration plan

Goal: connect Agent Bus delivery to supported host execution APIs without
confusing notification receipt with handled work or bypassing approvals.

The desktop goal tool already contains an unfinished Cloud goal and refused a
second goal. This plan tracks the requested extension without marking that
larger goal complete or replacing it.

## Progress

- [x] Inspect existing listener, Cloud MCP adapter, delivery storage and auth.
- [x] Claude Code channel bridge with explicit completion and cancellation.
- [x] Codex App Server adapter bound to a specific thread and working directory.
- [x] Authenticated MCP Events subscriptions, verified signed callbacks,
      durable retries, expiration, revocation and unsubscribe.
- [x] Regression tests: duplicate delivery, failure, reconnect, scope isolation,
      approval refusal, and acknowledgement only after handling.
- [x] Real-host idle wake tests where host access permits; report separately
      from simulated/protocol tests.
- [x] Documentation and deployment checks, Cloud deploy and live smoke tests.

## Acceptance

No terminal keystroke injection, private host sockets, automatic permission
approval, or arbitrary session selection. Bind workspace/agent/session explicitly.
Keep received, handled, replied and acknowledged distinct. Local bridges require
an awake computer and running host. ChatGPT automatic wake remains unverified
until a real subscribed Work chat receives an event and responds. Do not publish
the npm package as part of Cloud deployment.

## Test evidence (2026-10-14)

- Root smoke: 102 passed; cross-process suite passed with isolated port 18971.
- Native adapters: 9 scenarios passed, including approval refusal and cancellation.
- Cloud full check passed: types, task parity, attachments, delivery, OAuth,
  social login, human chat/tasks, blog routes and CLI.
- MCP Events: 13 scenarios passed, including signature/rotation, retries,
  unsubscribe races, membership/token/OAuth revocation and paused agents.
- Real Codex App Server: saved thread resumed and answered two deliveries,
  including one after idle; dedicated test thread archived afterward.
- Real Claude Code 2.1.299: interactive development channel handled two
  notifications, including a second after settling idle; reply stored before ack.
- Worker runtime: signed verification + alarm callback, MCP discovery across
  protocol versions, disconnect presence cleanup, CLI checkpoint/restart and
  explicit completion tested. Notification alone never acknowledged the message.
- Full 110-second empty long poll refreshed presence and cleared Listening on
  timeout. OpenAPI lint and production configuration/dry-run checks passed.
- Initial failures found and fixed: Workers redirect mode, Claude background
  mode not enabling the development channel, and deferred completion-tool loading.
- No real ChatGPT account wake test yet; no automatic-wake claim for ChatGPT.

## Deployment evidence

- Cloud deployed successfully on 2026-10-14, version
  `76473ed6-726b-4466-b365-216a5b7158a9`, at
  https://agent-bus-cloud.mustapha-achtaou.workers.dev/.
- Live smoke passed: authenticated MCP, modern event discovery, legacy tools,
  long poll, reconnect cursor, explicit ack, idempotent reply, review gates,
  human messages and attachments. Evidence workspace:
  `deploy-test-1791987588315`; temporary token revoked.
- Live OAuth passed: PKCE, workspace binding, privilege/read-only limits,
  refresh and immediate Disconnect. Evidence workspace:
  `oauth-deploy-1791987589519`; temporary connections disconnected.
- The remote D1 migration-list API returned Cloudflare 7403. No new D1 migration
  is required for this change: event tables initialize idempotently inside the
  workspace Durable Object. Deployment and live database-backed smoke passed.
- Canonical plugin skill copies synchronized from the local repo and drift
  checks passed. No npm publication, commit or push performed in this update.
- CLI bridges are built locally. Cloud deployment alone does not install them
  on users' machines. Follow `docs/native-wake.md` for opt-in source setup.

## References

- https://code.claude.com/docs/en/channels-reference
- https://learn.chatgpt.com/docs/app-server
- https://developers.openai.com/plugins/build/mcp-events
