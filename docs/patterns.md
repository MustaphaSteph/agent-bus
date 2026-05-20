# Patterns

How to use the bus for real work. Each pattern is a recipe: when to use
it, the exact tool calls or prompts, and the failure modes.

The first pattern is the one most users actually want — natural-language
coordination from a single "main" session that has helpers on the bus.
Patterns 1+ are the lower-level building blocks each helper or
automation uses.

## 0. Coordinator mode (talk naturally, agent figures out the tools)

**When**: you have a main working session and one or more helper
sessions in `/listen` mode. You don't want to type tool names or
parameters — you want to describe what you need.

**How**:

In your main session (just once at session start):

```
/main mustapha
```

That registers you on the bus as `mustapha`, lists who else is
available, and primes Claude to translate phrases like "ask the
reviewer", "delegate this", "get a second opinion" into the right tool
calls.

From there you just talk:

| You say | Behind the scenes |
|---|---|
| "Ask the reviewer to check src/foo.ts for race conditions." | `ask_best(capability="review", question="…")`, returns the verdict to you in plain English. |
| "Get a second opinion on this approach." | `ask_best(capability="review" or "verify", …)`. |
| "Have someone find all callers of `useAuth`." | `ask_best(capability="research", question="…")`. |
| "Delegate this to a helper and tell me when it's done." | `send(to=<best-fit helper>, message=…)`. Returns to your work; the helper's reply lands in your inbox. |
| "Ask helper-a what they think." | `ask(to="helper-a", question=…)`. |
| "Did anyone reply?" | `inbox()` then summarizes what came back. |
| "Who's around?" | `whois()` rendered as a clean list. |
| "Remember that we picked Polar over Stripe." | `remember(kind="decision", content="…")`. |
| "Give me a handoff brief." | `session_brief()` with active agents, tasks, memories, and recent messages. |

The slash command is bundled in the repo at
[`docs/commands/main.md`](commands/main.md). One-time install for new
machines:

```bash
mkdir -p ~/.claude/commands
curl -fsSL https://raw.githubusercontent.com/MustaphaSteph/agent-bus/main/docs/commands/main.md \
  -o ~/.claude/commands/main.md
```

**Failure modes**:

- No helpers registered → the agent will tell you "nobody else is on
  the bus yet" instead of routing into the void.
