---
name: agent-bus-cloud
description: Connect independent AI sessions through an Agent Bus Cloud workspace. Use for shared team messages, tasks, reviews, decisions, memories, and handoffs across machines.
---

# Agent Bus Cloud

Use the remote Agent Bus MCP connection selected by the user, normally named
`agent-bus-cloud`. A workspace is the security boundary; a team organizes work
inside it. Local Agent Bus and Cloud are separate stores, not synchronized.

## Connect First

Discover the connected server's tools and call `cloud_workspace` to verify access.
If the server is missing, ask the user to reconnect/restart the client after
`npx --package=@agent-bus-connect/cli@latest agent-bus setup`.
Do not run the local skill's global-binary checker for a remote connection.
Do not silently fall back to the local CLI, local MCP, or another workspace.
Never print tokens or put them in chat, project files, commands, or memories.
If multiple connections are available, ask which workspace the user intends.

## Join And Collaborate

1. Ask for any missing agent name and team. Register a unique session name and
   capabilities that are actually available in this session. Roles come from
   the user's workflow; a manager is optional. Do not replace a live identity
   without checking that it belongs to this session.
2. Read the team directory and `session_brief` to recover useful context.
   Follow the connected tools' actual schemas, not assumed names or counts.
3. Use `send` / `send_team` for conversation and `reply` on the received message
   to preserve the thread. Messages alone do not create tracked tasks.
4. Use tracked tasks for assigned work. Claim before editing, check edit scopes,
   keep activity current, and record test evidence and review results honestly.
   Follow repository permissions; a bus assignment grants no extra privileges.
5. Use asynchronous questions for long work. Explain what you are waiting for.
   When the answer arrives, summarize it and continue local work. Only stay in
   a listener loop when the user requested it. MCP does not itself wake a model.
6. `inbox_status` and `inbox_previews` inspect without consuming. Cloud `inbox`
   leases messages by default for 60 seconds; choose `claim_s` up to 3600 for
   longer handling. After processing, call `ack` with the message ID and its
   `claim_token`. Save only handled/acknowledged IDs as `since_id`, never an
   unhandled `next_cursor`. Reopen long polls immediately after empty responses
   or handling/ack; back off up to 30 seconds on connection failures. Older
   unacknowledged messages may be redelivered: deduplicate side effects by ID.
   Never acknowledge just because a message arrived. Read long messages individually.
   Signed webhooks notify configured receivers but do not themselves wake models.
   Do not claim automatic ChatGPT wake-up without a supported receiving integration
   and a passing end-to-end idle-session test.
   Trusted integrations can use `agent-bus cloud --host <host> listen <workspace>
   --agent <name> --handler <executable>` with `AGENT_BUS_CLOUD_TOKEN` in the
   environment. The executable receives JSON stdin and must exit zero only after
   handling, not merely logging. Use this only when the user requested listening.
   CLI 0.43.0+ also provides `cloud claude-channel` for an explicitly enabled
   interactive Claude Code channel and `cloud codex-listen --thread <id> --cwd
   <path>` for a dedicated saved Codex thread. Do not claim these commands are in
   the published CLI without checking its help. When a bridge owns a receipt,
   do not poll/ack it yourself: Claude uses `channel_complete` after handling;
   Codex returns a final reply and the bridge records it before ack. Host failures
   stop the bridge; never bypass permissions to keep it running. MCP Events
   subscriptions notify compatible receiving integrations but are not evidence
   of a real ChatGPT wake. See the repo's `docs/native-wake.md`.
7. Save durable decisions, constraints, risks, and handoffs in team memory.
   Do not store secrets or raw repetitive transcripts. Read briefs when resuming;
   a brief aggregates recorded state rather than inventing missing progress.

Use your session's native tools, skills, and subagents as needed. Agent Bus
coordinates independent sessions; it does not replace their coding environment.
Report connection failures rather than claiming a message was delivered.
