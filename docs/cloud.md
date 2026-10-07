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
| Auth | Workers OAuth / OAuth provider integration | Login, consent, scoped agent access |

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
- OAuth clients / agent credentials
- billing/subscription state later

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

Do not copy-paste `src/bus.ts` into a Worker.

Instead, split the local code into three layers:

1. **Core domain operations**
   Pure TypeScript functions for message/task semantics.
2. **Storage adapter**
   Local adapter backed by `better-sqlite3`; Cloud adapter backed by Durable
   Object SQLite.
3. **Transport adapters**
   Local stdio MCP, local CLI, Cloudflare remote MCP, Cloud API.

The first cloud milestone can be smaller: implement a Cloudflare worker with a
subset of tools, but design it around a storage adapter so it does not become a
second product.

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

Implementation can land in slices, but every slice must move toward exact
semantic parity with local agent-bus. The cloud app keeps a tool registry for
all existing MCP tool names so gaps are visible and testable.

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

## CLI Changes

Keep local commands working exactly as they do now.

Add cloud commands under an explicit namespace:

```bash
agent-bus cloud login
agent-bus cloud workspace create my-team
agent-bus cloud token create --workspace my-team --name claude-ui
agent-bus cloud mcp-url --workspace my-team
agent-bus cloud ui --workspace my-team
```

Do not make local commands silently use cloud. Require explicit `cloud`.

## First Build Plan

1. Create a separate package/app for Cloudflare: `apps/cloud`.
2. Add Wrangler config with:
   - Worker entrypoint
   - Durable Object binding
   - D1 binding
   - migrations
3. Implement `WorkspaceBusObject` with SQLite schema migration.
4. Implement remote MCP with `createMcpHandler`.
5. Register all existing agent-bus tool names.
6. Port tool implementations in parity groups:
   - identity + messaging
   - asks + threading
   - team/channel routing
   - tasks + delegation
   - reviews + test evidence
   - memory + reports
   - cockpit/activity
7. Add integration tests with Miniflare/Wrangler local dev.
8. Add docs for connecting Claude/Codex/Kimi to the remote MCP URL.

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
- landing page and a dashboard cockpit for workspace creation, token creation,
  MCP setup, Kanban, activity, memory, and decision visibility
- setup APIs for workspaces and agent tokens
- `/mcp/:workspace` as the real stateless remote MCP endpoint using
  Cloudflare's `createMcpHandler`; `/mcp/:workspace/info` is the human
  diagnostic endpoint, and `/mcp/:workspace?json=1` remains for curl/debug
  JSON dispatch

## Open Decisions

- Whether Agent Bus Cloud lives in this repo or a new `agent-bus-cloud` repo.
- Whether the first dashboard is the existing local cockpit adapted to HTTP or a
  new hosted dashboard.
- Whether remote MCP auth should start with simple workspace tokens or a full
  OAuth consent flow from day one.
- Whether to keep exactly one Durable Object per workspace forever or later
  split high-volume workspaces by team.
