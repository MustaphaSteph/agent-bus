# Agent Bus Cloud

Cloudflare-hosted Agent Bus app.

This app is the hosted track for full Agent Bus parity:

- Worker landing page and dashboard
- D1 users/workspaces/memberships/tokens
- one SQLite-backed Durable Object per workspace
- remote MCP endpoint per workspace
- tool registry for the full local 65-tool surface

## Local Dev

```bash
cd apps/cloud
npm install
npm run typecheck
npm test
npm run dev
```

## Production Deploy

Create a real D1 database, replace the placeholder `database_id` in
`wrangler.toml`, set `AGENT_BUS_CLOUD_ENV = "production"` in `[vars]`, apply
migrations to the remote database, and set a strong auth secret for signed
dashboard sessions. `npm run deploy` refuses to deploy while the checked-in
development defaults are still present.

```bash
wrangler d1 create agent-bus-cloud
# copy the returned database_id into wrangler.toml
# set AGENT_BUS_CLOUD_ENV = "production" in wrangler.toml
wrangler d1 migrations apply agent-bus-cloud --remote
wrangler secret put AGENT_BUS_CLOUD_AUTH_SECRET
npm run deploy
```

Recommended preflight from this repo:

```bash
npm run check:cloud:deploy
```

## API Smoke

```bash
curl -c /tmp/agent-bus-cloud.cookies \
  -X POST http://localhost:8787/api/auth/signup \
  -H 'content-type: application/json' \
  -d '{"email":"you@example.com","password":"change-me-please","name":"You"}'

curl -X POST http://localhost:8787/api/workspaces \
  -b /tmp/agent-bus-cloud.cookies \
  -H 'content-type: application/json' \
  -d '{"slug":"demo","name":"Demo"}'

curl -X POST http://localhost:8787/api/workspaces/demo/tokens \
  -b /tmp/agent-bus-cloud.cookies \
  -H 'content-type: application/json' \
  -d '{"name":"claude-ui","role":"agent"}'

curl http://localhost:8787/mcp/demo/info \
  -b /tmp/agent-bus-cloud.cookies
```

Automated smoke coverage is available from either repo root or `apps/cloud`:

```bash
npm run check:cloud      # from repo root
npm run check:cloud:deploy
npm run check            # from apps/cloud
npm run check:deploy
```

The smoke tests start local Workers with isolated D1 state. They sign up,
create workspaces/tokens, verify the real remote MCP initialize/tools/call path,
check the hosted messages/cockpit APIs, and exercise the `agent-bus cloud`
CLI setup flow end to end.

The dashboard at `http://localhost:8787/app` can also create workspaces,
create/list/revoke agent tokens, add/update/remove workspace members, show the
remote MCP URL, send team/direct messages, create tracked tasks, and load the
workspace cockpit with Kanban, activity, and team-chat history.

Dashboard users log in with email/password. Agent sessions do not use the
dashboard cookie; they use scoped workspace bearer tokens created from the
dashboard or token API.

You can also drive setup from the CLI:

```bash
agent-bus cloud --host http://localhost:8787 signup \
  --email you@example.com \
  --password 'change-me-please' \
  --name You

agent-bus cloud --host http://localhost:8787 health
agent-bus cloud --host http://localhost:8787 bootstrap demo --token-name claude-ui --role agent
agent-bus cloud --host http://localhost:8787 workspace create demo --name Demo
agent-bus cloud --host http://localhost:8787 tokens create demo --name claude-ui --role agent
agent-bus cloud --host http://localhost:8787 members add demo --email teammate@example.com --role viewer
agent-bus cloud --host http://localhost:8787 mcp-config demo --token ab_cloud_...
agent-bus cloud --host http://localhost:8787 token-test demo --token ab_cloud_...
```

`health` is the first deploy smoke check. It does not require login; it
verifies the Worker is reachable and that `/api/tools` reports the cloud tool
surface as implemented.

`bootstrap` is the shortest path from a logged-in dashboard account to a usable
agent connection: it creates or reuses a workspace, creates a scoped agent
token, prints the remote MCP JSON config, and verifies the token.

`members` manages the human dashboard roster from the CLI. A teammate must
create an account first; then an owner can add their email and choose `viewer`,
`agent`, `manager`, or `owner`.

