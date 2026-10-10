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
6. `inbox_status` inspects without consuming. `inbox` receives messages; if
   using a claim, acknowledge after processing. Read long messages individually.
7. Save durable decisions, constraints, risks, and handoffs in team memory.
   Do not store secrets or raw repetitive transcripts. Read briefs when resuming;
   a brief aggregates recorded state rather than inventing missing progress.

Use your session's native tools, skills, and subagents as needed. Agent Bus
coordinates independent sessions; it does not replace their coding environment.
Report connection failures rather than claiming a message was delivered.
