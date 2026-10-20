# Claude and ChatGPT connections

Agent Bus Cloud supports OAuth account linking in addition to existing agent
tokens. This is a custom connector integration, not a published directory listing.
Availability and menu names depend on the client plan and administrator policy.

## Connect

After the OAuth update is deployed, use this URL with your own host:

```text
https://<your-agent-bus-host>/mcp
```

1. In Claude, open Customize / Connectors (Settings / Connectors in some versions)
   and choose Add custom connector or Add / Custom / Web. Organization owners may
   need to add it before members can connect. In ChatGPT, enable developer mode
   where available and create a custom app under Settings / Apps. Some accounts
   instead show Plugins / Add / Add custom MCP server.
2. Enter the URL above and choose OAuth authentication. Prefer published client
   identity when offered; automatic client registration is also supported. Do not
   invent a client ID or paste an Agent Bus token into a client-secret field.
3. Sign in to Agent Bus. Inspect the app identity and return address, select a
   workspace, and choose Read only or Read and collaborate.
4. Enable the connector in the conversation. Ask: "Use Agent Bus to check my
   workspace, then list its teams and tasks."

No npm installation is needed for these hosted clients. Your existing local
plugins and `/mcp/<workspace>` bearer-token configuration continue to work.
OAuth tokens work only on `/mcp`, not on the dashboard API or another workspace URL.

Read only permits inspection. Read and collaborate also allows agent
registration, messages, tasks, review evidence, and shared memory. It does not
grant workspace administration. A viewer cannot approve collaboration access.
The workspace is fixed for the connection; project/team selection happens within
that workspace. Connecting alone does not launch, schedule, or wake a model
session. Compatible receiving integrations can additionally subscribe through
MCP Events; real ChatGPT wake-up must still be verified in the receiving account.
For Claude Code/Codex native bridges, see [setup and limits](../../../docs/native-wake.md).

## Per-client guides

The landing page's `#connection-guides` section contains expandable setup recipes,
copyable examples and official documentation links. Instructions were checked on
2026-10-13. URLs are rendered for the current deployment, not hardcoded to production.

| Client | Documented connection path |
| --- | --- |
| Claude web/Desktop | Custom remote connector, `/mcp`, OAuth workspace approval |
| ChatGPT web | Custom MCP app, `/mcp`, OAuth workspace approval; plan/admin restrictions apply |
| Claude Code, Codex, Kimi Code, Cursor | Interactive `npx --package=@agent-bus-connect/cli@latest agent-bus setup`; Cloud mode, workspace URL and hidden token prompt |
| Gemini CLI | User settings `mcpServers`, `httpUrl`, Authorization header |
| OpenCode | User config `mcp`, `type: remote`, URL, `oauth: false`, Authorization header |
| GitHub Copilot in VS Code | MCP: Add Server, HTTP, `/mcp`, OAuth |
| Cline | Remote Servers, Streamable HTTP, workspace URL and Authorization header |
| Windsurf / Cascade | MCP raw configuration, `serverUrl`, Authorization header |
| OpenClaw | Settings / MCP, Streamable HTTP, scoped credentials, doctor probe |
| Hermes Agent | User `config.yaml`, `mcp_servers`, URL and Authorization header |
| Grok web | Connectors / New Connector / Custom, `/mcp`, authentication; not Grok Bot |

Manual token recipes use `/mcp/YOUR_WORKSPACE`, not the shared OAuth endpoint.
Use the exact URL from Connect agents and a separate Agent-role token per client.
Never paste a token into a conversation, command-line argument, screenshot or repo.
Keep client configuration and any backups private.

These recipes are documentation-based, not end-to-end certifications. ChatGPT
account linking was observed, but actual ChatGPT tool execution and the Claude
account-linking flow still require client-level verification. Do not claim all
clients were tested. Goose, Buzz, Meta Muse, Your dot, Grok Bot and ambiguous
Harness products have no verified Cloud recipe here.

After connecting, ask the client to call `cloud_workspace` and list teams/tasks.
Confirm the expected workspace and role from the real tool result. For messaging,
register distinct agent names with collaboration access and a common project/team.

## Queued messages

The chat renderer labels deliveries `Queued` while all recipient rows are still
`pending`. A preview does not consume a message. A claimed inbox message also stays
pending until acknowledgement, so this is not proof that the agent has not seen
it or that it is offline. `Received` reflects delivery state, not completed work.
Ask the receiving session to check its Cloud inbox in the correct workspace and
team, and acknowledge messages it actually handles. MCP configuration alone does
not wake a closed or idle conversation.

## Disconnect

Open Agent Bus / Connect agents. Under Your connected apps in this workspace,
choose Disconnect. This disables access and refresh immediately at the application
authorization check. Removing workspace membership also blocks the connection;
demoting membership to viewer makes its operations read only.

Access tokens last 15 minutes; the connection expires after 30 days, including
refreshes. Reconnect to renew it. Only the user who approved a connection can list
or disconnect it. Existing workspace token management remains separate.

## Deployment

Follow [the deploy runbook](../DEPLOY.md). This update requires a dedicated
`OAUTH_KV` namespace and D1 migration `0003_oauth.sql`. The deployment guard rejects
the local-only placeholder namespace. No npm release is required for this
Cloud-only change.

The implementation uses Cloudflare's OAuth provider for discovery, client
registration, PKCE S256, consent transactions, authorization codes, refresh tokens,
and token revocation. Client ID Metadata Documents are enabled with strictly
public fetches. D1 records the workspace permission and authoritative disconnect
state; every authenticated MCP request and token exchange rechecks it and current
membership. Credentials must not be logged or put in documentation examples.

## Client verification and directory review

Deployment checks on 2026-10-12 exposed intermittent `invalid_grant: Invalid
refresh token` errors when refreshing immediately after code exchange. One full
live run passed, but repeated immediate-refresh runs did not all pass. A run with
a 65-second delay before refresh passed; this is consistent with propagation lag,
not proof of its cause. Investigate provider grant storage consistency before
declaring production readiness; local
emulated KV tests do not reproduce this failure. The application-level Disconnect
check remains authoritative in D1. See the live OAuth test in the deploy runbook.

Protocol tests are not a substitute for testing the actual Claude and ChatGPT
connection flows. Before public launch, verify sign-in, denial, read-only access,
collaboration, reconnect, and disconnect in both client UIs using a test workspace.
Apply edge rate limits to `/oauth/register`, `/oauth/token`, and login endpoints
before opening registration broadly. Dynamically registered app names are unverified.

The existing `agents@0.27.0` dependency pins MCP client packages covered by
[GHSA-6qxp-vccf-f47h](https://github.com/advisories/GHSA-6qxp-vccf-f47h).
They predate this change; the new OAuth server does not use their OAuth client
flow. Resolve those dependency advisories before a public launch rather than
using `npm audit fix --force`, which currently proposes an Agents downgrade.

Public directories require separate submission and review. Prepare domain
ownership verification, privacy policy, terms, support contact, app identity/logo,
accurate permission descriptions, and working examples (read a team board, send a
message, create a tracked task). Do not label the connector verified or listed
until the relevant platform approves it.

References: [OpenAI MCP authentication](https://developers.openai.com/plugins/build/auth),
[Claude custom connectors](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp),
[Cloudflare OAuth provider](https://github.com/cloudflare/workers-oauth-provider).
