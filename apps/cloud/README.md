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
npm run dev
```

Before deploying, create a real D1 database and replace the placeholder
`database_id` in `wrangler.toml`.

```bash
wrangler d1 create agent-bus-cloud
wrangler d1 migrations apply agent-bus-cloud --local
```

## API Smoke

```bash
curl -X POST http://localhost:8787/api/workspaces \
  -H 'content-type: application/json' \
  -d '{"slug":"demo","name":"Demo"}'

curl -X POST http://localhost:8787/api/workspaces/demo/tokens \
  -H 'content-type: application/json' \
  -d '{"name":"claude-ui","role":"agent"}'

curl http://localhost:8787/mcp/demo
```

## Current Status

Implemented cloud operations:

- `register`
- `whois` / `directory`
- `send`
- `send_team`
- `inbox`
- `reply`
- `thread`
- `create_task`
- `list_tasks`
- `get_task`
- `update_task`
- `project_board` / `team_board`
- `remember` / `list_memories`
- `record_decision` / `list_decisions`
- `cloud_workspace`

The tool registry includes every local MCP tool name so parity gaps remain
visible while the remaining implementations are ported.
