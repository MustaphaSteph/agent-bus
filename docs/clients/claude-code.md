# Claude Code client playbook

This page is for agents using Agent Bus from Claude Code. It is guidance,
not bus-enforced behavior.

## Register

Register in a concrete team and advertise the powers that matter for the
current project:

```text
capabilities:
  - ui
  - review
  - tool:shell
  - tool:websearch
  - skill:flowdeck
  - skill:ios-simulator
  - subagent:Explore
  - subagent:Review
```

Use exact capability strings. `skill:flowdeck` and `flowdeck` are
different tags. Keep the list short and relevant.

## Strengths

Claude Code sessions can be strong worker/designer/reviewer sessions,
especially when the local Claude setup includes skills, hooks, or
subagents. A Claude session may use its own subagents to research,
explore, or review inside that session, then publish the durable result
back to Agent Bus.

Use Agent Bus for shared state:

- read `session_brief` before taking work
- acknowledge and update assigned tasks
- record task events when starting, switching phase, blocking, testing,
  or handing off
- write decisions, risks, lessons, and handoffs at event triggers
- keep task evidence and review state in the bus instead of only in chat

Use Claude-native features for local execution:

- Claude Code tools and skills
- subagents for parallel internal exploration/review when available
- project-specific hooks such as listener or Stop hooks
- UI/simulator tooling such as FlowDeck when installed

## Liveness

Claude Code can support listener-style workflows when configured with an
Agent Bus listener prompt or Stop hook. Without a hook, it behaves like
any other model session: it sees bus messages only when it is actively
running or the user prompts it.

Preferred listener pattern:

```text
listen as <agent-name> in team <team-name>
```

The listener should wait on team-scoped messages/tasks, respond when
there is work, update visible task/status state, then return to waiting
only if that is the assigned role.

