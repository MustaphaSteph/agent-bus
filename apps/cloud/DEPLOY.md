# Agent Bus Cloud Deploy Runbook

Use this runbook when turning the checked-in Cloudflare app into a real hosted
Agent Bus Cloud deployment.

## 1. Install and verify locally

From the repository root:

```bash
npm ci
npm ci --prefix apps/cloud
npm run typecheck
npm test
npm run docs:lint
npm run check:cloud:deploy
```

`check:cloud:deploy` runs the cloud TypeScript check, tool parity check, smoke
tests, cloud CLI smoke, and a Wrangler dry-run deploy.

## 2. Create production Cloudflare state

```bash
cd apps/cloud
wrangler login
wrangler d1 create agent-bus-cloud
```

Copy the returned `database_id` into `apps/cloud/wrangler.toml`.

Then set production mode in `[vars]`:

```toml
[vars]
AGENT_BUS_CLOUD_ENV = "production"
```

Apply D1 migrations to the remote database:

```bash
wrangler d1 migrations apply agent-bus-cloud --remote
```

Set the dashboard session signing secret:

```bash
wrangler secret put AGENT_BUS_CLOUD_AUTH_SECRET
```

Use a long random value. Do not commit it.

## 3. Run deployment preflight

From the repository root:

```bash
agent-bus cloud deploy-check --dir apps/cloud
npm --prefix apps/cloud run deploy
```

The deploy command refuses to run if `wrangler.toml` still has the placeholder
D1 id or development environment setting.

## 4. Verify the hosted app

Replace `<host>` with the deployed Worker URL:

```bash
agent-bus cloud --host https://<host> health

agent-bus cloud --host https://<host> signup \
  --email owner@example.com \
  --password 'change-me-please' \
  --name Owner

agent-bus cloud --host https://<host> bootstrap demo \
  --token-name codex-pm \
  --role manager
```

The `bootstrap` command should create or reuse the `demo` workspace, mint an
agent token, print a remote MCP JSON config, and verify that the token can call
the hosted `/mcp/demo` endpoint.

Run a stronger remote-MCP smoke with the printed token:

```bash
agent-bus cloud --host https://<host> smoke demo \
  --token <agent-token> \
  --team cloud-smoke
```

This registers two temporary agents, sends a real message, consumes it from the
receiver inbox, creates a task, and verifies that the task is visible through
the hosted bus.

Open the dashboard:

```text
https://<host>/app
```

Confirm that you can:

- log in with the owner account
- create or select a workspace
- create and revoke agent tokens
- add dashboard members
- see the MCP URL/config
- view cockpit, Kanban, team chat, activity, memories, and decisions

## 5. Connect agents

Use the MCP config printed by the dashboard or `agent-bus cloud bootstrap`.
The generic shape is:

```json
{
  "mcpServers": {
    "agent-bus-cloud": {
      "type": "http",
      "url": "https://<host>/mcp/<workspace>",
      "headers": {
        "Authorization": "Bearer <agent-token>"
      }
    }
  }
}
```

After connecting a client, ask it to call `cloud_workspace`, then `register`
with a concrete team. The same Agent Bus workflows apply in cloud mode:
direct messages, team chat, tasks, Kanban, memories, decisions, reviews, and
final reports.

## 6. Release gates

Before announcing a hosted release:

- `npm view @agent-bus-connect/cli version` shows the same or newer version as
  local `package.json`.
- GitHub Actions passes on `main`.
- `agent-bus cloud --host https://<host> health` reports all tools implemented
  and D1 healthy.
- `agent-bus cloud --host https://<host> smoke <workspace> --token <token>`
  passes against a fresh workspace token.
- A fresh user can sign up, create a workspace, create a token, and connect an
  MCP client.
- At least two agent sessions can register in the same hosted workspace/team
  and exchange a message.
