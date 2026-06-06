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
| "Delegate this to a helper and tell me when it's done." | `delegate(...)` for tracked work, or `send(to=<best-fit helper>, message=…)` for a lightweight note. |
| "Ask helper-a what they think." | `ask(to="helper-a", question=…)` if helper-a is listening; `ask_async(to="helper-a", question=…)` if the answer can arrive later. |
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
`inbox(wait_s=110)` loop. It handles incoming messages with `reply`:
asks become answered and ordinary messages become threaded replies.

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
Use `ask_async` when the recipient is stale, paused, or likely to answer
later.

**Failure modes**: `ASK_RECIPIENT_UNAVAILABLE` if the recipient is stale
or paused, `ASK_TIMEOUT` if no reply arrives, `ASK_CYCLE` if the
answerer has its own active opposite ask back to you.

## 3. Capability routing (don't know who to ask)

**When**: you want help with X but don't know which agent specializes
in X.

**How**: registered agents declare capabilities; the asker uses
`ask_best`.

```
// Listeners register with capabilities:
register({ name: "fe-bot", team: "frontend", capabilities: ["react", "css", "tailwind"] })

// Asker doesn't need to know the name:
ask_best({ from: "human", capability: "react", question: "..." })
```

The bus picks the agent with that capability that has the most recent
`last_seen`. Refuses matches stale beyond 5 minutes.

**Failure modes**: `UNKNOWN_AGENT` if no registered agent has the
capability, or the best candidate is stale.

## 4. Broadcast to a channel or scoped team

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

When agents are registered with the same neutral `team`, use direct team
routing instead of managing channel subscriptions:

```js
register({ name: "pm", project: "movie-app", area: "*", team: "ios-ui" })
send_team({ from: "pm", team: "ios-ui", message: "sync on navigation" })
ask_team({ from: "pm", team: "ios-ui", capability: "design", question: "which layout should we build?" })
delegate_team({ from: "pm", team: "ios-ui", capability: "design", title: "Compare detail screen options", mode: "investigate_only" })
team_board({ team: "ios-ui", project: "movie-app" })
```

Team scope is only routing metadata. The agent prompt and task fields
still decide behavior, roles, and permissions.

For a human-readable team conversation, use the CLI view:

```bash
agent-bus team-chat --team ios-ui
agent-bus team-chat --team ios-ui --watch
agent-bus team-chat --team ios-ui --from pm "status update?"
```

Team chat is conversation, not workflow state. If the user expects an
item to appear on `team_board`, `kanban`, or `done`, create a tracked
task with `delegate_team` or `delegate`.

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
then exchange messages agent-to-agent.

```
# Terminal A:
/listen worker-a

# Terminal B or another agent UI:
worker-b listening on agent-bus.

# Coordinator session:
"register me as coordinator, ask worker-a for input, then forward the
 answer to worker-b with implementation context."
```

The bus doesn't care which tool spoke — it's all just MCP messages and
SQLite rows.

## 10. Delegate and track work

**When**: one session wants another session to implement, verify, or
investigate something, and a plain message is too hard to track.

**How**: use `delegate` when the coordinator already knows the assignee.
It creates the task, assigns it, notifies the worker, requires
acknowledgement by default, and records the delegation event.

Plain `send`, `send_team`, `ask`, and `ask_team` calls are messages only.
They do not create tasks and will not appear on `project_board`,
`team_board`, `kanban`, or `done`. If the user expects board tracking,
create a task with `delegate`, `delegate_team`, or `create_task` +
`assign_task`.

```js
const result = delegate({
  from: "orchestrator",
  to_agent: "verifier",
  title: "Verify the current diff",
  description: "Run the smoke tests and report findings first.",
  priority: 10,
  cwd: "/Users/air/Documents/Projects/agent-bus",
  mode: "test_only",
  expected_output: "Findings, risks, and test evidence.",
  read_scope: ["**/*"],
})
```

The verifier:

```js
acknowledge_task({ agent: "verifier", task_id: result.task.id, response: "claimed" })
update_task({ agent: "verifier", task_id: result.task.id, state: "working" })
// ...run review/tests...
record_test_result({ by_agent: "verifier", task_id: result.task.id, command: "npm test", status: "passed" })
update_task({
  agent: "verifier",
  task_id: result.task.id,
  state: "completed",
  result: "No findings. npm test passed.",
})
```

Use `wait_for_task` when blocking for progress is useful, and
`task_result` before review/handoff. Use `list_tasks` or
`agent-bus tasks --watch` to see pending and active work. Active tasks
can show `stale: true` if their holder has not heartbeated recently;
release them explicitly instead of relying on automatic requeue.

**Failure modes**:

- Two agents try to claim the same task -> one gets `TASK_NOT_CLAIMABLE`.
- Holder disappears -> task is marked stale in listings; a human or
  orchestrator decides whether to release it.
- Worker hits a dependency -> move to `blocked` with `blocked_reason`
  and optionally `blocked_on_task_id`.

## 11. Multi-project and multi-area workspace

