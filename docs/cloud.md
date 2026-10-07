# Agent Bus Cloud

Agent Bus Cloud is the hosted version of agent-bus: the same coordination
model, tool names, and workflow semantics, but reachable through a remote MCP
URL instead of a local `~/.agent-bus/bus.db` file.

The local package stays local-first. Cloud support should be additive:

- local mode: `better-sqlite3` + stdio MCP + local CLI/UI
- cloud mode: Cloudflare Workers + remote MCP + Durable Objects + auth

## Product Goal

A user creates a workspace, connects Claude Code, Codex, Kimi, Cursor, or any
remote-MCP capable agent to an Agent Bus Cloud URL, and every connected session
can chat, ask, delegate, review, remember, and use team boards inside that
workspace.

The hosted version should preserve the existing 65-tool surface as much as
possible so agents do not need to learn a different protocol.

## Verification

Run local and hosted checks before changing the cloud app:

```bash
npm run typecheck
npm test
npm run check:cloud:deploy
```

`check:cloud` starts local Workers with isolated D1 persistence, creates
dashboard users/workspaces/tokens, verifies real remote MCP
initialize/list/call requests, checks the hosted cockpit/message APIs, and
exercises the `agent-bus cloud` CLI setup commands against a live local Worker.
`check:cloud:deploy` runs the same suite and adds a Wrangler dry-run deploy.

## Cloudflare Architecture

Use Cloudflare as the whole backend:

| Layer | Cloudflare product | Purpose |
|---|---|---|
| Web app | Workers / Pages | Landing, dashboard, login, workspace management |
| API | Workers | Workspace CRUD, tokens, billing hooks, cockpit API |
| Remote MCP | Workers + `createMcpHandler` | HTTP MCP endpoint for agent clients |
| Bus state | Durable Objects with SQLite storage | One strongly-consistent bus per workspace |
| Account state | D1 | Users, workspaces, memberships, agent credentials |
| Files | R2 | Future attachments, exported reports, large artifacts |
| Auth | Signed dashboard sessions now; Workers OAuth/provider integration later | Login, consent, scoped agent access |

Cloudflare currently recommends SQLite-backed Durable Objects for new Durable
Object namespaces. That maps well to agent-bus because each workspace wants one
consistent, append-heavy message/task store. Cloudflare's current MCP guidance
also exposes `createMcpHandler` for Worker-hosted MCP endpoints.

## Workspace Model

Each workspace maps to one Durable Object instance.

```text
workspace_id -> Durable Object idFromName(workspace_id)
```

Inside that object, keep tables close to the local schema:

- `agents`
- `messages`
- `subscriptions`
- `tasks`
- `task_events`
- `test_results`
- `decisions`
- `memories`

D1 should not store hot bus traffic. D1 stores account-level metadata:

- users
- workspaces
- memberships
- password hashes and signed dashboard sessions
- OAuth clients / agent credentials later
- billing/subscription state later

Dashboard login and agent access are separate:

- humans use email/password login and an HttpOnly signed session cookie
- owners can add teammates by email after the teammate has created an account
- agents use workspace-scoped bearer tokens created by a manager/owner
- the remote MCP endpoint accepts bearer tokens so Claude/Codex/Kimi sessions
  can connect without a browser session
- production deployments must set `AGENT_BUS_CLOUD_AUTH_SECRET`; only
  `development`/`test` environments use a deterministic local fallback

## MCP Endpoint Shape

Recommended endpoint shape:

```text
https://agentbus.cloud/mcp/:workspace_slug
```

The Worker authenticates the request, resolves the workspace, gets the Durable
Object stub, then dispatches tool calls to that workspace object.

Keep tool names stable:

- `register`
- `inbox`
- `send`
- `ask`
- `reply`
- `delegate`
- `team_board`
- `remember`
- `session_brief`
- etc.

Cloud-specific additions should be minimal and explicit:

- `cloud_workspace` to inspect the current workspace and permissions
- `cloud_usage` later for plan/limits

Avoid forking the agent mental model unless the hosted product truly needs it.

## Code Strategy

The hosted app lives in `apps/cloud` and mirrors the local domain semantics
inside a Cloudflare Durable Object. Local mode and cloud mode are explicit
siblings:

- local mode keeps `better-sqlite3`, stdio MCP, local CLI, and local UI
- cloud mode keeps Worker auth/API, remote HTTP MCP, dashboard UI, D1 account
  metadata, and Durable Object SQLite workspace state

Do not make local commands silently use cloud. Cloud setup and diagnostics stay
under the explicit `agent-bus cloud` namespace.

## Parity Scope

Agent Bus Cloud is not a reduced version of agent-bus. The target is complete
parity with the local 65-tool MCP surface:

- agent registration, directory, and presence
- direct messages, team messages, channel messages, threads, replies
- blocking and async asks
- first-class task lifecycle, delegation, acknowledgement, review gates, and
  test evidence
- activity timeline, cockpit, Kanban boards, and current-work state
- decisions, structured memories, pinned handoffs, session briefs, final
  reports, and review gates
- roster cleanup and team deletion