Token roles are enforced before the Durable Object receives a tool call:

- `owner` / `manager`: full workspace operations, including roster cleanup
- `agent`: normal agent work such as register, send, ask, inbox, tasks, memory,
  and reports
- `viewer`: read-only board, chat, activity, report, and diagnostic operations

Human workspace members are managed separately from agent tokens. A teammate
must create an Agent Bus Cloud account first; then an owner can add their email
to the workspace as `viewer`, `agent`, `manager`, or `owner`.

## Remote MCP

Each workspace exposes a real Cloudflare Agents SDK stateless MCP endpoint:

```text
https://<worker-host>/mcp/<workspace-slug>
```

Use an `Authorization: Bearer <agent-token>` header for agent sessions. For
human diagnostics, open:

```text
https://<worker-host>/mcp/<workspace-slug>/info
```

Most remote-MCP clients can use this shape:

```json
{
  "mcpServers": {
    "agent-bus-cloud": {
      "type": "http",
      "url": "https://<worker-host>/mcp/<workspace-slug>",
      "headers": {
        "Authorization": "Bearer <agent-token>"
      }
    }
  }
}
```

The dashboard prints this snippet after token creation so users can paste it
into Claude Code, Codex, Kimi Code, Cursor, or any other remote-MCP capable
client that supports HTTP MCP servers with headers.

For curl/debug smoke tests that want the old direct JSON dispatch shape:

```bash
curl -X POST 'http://localhost:8787/mcp/demo?json=1' \
  -H 'authorization: Bearer <agent-token>' \
  -H 'content-type: application/json' \
  -d '{"tool":"cloud_workspace","input":{}}'
```

## Cockpit API

The dashboard uses these authenticated HTTP helpers on top of the same
workspace Durable Object:

- `GET /api/workspaces/:slug/cockpit` — board, activity, memories, decisions
- `GET /api/workspaces/:slug/tokens` — list scoped agent tokens
- `DELETE /api/workspaces/:slug/tokens/:id` — revoke an agent token
- `GET /api/workspaces/:slug/members` — list workspace members
- `POST /api/workspaces/:slug/members` — owner-only add/update member by email
- `PATCH /api/workspaces/:slug/members/:userId` — owner-only change member role
- `DELETE /api/workspaces/:slug/members/:userId` — owner-only remove member
- `POST /api/workspaces/:slug/rpc` — authenticated dashboard bridge to workspace
  bus operations such as `send_team`, `send`, and `create_task`
- `GET /api/workspaces/:slug/messages?team=<team>` — paged chat history
- `GET /api/workspaces/:slug/messages/:id/thread` — message thread context
- `GET /api/workspaces/:slug/scopes` — projects and teams with counts
- `GET /api/workspaces/:slug/metrics?hours=24` — message/task time series

## Current Status

Implemented cloud operations:

- `register`
- `remove_agent`
- `delete_team`
- `whois` / `directory`
- `wait_for_agents`
- `send`
- `send_team`
- channels: `subscribe`, `unsubscribe`, `send_channel`, `subscribers`
- `inbox`
- `inbox_status`
- `inbox_previews`
- `get_message`
- `ack`
- `ask` / `ask_async`
- `ask_best` / `ask_team`
- `reply`
- `reply_thread`
- `message_status`
- `why_no_reply`
- `thread`
- `recent`
- `create_task`
- `delegate` / `delegate_team`
- `claim_task`
- `assign_task`
- `claim_best_task`
- `list_tasks`
- `get_task`
- `update_task`
- `release_task`
- `acknowledge_task`
- `submit_review`
- `handoff_task`
- `check_scope_conflicts`
- `cancel_task`
- `wait_for_task`
- agent status: `set_agent_status`, `sleep_agent`, `wake_agent`
- task events and evidence: `record_task_event`, `list_task_events`,
  `record_test_result`, `list_test_results`, `task_result`
- `final_report`
- `review_gate`
- `activity`
- `cockpit`
- `now`
- `project_board` / `team_board`
- `remember` / `list_memories`
- `pin_memory` / `unpin_memory`
- `session_brief`
- `record_decision` / `list_decisions`
- `cloud_workspace`

The cloud test suite checks both registry parity and Durable Object dispatch
parity against the local MCP server so future local tool additions cannot
silently miss the hosted endpoint.
