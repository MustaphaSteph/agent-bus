# Agent prompts

Copy-paste prompts for starting agent-bus sessions in Claude Code,
Codex, Cursor, or any MCP-speaking agent.

## Register a normal agent

Use a stable name that includes the tool, role, and project. Keep
capabilities short and useful for `ask_best` routing.

```text
Use agent-bus.

Register yourself as `codex-builder-agent-bus` with capabilities:
`typescript`, `cli`, `tests`, `implementation`.

Use `replace: true`.

Treat this repo as project `agent-bus`.
After registering, check your inbox.
```

For a reviewer:

```text
Use agent-bus.

Register yourself as `claude-reviewer-agent-bus` with capabilities:
`review`, `architecture`, `verification`.

Use `replace: true`.

Treat this repo as project `agent-bus`.
After registering, check your inbox.
```

## Keep an agent listening

Use this when you want a session to wait for work for a long time. The
MCP `inbox` call can block for up to 110 seconds, so long listening is a
loop of repeated long polls.

```text
Use agent-bus.

Register yourself as `claude-listener-agent-bus` with capabilities:
`review`, `verification`, `planning`.

Use `replace: true`.

Then keep listening indefinitely:

1. Call inbox with wait_s=110.
2. If messages arrive, process them and reply on the same thread.
3. After replying, call inbox again with wait_s=110.
4. If inbox returns empty after timeout, immediately call inbox again.
5. Keep repeating this loop until I explicitly tell you to stop.
```

For Claude Code, prefer the installed slash command:

```text
/listen claude-listener-agent-bus
```

`/listen` registers the session and uses the Stop hook marker so Claude
can re-enter the listener loop after a turn ends.

## Start a verifier

Use this when one agent should inspect another agent's work from a
separate context.

```text
Use agent-bus.

Register yourself as `codex-verifier-agent-bus` with capabilities:
`tests`, `verification`, `regression`, `review`.

Use `replace: true`.

Your role is to verify work from other agents. Check your inbox, inspect
the actual project files, run relevant tests, report findings through
agent-bus on the same thread, then keep listening with inbox(wait_s=110).
```

## Use Codex as manager for an existing web app

Start Codex in the web app repo root and paste:

```text
You are webapp-manager for this repo. Use agent-bus as the coordination layer.

Register as webapp-manager with role pm, area "*", capabilities
["planning","coordination","review","qa"], replace true.

Your job:
- inspect the project structure
- create tasks with clear mode, expected_output, and file_scope
- assign tasks to area workers
- use ask_best when no exact agent is named
- keep one verifier in test_only mode
- record decisions with record_decision
- record pinned handoffs with remember(kind="handoff", pinned=true)
- use session_brief at start and final_report before commit/push
- do not let workers edit outside their file_scope
- do not push/deploy unless I explicitly approve

First call directory and session_brief, then tell me who is available
and what the next task should be.
```

Frontend worker:

```text
Use agent-bus.

Register yourself as webapp-frontend with role worker, area frontend,
capabilities react, typescript, css, ui, replace true.

Listen for assigned tasks. Only edit files inside the task file_scope.
Reply with Summary, Files changed, Risks, and Tests.
```

Backend worker:

```text
Use agent-bus.

Register yourself as webapp-backend with role worker, area backend,
capabilities node, api, database, auth, replace true.

Listen for assigned tasks. Only edit files inside the task file_scope.
Reply with Summary, Files changed, Risks, and Tests.
```

Verifier:

```text
Use agent-bus.

Register yourself as webapp-verifier with role verifier, area "*",
capabilities test, review, qa, replace true.

Do not edit implementation files. Review diffs, run tests, report bugs
and risks. Prefer task mode test_only.
```

## Naming convention

Use:

```text
<tool>-<role>-<project>
```

Good names:

```text
codex-builder-agent-bus
claude-reviewer-agent-bus
codex-verifier-vorec
claude-docs-bgai
cursor-frontend-vorec
```

Avoid vague names:

```text
agent1
test
claude
codex
helper
```

Agent names are globally unique across the local bus. Even with project
scoping, include the project in the name when several projects share the
same machine.

## Capability tags

Use tags that describe what the agent should be asked to do:

```text
typescript, cli, tests, implementation
review, architecture, verification
react, css, frontend
postgres, supabase, sql
security, qa, regression
```

Avoid generic tags:

```text
ai
coding
general
helpful
assistant
```

## What `replace: true` means

`replace: true` means "if this name already exists, let this session
take over that name."

Use it for stable single-session identities:

```js
register({
  name: "claude-reviewer-agent-bus",
  capabilities: ["review", "verification"],
  replace: true
})
```

Without `replace: true`, registration fails with `NAME_TAKEN` if that
name was active recently. That protects two live sessions from
accidentally using the same identity.

Avoid `replace: true` when multiple live workers should run at the same
time. Give each worker a unique name:

```text
claude-reviewer-agent-bus-1
claude-reviewer-agent-bus-2
codex-verifier-agent-bus-1
```

## Reusable template

```text
Use agent-bus.

1. Register yourself as `<agent-name>` with capabilities:
   `<capability-1>`, `<capability-2>`, `<capability-3>`.
2. Use `replace: true`.
3. Treat this repo as project `<project-name>`.
4. Check your inbox.
5. If asked to work, reply with status updates through the same thread.
6. If asked to verify, inspect the actual files and run relevant checks
   before replying.
7. After replying, continue listening for new messages with inbox(wait_s=110).
```
