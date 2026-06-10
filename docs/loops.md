# Loop engineering with Agent Bus

Agent Bus is the local coordination layer for coding-agent loops. It
does not replace Codex automations, Claude Code loops, cron, hooks, or
connectors. It gives those loops a shared team room: chat, tasks,
memory, review gates, test evidence, and a cockpit humans can inspect.

## The loop shape

1. Start or schedule a PM/coordinator session.
2. Register every active session in a concrete team.
3. Read `session_brief` before assigning work.
4. Use `send_team` for discussion and `delegate` / `delegate_team` for
   board-visible work.
5. Record decisions, risks, done work, next actions, and handoffs.
6. Require review and test evidence before calling work done.
7. Use `review_gate` and `final_report` before commit, push, publish, or
   deploy decisions.

## Memory pattern

Do not leave important loop state only in chat context. Store it where a
later session can read it:

- `record_decision` for settled product, architecture, or workflow
  choices.
- `remember(kind="risk", pinned=true)` for active risks that should
  stay visible.
- `remember(kind="summary")` for durable done-work context.
- `remember(kind="todo")` for next actions that are not yet formal
  tasks.
- `remember(kind="handoff", pinned=true)` before a session exits or
  transfers work.

Fresh sessions should call `session_brief` before taking work.

## Verifier gate

For implementation work, "done" means:

```text
implementation finished
+ test evidence recorded
+ required reviewer approved
+ review_gate / final_report says safe
```

Use `review_required=true` when another agent should approve completion.
Use `independent_review=true` when a different reviewer is available and
the holder/pending assignee must not approve their own work. Requester or
PM review remains allowed because that is the common manager workflow.

Record evidence with `record_test_result`. Add `git_ref` and `cwd` when
available:

```bash
agent-bus test-result \
  --by verifier \
  --task 12 \
  --command "npm test" \
  --status passed \
  --summary "94 smoke tests passed" \
  --git-ref "$(git rev-parse --short HEAD)" \
  --cwd "$PWD"
```

Agent Bus stores those anchors but does not derive git state or block on
missing refs. That keeps the bus tool-agnostic and usable outside git.

## Liveness pattern

Claude Code can use the Agent Bus Stop hook to keep listener sessions
alive. Other clients may not have the same hook. For Codex, Cursor, or
generic MCP clients, prefer tracked tasks and visible re-arming:

```text
wait_for_task(task_id, wait_s=110)
summarize latest evidence to the user
continue locally or re-arm wait_for_task only when more input is needed
```

A timeout is not failure if the task has recent events, test results, or
an online holder. Avoid blind inbox polling after you already have enough
information to continue.

## Board attention

Boards and cockpit surface loop-health issues at read time:

- blocked tasks
- stale holders
- missing acknowledgements
- pending reviews
- overdue `deadline_at`
- due `checkin_at`
- edit-scope conflicts

`review_gate` treats overdue tasks as blockers. Set `deadline_at` only
when missing the deadline should stop "safe to merge/push" reports until
the task is completed, canceled, or rescheduled.

There is no scheduler or daemon. A PM loop can simply read `team_board`,
`cockpit`, or the web UI to decide the next prompt.