- Agent makes the wrong tool choice → tell it explicitly ("use `ask`,
  not `send`"). The slash command's playbook covers the common cases
  but is not exhaustive.
- You want to bypass priming and use the raw tools → just describe
  the tool call directly, the agent will still execute it.

## 1. Listener mode

**When**: you want a session to act as a long-running responder, like a
specialist agent that's "always on" and answers questions from other
sessions.

**How (Claude Code)**: in any new Claude Code session,

```
/listen alpha
```

The slash command registers the session as `alpha`, optionally marks it
as a listener for Stop-hook auto-resume, and enters a blocking
`inbox(wait_s=110)` loop. It silently handles incoming messages:
`reply` for asks, `send` for direct messages.

**How (Codex or any MCP agent)**:

```bash
agent-bus listen-prompt my-codex | pbcopy
```

Paste into a new chat. Same behavior.

For more copy-paste registration, verifier, and listener prompts, see
[`agent-prompts.md`](agent-prompts.md).

**Failure modes**:

- Claude ends the turn unexpectedly → install the Stop hook to auto-resume.
- Tool round-trip takes seconds per cycle → that's Claude's reasoning,
  not the bus. Use a smaller model in the listener session if you can.
- Listener process killed mid-message → at-most-once delivery means the
  message is lost. Use the at-least-once pattern below for reliability.

## 2. Synchronous Q&A

**When**: one session asks another a question and waits for the answer
before continuing.

**How**: the asker calls `ask`, the answerer calls `reply`.

```
// Asker:
ask({ from: "human", to: "alpha", question: "...", timeout_s: 60 })

// Answerer (when its inbox returns the ask):
reply({ from: "alpha", ask_id: <id>, answer: "..." })
```

`ask` blocks up to 110 s (Claude Code's tool timeout). The answerer must
be in listener mode or actively polling to respond within that window.

**Failure modes**: `ASK_TIMEOUT` if no reply arrives, `ASK_CYCLE` if the
answerer has its own pending ask back to you.

## 3. Capability routing (don't know who to ask)

**When**: you want help with X but don't know which agent specializes
in X.

**How**: registered agents declare capabilities; the asker uses
`ask_best`.

```
// Listeners register with capabilities:
register({ name: "fe-bot", capabilities: ["react", "css", "tailwind"] })

// Asker doesn't need to know the name:
ask_best({ from: "human", capability: "react", question: "..." })
```

The bus picks the agent with that capability that has the most recent
`last_seen`. Refuses matches stale beyond 5 minutes.

**Failure modes**: `UNKNOWN_AGENT` if no registered agent has the
capability, or the best candidate is stale.

## 4. Broadcast to a team

**When**: an event is relevant to multiple agents (CI failed, PR landed,
new task available).

**How**: agents subscribe to a channel; broadcasters fan out via
`send_channel`.

```
// Each interested agent:
subscribe({ agent: "alice", channel: "ci-alerts" })
subscribe({ agent: "bob",   channel: "ci-alerts" })

// Anyone who detects the event:
send_channel({ from: "ci", channel: "ci-alerts", message: "build failed" })
```

`send_channel` inserts one message per subscriber. Each subscriber
receives it in their normal inbox; `m.channel` is set to the channel
name so they know the source.

**Failure modes**: channel with no subscribers → `send_channel` returns
an empty array (silent no-op).

## 5. At-least-once delivery

**When**: the recipient does something irreversible or expensive
(deploys, writes to external systems, calls paid APIs) and must not
lose messages.

**How**: pass `claim_s` to `inbox`, then `ack` after success.

```js
while (true) {
  const msgs = await inbox({ agent: "deployer", wait_s: 110, claim_s: 600 })
  for (const m of msgs) {
    try {
      await runDeploy(m.content)
      ack({ agent: "deployer", message_id: m.id })
    } catch (e) {
      log("will retry: " + e.message)
      // no ack — claim expires in 600s and the message redelivers
    }
  }
}
```

Pick `claim_s` to be **longer than your worst-case processing time** so
you have a chance to ack before the claim expires.

**Failure modes**: if the consumer's work is non-idempotent and it
crashes after the work but before the ack, the work happens twice.
Idempotency of the actual work is the consumer's job.

## 6. Conversation threading

**When**: two agents trade multiple messages back and forth and you want
to read the chain later.

**How**: thread IDs auto-flow. The listener prompt already passes the
incoming `thread_id` back when it sends a reply, so any chain that
starts with a single `send` or `ask` stays threaded.

```js
const first = send({ from: "a", to: "b", message: "..." })
// first.thread_id is auto-generated

// b's response inherits:
send({ from: "b", to: "a", message: "...", thread_id: first.thread_id })

// Later, read the whole chain:
thread({ thread_id: first.thread_id })
```

`agent-bus log` and `agent-bus watch` don't visually group by thread yet
(could be a Tier-2 improvement) — use the `thread` MCP tool from any
session.

## 7. Human-in-the-loop relay

**When**: you're the human and you want to manually pass messages
between two sessions, with full visibility, no auto-pickup.

**How**: don't use `/listen`. Just register names in each session, and
use `agent-bus inject` from your shell.

```bash
agent-bus inject --from human --to alpha "look at src/foo.ts"
# Then in alpha's session: "check my inbox"
# Read the response in agent-bus watch
# Inject the next message
```

Pair with `agent-bus watch` in a third terminal for visibility.

## 8. Catching up after restart

**When**: you start a fresh Claude Code session and want to know what
agents and channels exist.

**How**: ask the agent to call `whois` and `recent`.

```
Call agent-bus whois to list all agents, then recent(limit=20) to see
the last 20 messages.
```

Pending messages addressed to your name (if you keep one consistent
across restarts) are still in the bus and will be returned by your
first `inbox` call.

## 9. Cross-tool (Claude ↔ Codex)

**When**: you want Claude Code and Codex sessions to collaborate.

**How**: install agent-bus in both, register both with different names,
then exchange messages just like Claude-to-Claude.

```
# Claude Code terminal:
/listen claude-frontend

# Codex Desktop chat (after pasting listen-prompt):
codex-backend listening on agent-bus.

# A third Claude session:
"register me as orchestrator, ask claude-frontend for the React patterns,
 then forward the answer to codex-backend with implementation context."
```

The bus doesn't care which tool spoke — it's all just MCP messages and
SQLite rows.

## 10. Delegate and track work

**When**: one session wants another session to implement, verify, or
investigate something, and a plain message is too hard to track.

**How**: create a task, optionally send the assignee its thread, then let
workers claim and update state.

```js
const task = create_task({
  requested_by: "orchestrator",
  title: "Verify the current diff",
  description: "Run the smoke tests and report findings first.",
  priority: 10,
  cwd: "/Users/air/Documents/Projects/agent-bus",
})

send({
  from: "orchestrator",
  to: "verifier",
  message: `Please claim task #${task.id} and verify it.`,
  thread_id: task.thread_id,
})
```

The verifier:

```js
claim_task({ agent: "verifier", task_id: task.id })
update_task({ agent: "verifier", task_id: task.id, state: "working" })
// ...run review/tests...
update_task({
  agent: "verifier",
  task_id: task.id,
  state: "completed",
  result: "No findings. npm test passed.",
})
```

Use `list_tasks` or `agent-bus tasks --watch` to see pending and active
work. Active tasks can show `stale: true` if their holder has not
heartbeated recently; release them explicitly instead of relying on
automatic requeue.

**Failure modes**:

- Two agents try to claim the same task -> one gets `TASK_NOT_CLAIMABLE`.
- Holder disappears -> task is marked stale in listings; a human or
  orchestrator decides whether to release it.
- Worker hits a dependency -> move to `blocked` with `blocked_reason`
  and optionally `blocked_on_task_id`.

## 11. Multi-project and multi-area workspace

**When**: you run multiple Claude Code or Codex sessions across different
repos on the same machine, or several teams inside one repo (`ios`,
`backend`, `frontend`).

**How**: keep one shared bus, but let each session register with a
project derived from its repo cwd. Add `.agent-bus.json` when one repo
has multiple work lanes:

```json
{
  "project": "my-app",
  "areas": {
    "ios": ["ios/**"],
    "backend": ["backend/**", "api/**"],
    "frontend": ["frontend/**", "web/**"]
  }
}
```

MCP sessions do this automatically. Read commands and routing default to
the current project and area:

```js
register({ name: "agent-bus-verifier", capabilities: ["verification"] })
list_tasks({})              // current project
whois({})                   // current project/area + null legacy agents
ask_best({ from: "agent-bus-codex", capability: "verification", question: "..." })
```

Use the wildcard when you intentionally want global visibility:

```js
list_tasks({ project: "*" })
list_tasks({ area: "*" })   // all areas in current project
recent({ project: "*" })
ask_best({ from: "agent-bus-codex", capability: "security", question: "...", project: "*", area: "*" })
```

CLI commands derive the project from your shell cwd:

```bash
agent-bus tasks
agent-bus watch
agent-bus whois