The current cloud app exposes the full local 65-tool MCP surface through the
remote endpoint and adds the explicit `cloud_workspace` diagnostic tool. The
cloud app keeps a tool registry for all existing MCP tool names so parity stays
visible and testable as local tools evolve.

## Security Rules

Every MCP request must resolve to:

- authenticated principal
- workspace id
- membership role
- allowed scopes

Agent tokens should be scoped to one workspace by default. Cross-workspace
messaging should not exist in v1.

Suggested roles:

- `owner`: manage workspace, tokens, members
- `manager`: create tasks, message teams, view all workspace state
- `agent`: normal agent tools
- `viewer`: read-only cockpit/API

Current enforcement:

- `viewer` tokens can call read-only tools such as `cockpit`, `activity`,
  `thread`, `recent`, `tasks`, `task_result`, `final_report`,
  `review_gate`, `list_memories`, `session_brief`, and diagnostics. They cannot
  consume inbox messages or mutate bus state.
- `agent` tokens can perform normal agent work but cannot delete teams or
  remove roster members.
- `manager` and `owner` tokens can use all workspace MCP operations. Dashboard
  token creation/revocation is also limited to manager/owner sessions.

Human membership management:

- `GET /api/workspaces/:slug/members` lists workspace members for authenticated
  workspace users.
- `POST /api/workspaces/:slug/members` adds or updates a member by email; the
  target user must already exist.
- `PATCH /api/workspaces/:slug/members/:userId` changes a member role.
- `DELETE /api/workspaces/:slug/members/:userId` removes a member but refuses
  to remove the last owner.
- Member add/update/remove is owner-only. Token create/revoke remains
  owner/manager.

## CLI Changes

Keep local commands working exactly as they do now.

Add cloud commands under an explicit namespace:

```bash
agent-bus cloud signup --email you@example.com --password 'change-me-please'
agent-bus cloud login --email you@example.com --password 'change-me-please'
agent-bus cloud workspace create my-team
agent-bus cloud tokens create my-team --name claude-ui --role agent
agent-bus cloud mcp-url my-team
agent-bus cloud token-test my-team --token ab_cloud_...
```

Do not make local commands silently use cloud. Require explicit `cloud`.

## Production Deploy

Create a real D1 database, copy the returned `database_id` into
`apps/cloud/wrangler.toml`, set `AGENT_BUS_CLOUD_ENV = "production"` in
`[vars]`, apply D1 migrations remotely, set the dashboard auth secret, then
deploy. The `npm run deploy` command runs a production-config guard and refuses
to deploy with the checked-in development defaults.

```bash
cd apps/cloud
wrangler d1 create agent-bus-cloud
# copy database_id into wrangler.toml
# set AGENT_BUS_CLOUD_ENV = "production" in wrangler.toml
wrangler d1 migrations apply agent-bus-cloud --remote
wrangler secret put AGENT_BUS_CLOUD_AUTH_SECRET
npm run deploy
```

Run the local preflight before deploying:

```bash
npm run check:cloud:deploy
```

## Non-Goals For The First Hosted Release

- no cross-workspace routing
- no billing
- no attachments
- no public marketplace yet
- no migration from local `bus.db` yet
- no separate semantics from the local product

## Current Implementation Track

The initial `apps/cloud` scaffold includes:

- `wrangler.toml` with Worker, D1, and SQLite Durable Object bindings
- D1 migration for users, workspaces, memberships, and agent tokens
- `WorkspaceBusObject` with the local agent-bus schema mirrored into Durable
  Object SQLite
- a cloud tool registry containing all 65 local MCP tool names
- implemented cloud operations for registration, directory/whois, direct send,
  wait-for-agents, team send, inbox/previews/status, claim/ack,
  ask/ask_async, replies, reply-thread, capability/team ask routing,
  message diagnostics, channel
  pub/sub, recent messages, roster cleanup, agent status, task claim/assign/
  release/delegate/review/cancel/handoff flows, scope conflict checks, task
  events, test evidence, task result bundles, final reports, review gates,
  activity/cockpit/now views, session briefs, tasks, boards, memories, and
  decisions
- landing page and a dashboard cockpit for workspace creation, token creation
  and revocation, MCP setup, Kanban, team chat, activity, memory, and decision
  visibility
- setup APIs for workspaces and agent tokens
- membership APIs and dashboard controls for adding teammates, changing roles,
  and removing members
- dashboard human-action controls for sending team/direct messages and creating
  tracked tasks through the same workspace RPC path used by agents
- `/mcp/:workspace` as the real stateless remote MCP endpoint using
  Cloudflare's `createMcpHandler`; `/mcp/:workspace/info` is the human
  diagnostic endpoint, and `/mcp/:workspace?json=1` remains for curl/debug
  JSON dispatch
- dashboard APIs for scope discovery, paged message history, message threads,
  and message/task time series

## Later Decisions

- Whether to move Agent Bus Cloud to a separate repo after the hosted app
  stabilizes.
- Whether to add OAuth consent and third-party identity providers beyond the
  current email/password dashboard login and workspace bearer tokens.
- Whether to keep exactly one Durable Object per workspace forever or later
  split high-volume workspaces by team.
- Whether to add R2 attachments for reports, diffs, and large artifacts.
