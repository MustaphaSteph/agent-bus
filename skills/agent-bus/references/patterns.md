# agent-bus patterns — quick reference

Load this when the user wants something more structured than a single
message exchange — setting up listeners, reliable delivery, channel
fan-out, task workflows, or threading.

## 1. Set up a helper (listener mode)

When the user says "have a session ready to help" or "open a verifier
in another terminal":

Tell them to open a new Claude Code session and type:

    /listen <helper-name>

For Codex or other tools, get the prompt with:

    agent-bus listen-prompt <helper-name> | pbcopy

then paste into the new chat.

That session registers as `<helper-name>` and enters a blocking
`inbox(wait_s=110)` loop — invisible to the user until a message
arrives.

For listener resilience, the user can also run:

    agent-bus install-hook --agent <helper-name>

which adds a Claude Code Stop hook that auto-resumes the listener if
it falls out of the loop.

## 2. Synchronous Q&A

User wants the answer before continuing:

```
ask({ from: <coordinator>, to: <helper>, question: "..." })
```

Blocks up to 110s. If `ASK_TIMEOUT`, surface the error and ask if the
user wants to switch to async (`send` + later `inbox`).

## 3. Fire-and-forget delegation

User wants to keep working while the helper handles something:

```
send({ from: <coordinator>, to: <helper>, message: "..." })
```

Tell the user it's dispatched. Don't poll — check inbox only when the
user asks "any replies?" or has indicated they want the result now.

## 4. At-least-once delivery (reliable processing)

Used when the helper does something irreversible (deploys, external
writes, paid API calls). The HELPER side runs:

```
const msgs = inbox({ agent: "deployer", wait_s: 110, claim_s: 600 })
for (m of msgs) {
  try {
    do_work(m)
    ack({ agent: "deployer", message_id: m.id })
  } catch {
    // skip ack; the claim expires in 600s and the message redelivers
  }
}
```

Pick `claim_s` longer than worst-case processing time.

## 5. Broadcast to a team channel

When the user wants to notify many agents at once (CI alert, "PR
landed", new task available):

Set up:
```
subscribe({ agent: "alice", channel: "ci-alerts" })
subscribe({ agent: "bob",   channel: "ci-alerts" })
```

Then broadcast:
```
send_channel({ from: "ci", channel: "ci-alerts", message: "build failed" })
```

Fan-out: one message row per subscriber, sender excluded. Each
subscriber sees it in their normal `inbox` with `m.channel` set.

For one team conversation, prefer team-scoped messages and recent reads:
`send_team(team=...)` to post, `recent(team=...)` to catch up, and the
CLI `agent-bus team-chat --team <team>` when the user wants to watch the
conversation from a terminal. Use task tools when the message represents
work that must appear on the board.

## 6. Track work as tasks

For multi-step delegated work where state, ownership, or review matters,
use `delegate` when the assignee is known:

```
const result = delegate({
  from: <coordinator>,
  to_agent: <assignee>,
  title: "review the auth refresh logic",
  description: "src/auth/refresh.ts lines 40-80, race conditions",
  priority: 10,
  cwd: "/abs/path/to/repo",
  mode: "investigate_only",
  expected_output: "Summary / Files inspected / Findings / Suggested fix / Risks / Test plan / Confidence",
  read_scope: ["src/auth/**", "test/auth/**"],
})
```

Use `create_task` plus `claim_best_task` when workers should self-select
from a queue. Use `wait_for_task` for long-running progress waits and
`task_result` before review or handoff.

Worker side:
```
claim_task({ agent: "worker", task_id })       // atomic
update_task({ agent: "worker", task_id, state: "working" })
// ...do the work...
update_task({
  agent: "worker", task_id,
  state: "completed",
  result: "Found 2 issues, see thread for details."
})
```

Use `assign_task` when the manager chooses the worker, or
`claim_best_task` when a worker asks for its next matching task.

`list_tasks` (or `agent-bus tasks --watch` from a shell) shows
pending and active work. Stale tasks (holder gone idle) surface with
`stale: true` — surface them to the user; they can `release_task`
manually.

## 7. Conversation threading

Every message has a `thread_id`. Auto-generated unless provided. To
keep a multi-turn exchange together, pass the incoming `thread_id`
back when replying:

```
send({ from: <you>, to: <them>, message: "...", thread_id: msg.thread_id })
```

Later, read the chain:
```
thread({ thread_id: <id> }) -> Message[]
```

Useful when summarizing a long back-and-forth, or when debugging "what
did we agree on?"

## 8. Capability routing (don't know who to ask)

When the user describes a skill rather than a name ("a reviewer",
"someone who knows React"):

```
ask_best({
  from: <coordinator>,
  capability: "react",          // or "review", "security", etc.
  question: "...",
})
```

The bus picks the most-recently-active in-project agent with that
capability. Fails loud with `UNKNOWN_AGENT` and a hint when no match.

## 9. Cross-project addressing

By name (`send` / `ask` to a specific agent name) always works
regardless of project. Discovery (`directory`, `whois`, `list_tasks`,
`recent`, `ask_best`) defaults to caller's project and configured area.
Pass `project: "*"` or `area: "*"` to opt into broader views. CLI tools
default to the repo-derived project and area; use
`--project all --area all` for global.

## 10. Manager workflow

Use `directory()` as the live board:

```
directory({ area: "*" })
```

Set agent state explicitly:

```
set_agent_status({ agent: "<agent-name>", status: "working" })
sleep_agent({ agent: "<agent-name>" })
wake_agent({ agent: "<agent-name>" })
```

Record durable decisions:

```
record_decision({
  by_agent: "<agent-name>",
  decision: "<decision>",
  rationale: "<why this was chosen>",
  implemented: true,
})
```

Record durable memories and generate handoffs:

```
remember({
  by_agent: "<agent-name>",
  kind: "handoff",
  content: "<handoff summary for the next session>",
  pinned: true,
})

session_brief({ area: "*" })
```

Before commit/push/deploy, ask for:

```
final_report({ area: "*" })
```

## 11. Human-in-the-loop relay

The user wants to be the relay between two helpers, with full
visibility:

- They open `agent-bus watch` in a third terminal.
- They `agent-bus inject --to <agent> "..."` to nudge any helper.
- The bus shows everything; coordinator doesn't have to be
  bus-aware.

Use this when the user wants tight control over what passes between
helpers, or when debugging a multi-agent flow.
