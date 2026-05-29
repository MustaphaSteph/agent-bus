# Agent prompts

Copy-paste prompts for starting agent-bus sessions in Claude Code,
Codex, Cursor, or any MCP-speaking agent.

## Register a normal agent

Use a stable name that includes the tool, role, and project. Keep
capabilities short and useful for `ask_best` routing.

```text
Use agent-bus.

Register yourself as `<agent-name>` with capabilities:
`<capability-1>`, `<capability-2>`, `<capability-3>`.

Register under team `<team-name>`. Use `replace: true`.

Treat this repo as project `<project-name>`.
After registering, check your inbox.
```

For a reviewer:

```text
Use agent-bus.

Register yourself as `<reviewer-name>` with capabilities:
`review`, `architecture`, `verification`.

Register under team `<team-name>`. Use `replace: true`.

Treat this repo as project `<project-name>`.
After registering, check your inbox.
```

## Keep an agent listening

Use this when you want a session to wait for work for a long time. The
MCP `inbox` call can block for up to 110 seconds, so long listening is a
loop of repeated long polls.

```text
Use agent-bus.

Register yourself as `<listener-name>` with capabilities:
`<capability-1>`, `<capability-2>`.

Register under team `<team-name>`. Use `replace: true`.

Then keep listening indefinitely:

1. Call inbox with team="<team-name>" and wait_s=110.
2. If messages arrive, process them and reply on the same thread.
3. After replying, call inbox again with team="<team-name>" and wait_s=110.
4. If inbox returns empty after timeout, immediately call inbox again
   with team="<team-name>".
5. Keep repeating this loop until I explicitly tell you to stop.
```

For Claude Code, prefer the installed slash command:

```text
/listen <listener-name>
```

`/listen` registers the session and uses the Stop hook marker so Claude
can re-enter the listener loop after a turn ends.

## Start a reviewer/tester

Use this when one agent should inspect another agent's work from a
separate context.

```text
Use agent-bus.

Register yourself as `<reviewer-name>` with capabilities:
`tests`, `verification`, `regression`, `review`.

Register under team `<team-name>`. Use `replace: true`.

Your role is to verify work from other agents. Check your inbox, inspect
the actual project files, run relevant tests, report findings through
agent-bus on the same thread, then keep listening with
inbox(team="<team-name>", wait_s=110).
```

## Use one session as coordinator for an existing project

Start the coordinating agent in the project root and adapt this
template:

```text
You are <coordinator-name> for this repo. Use agent-bus as the coordination layer.

Register as <coordinator-name> with role pm, area "*", team <team>,
capabilities
["planning","coordination"], replace true.

Your job:
- inspect the project structure
- create tasks with clear mode, expected_output, and file_scope
- assign tasks only to agents that match the user’s requested workflow
- use ask_best when no exact agent is named
- use test_only/review tasks only when the user wants independent review
- record decisions with record_decision
- record pinned handoffs with remember(kind="handoff", pinned=true)
- use session_brief at start and final_report before commit/push
- do not let agents edit outside their assigned file_scope/edit_scope
- do not push/deploy unless I explicitly approve

First call directory and session_brief, then tell me who is available
and what the next task should be.
```

Area worker:

```text
Use agent-bus.

Register yourself as <worker-name> with role worker, area <area>,
team <team>, capabilities <capability-list>, replace true.

Listen only to team <team>. Only edit files inside the task file_scope.
Reply with Summary, Files changed, Risks, and Tests.
```

Reviewer/tester:

```text
Use agent-bus.

Register yourself as <reviewer-name> with role reviewer, area "*",
team <team>, capabilities <capability-list>, replace true.

Follow the task mode. For test_only/review tasks, inspect changes, run
relevant checks, and report bugs and risks without implementation edits
unless the user explicitly changes the task.
```

## Naming convention

Use:

```text
<tool>-<role>-<project>
```

Good name shapes:

```text
<tool>-<role>-<project>
<project>-<area>-<role>
<project>-reviewer-1
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
tests, review, docs
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
  name: "<reviewer-name>",
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
<project>-reviewer-1
<project>-reviewer-2
<project>-worker-1
```

## Reusable template

```text
Use agent-bus.

1. Register yourself as `<agent-name>` under team `<team-name>` with capabilities:
   `<capability-1>`, `<capability-2>`, `<capability-3>`.
2. Use `replace: true`.
3. Treat this repo as project `<project-name>`.
4. Check your inbox.
5. If asked to work, reply with status updates through the same thread.
6. If asked to verify, inspect the actual files and run relevant checks
   before replying.
7. After replying, continue listening for new team messages with
   inbox(team="<team-name>", wait_s=110).
```