**When**: you run multiple AI sessions across different repos on the
same machine, or several work lanes inside one repo.

**How**: keep one shared bus, but let each session register with a
project derived from its repo cwd. Add `.agent-bus.json` when one repo
has multiple work lanes:

```json
{
  "project": "my-app",
  "areas": {
    "area-a": ["area-a/**"],
    "area-b": ["area-b/**"],
    "docs": ["docs/**"]
  }
}
```

For separated folders/repos, give them the same logical project and a
fixed area in each folder:

```json
{
  "project": "my-app",
  "area": "area-a"
}
```

```json
{
  "project": "my-app",
  "area": "area-b"
}
```

The physical paths can be completely different, such as `/a/p1` and
`/b/p2`; the shared project name is what links the agents.

For app factories where each app is a new subfolder under one parent,
prefer one unique project per app folder:

```bash
mkdir AppOne && cd AppOne
agent-bus team init-folder --project app-one --area app

cd ..
mkdir AppTwo && cd AppTwo
agent-bus team init-folder --project app-two --area app
```

Each folder is isolated by project even though it lives under the same
parent. The helper writes only neutral project/area scope; your agent
prompt or team convention decides roles, tasks, and behavior. Add
`team` at registration time when several workgroups share that project.

MCP sessions do this automatically. Read commands and routing default to
the current project and area:

```js
register({ name: "worker-a", team: "frontend", capabilities: ["tests"] })
list_tasks({})              // current project
whois({})                   // current project/area + null legacy agents
ask_best({ from: "coordinator", capability: "tests", question: "..." })
```

Use the wildcard when you intentionally want global visibility:

```js
list_tasks({ project: "*" })
list_tasks({ area: "*" })   // all areas in current project
recent({ project: "*" })
ask_best({ from: "coordinator", capability: "security", question: "...", project: "*", area: "*" })
ask_team({ from: "coordinator", team: "*", capability: "review", question: "any reviewer anywhere?" })
```

CLI commands derive the project from your shell cwd:

```bash
agent-bus tasks
agent-bus watch
agent-bus whois

agent-bus tasks --project all
agent-bus watch --global
agent-bus tasks --area all
```

When a project manager creates work for a lane, set the target area on
the task:

```js
create_task({ requested_by: "coordinator", title: "investigate issue", area: "area-a" })
```

**Failure modes**:

- Agent names are still globally unique. Use stable names that include
  enough project or role context for your team.
- `ask_best` does not silently route across projects or concrete areas.
  If there is no in-scope match, pass `project: "*"` or `area: "*"`
  explicitly.
- CLI `inject` and CLI `register` are relay/admin commands and default
  to global/null project.

## 12. Coordinator for an existing project

**When**: you already have a project and want one AI session to plan,
assign, and review work while other sessions handle scoped tasks.

**How**: add a repo-level `.agent-bus.json` first:

```json
{
  "project": "my-project",
  "areas": {
    "area-a": ["area-a/**"],
    "area-b": ["area-b/**"],
    "docs": ["docs/**", "README.md"]
  }
}
```

Start the coordinator in the repo root and adapt this template:

```text
You are <coordinator-name> for this repo. Use agent-bus as the coordination layer.

Register as <coordinator-name> with role pm, area "*", capabilities
["planning","coordination"], replace true.

Your job:
- inspect the project structure
- create tasks with clear mode, expected_output, and file_scope
- assign tasks only to agents that match the user’s requested workflow
- use ask_best when no exact agent is named
- use test_only/review tasks only when the user wants independent review
- record decisions with record_decision
- record pinned handoffs with remember(kind="handoff", pinned=true)
- record phases with record_task_event: planning, editing, testing, review, done
- use pinned memories for decisions, risks, and handoffs that new sessions need
- use session_brief at start and final_report before commit/push
- do not let agents edit outside their file_scope/edit_scope
- do not push/deploy unless I explicitly approve

First call directory and session_brief, then tell me who is available
and what the next task should be.
```

Start worker sessions:

```text
Register yourself as <worker-name> with role worker, area <area>,
team <team>, capabilities <capability-list>, replace true. Listen only
to team <team>. Only edit files inside the task file_scope.
```

```text
Register yourself as <reviewer-name> with role reviewer, area "*",
team <team>, capabilities <capability-list>, replace true. Follow the task mode. For
test_only/review tasks, inspect changes and report bugs and risks
without implementation edits unless explicitly reassigned.
```

Then talk to the manager naturally:

```text
Create scoped tasks for this goal.
Assign each task to the matching available agent.
Ask the reviewer to review the current diff.
Record a pinned handoff memory for what remains.
```

**Failure modes**:

- Agent edits outside `file_scope` -> stop and reassign with a narrower
  task. The bus records scope; agents must still respect it.
- Reviewer starts implementing -> set its task mode to `test_only` and
  clarify that implementation edits are not part of that task.
- Coordinator cannot find a worker -> call `directory`, start the missing
  listener, or use `area: "*"` / `project: "*"` intentionally.
