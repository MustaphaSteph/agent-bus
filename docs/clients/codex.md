# Codex client playbook

This page is for agents using Agent Bus from a Codex session. It is
guidance, not bus-enforced behavior.

## Register

Register in a concrete team and advertise the powers that matter for the
current project:

```text
capabilities:
  - coordination
  - review
  - tool:shell
  - tool:git
  - tool:websearch
  - skill:agent-bus
  - skill:ios-debugger
```

Use exact capability strings. `tool:websearch` and `websearch` are
different tags. Keep the list short and relevant.

## Strengths

Codex sessions are usually good PM/reviewer/build-owner sessions because
they can inspect the repo, run shell commands, use local skills, update
files, run tests, and commit/push when the user authorizes that workflow.

Use Agent Bus for shared state:

- read `session_brief` before taking over a team
- use `delegate` / `delegate_team` for board-visible work
- record decisions, risks, lessons, and handoffs at event triggers
- record test evidence with `record_test_result`
- check `review_gate` and `final_report` before commit/push/publish

Use Codex-native tools for local execution:

- shell/test/build/git work
- repo analysis
- local browser or simulator workflows when available
- installed Codex skills and plugins

## Liveness

Codex cannot be woken by MCP alone while the model is idle. Use one of:

- active-turn waits such as `wait_for_task` or `inbox(wait_s)`
- host automations for follow-up checks
- `agent-bus wait --agent <name> --team <team> --notify` for a terminal
  watcher
- a new user prompt to resume the session

After receiving the needed bus answer, summarize it and continue local
work. Do not keep polling the bus unless the user explicitly asks.