agent-bus tasks --project all
agent-bus watch --project all
agent-bus tasks --area all
```

When a project manager creates work for a lane, set the target area on
the task:

```js
create_task({ requested_by: "pm", title: "fix iOS login", area: "ios" })
```

**Failure modes**:

- Agent names are still globally unique. Use project-prefixed names like
  `agent-bus-verifier` and `vidcut-verifier`.
- `ask_best` does not silently route across projects or concrete areas.
  If there is no in-scope match, pass `project: "*"` or `area: "*"`
  explicitly.
- CLI `inject` and CLI `register` are relay/admin commands and default
  to global/null project.

## 12. Codex as manager for an existing web app

**When**: you already have a web app and want one Codex session to plan,
assign, and review work while Claude/Codex worker sessions handle
frontend, backend, and verification lanes.

**How**: add a repo-level `.agent-bus.json` first:

```json
{
  "project": "webapp",
  "areas": {
    "frontend": ["src/**", "app/**", "pages/**", "components/**"],
    "backend": ["api/**", "server/**", "routes/**", "db/**"],
    "tests": ["test/**", "tests/**", "e2e/**", "__tests__/**"],
    "docs": ["docs/**", "README.md"]
  }
}
```

Start Codex in the repo root and paste:

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

Start worker sessions:

```text
Register yourself as webapp-frontend with role worker, area frontend,
capabilities react, typescript, css, ui, replace true. Listen for
assigned tasks. Only edit files inside the task file_scope.
```

```text
Register yourself as webapp-backend with role worker, area backend,
capabilities node, api, database, auth, replace true. Listen for
assigned tasks. Only edit files inside the task file_scope.
```

```text
Register yourself as webapp-verifier with role verifier, area "*",
capabilities test, review, qa, replace true. Do not edit implementation
files. Review diffs, run tests, report bugs and risks.
```

Then talk to the manager naturally:

```text
Create frontend, backend, and verifier tasks for password reset.
Assign frontend UI to webapp-frontend and backend API to webapp-backend.
Ask the verifier to review the current diff.
Record a pinned handoff memory for what remains.
```

**Failure modes**:

- Worker edits outside `file_scope` -> stop and reassign with a narrower
  task. The bus records scope; agents must still respect it.
- Verifier starts implementing -> set its task mode to `test_only` and
  remind it not to edit implementation files.
- Manager cannot find a worker -> call `directory`, start the missing
  listener, or use `area: "*"` / `project: "*"` intentionally.
