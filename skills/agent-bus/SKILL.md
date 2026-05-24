---
name: agent-bus
description: Coordinate work across Claude/Codex/Cursor sessions on the same machine via a local message bus. Use to delegate to helpers, get a second opinion, ask specialists by capability, or track shared tasks.
requires:
  - agent-bus-mcp >= 0.10.0
---

# agent-bus

Turn your Claude / Codex / Cursor / Gemini sessions on the same machine
into a local agent team. Each session registers a name, then you can
send messages, ask blocking questions, delegate tasks, broadcast to
channels, route work by capability/role, track agent status, record
decisions and memories, record task progress, generate session briefs,
and produce merge-readiness reports — all through one SQLite file at
`~/.agent-bus/bus.db`.

This skill is the **coordinator playbook**: when the user speaks
naturally, you translate their intent into agent-bus tool calls.

## Setup check (do this first)

Before using any bus tools, run `scripts/check-setup.sh`. If it exits
non-zero, halt and show the user the install hint it printed. Do not
try to use the bus until the check passes. If the user asks you to fix
the setup, run `scripts/check-setup.sh --install-cli`; it installs or
upgrades `@agent-bus-connect/cli@latest` through npm, then rechecks.

If `mcp__agent-bus__register` is not in your available tools, the MCP
server is not wired into this session. Tell the user to add it — the
exact command varies by client; the README at
<https://github.com/MustaphaSteph/agent-bus#install> has each.

## Identity

This session is the **coordinator**. At the start of any bus
interaction:

1. Call `register` with a stable name (ask the user once, then reuse
   for the rest of the session). Default to the user's first name or
   a short tag they choose. Pass `replace=true` and capabilities
   `["human-driven", "coordinator"]`.
2. Call `directory` if available, otherwise `whois`, and show the user
   who else is on the bus, with
   their capabilities, in one compact line:
   `on the bus: helper-a [review, verify; idle], helper-b [docs; working]`.
   If nobody else is registered, say so.
3. Do NOT enter a listener loop. You are the active driver — only
   check inbox when the user asks or when you've just done an `ask`
   that needs the result surfaced.

## Translating natural language into bus calls

The user speaks normally. You pick the tool. Common patterns:

| When the user says… | You call… |
|---|---|
| "Ask the reviewer / a reviewer to check X" | `ask_best(capability="review", question=…)` if they describe a role; `ask(to=<name>, …)` if they named a specific agent |
| "Get a second opinion on X" | `ask_best(capability="review" or "verify", …)` |
| "Have someone research / find / look up X" | `ask_best(capability="research", …)` |
| "Have someone summarize the docs for X" | `ask_best(capability="docs" or "summarize", …)` |
| "Delegate this to a helper" or "tell someone to…" | `send(to=<best-fit helper>, message=…)`. Don't block; tell the user you dispatched it. |
| "Ask <specific name> to do X" | `ask(from=<your name>, to="<specific name>", question=…)` |
| "Send <specific name> a message: X" | `send(from=<your name>, to="<specific name>", message=…)` |
| "What did <name> say?" / "Did anyone reply?" | `inbox(agent=<your name>)`, then summarize |
| "Who's around?" / "Who's listening?" | `whois()` rendered cleanly |
| "Wait for these workers" / "Are my agents ready?" | `wait_for_agents(names=[…])` and report ready/missing/stale/wrong-scope |
| "Show the team board" / "what is everyone doing?" | `project_board()` rendered with status, active work, review queue, conflicts, pinned risks, handoffs, and next actions |
| "Remember X" / "Note that X" | `remember(by_agent=<your name>, kind="summary", content=…)`; use `pinned=true` for handoffs |
| "Recall X" / "What did we decide about X" | `list_memories()` and `list_decisions()` first; use `ask_best(capability="memory", …)` only if needed |
| "Give me a handoff / session brief" | `session_brief()` |
| "Catch me up on the bus" | `recent(limit=20)` and render |
| "Track this as a task" / "Open a task to do X" | `create_task(requested_by=<your name>, title=…, description=…, mode=…, expected_output=…, file_scope=…)`; set `ack_required` when assigned and `review_required` for implementation work |
| "Assign this to <agent>" | `create_task(...)` then `assign_task(task_id=…, to_agent=…)`; if the worker is not registered yet, use `allow_pending_agent=true`; expect `acknowledge_task(response="claimed")` from the worker |
| "What's on the task list?" | `list_tasks()` and render the active ones |
| "Did <agent> accept the task?" | `get_task(task_id=…)` and inspect `acknowledged_at` / `acknowledged_by`; ask for `acknowledge_task` if missing |
| "Review / approve this task" | `submit_review(reviewer=<your name>, task_id=…, approved=…)`; required reviews gate completion |
| "Hand this task to <agent>" | `handoff_task(from_agent=<current holder>, task_id=…, to_agent=…, reason=…, memory=…)` |
| "Can these agents edit the same files?" | `check_scope_conflicts(file_scope=[…])` before assigning overlapping edit work |
| "Record progress / update phase" | `record_task_event(by_agent=<your name>, task_id=…, event_type="progress", message=…, phase=…)` |
| "Show what happened on this task" | `task_result(task_id=…)` and summarize task, events, test evidence, memories, and thread messages |
| "Cancel this task" | `cancel_task(agent=<your name>, task_id=…, reason=…)` |
| "Record that tests passed/failed" | `record_test_result(by_agent=<your name>, command=…, status=…)` |
| "Put <agent> to sleep" / "wake <agent>" | `sleep_agent(agent=…)` / `wake_agent(agent=…)` |
| "Set <agent> blocked / waiting for review" | `set_agent_status(agent=…, status=…)` |
| "Record this decision…" | `record_decision(by_agent=<your name>, decision=…, rationale=…)` |
| "Final merge report" | `review_gate()` first, then `final_report()`; render blockers, warnings, implemented work, gaps, risks, tests, and safe-to-commit/push flags |

## When to choose ask vs send

- **`ask` (synchronous, blocks up to 110s)** — when the user is
  waiting for the answer to continue.
- **`send` (fire-and-forget)** — when the user wants to delegate and
  keep working. Tell them it's dispatched; offer to check the inbox
  on demand.

## When to choose a specific name vs ask_best

- **Specific name** — user named the helper ("ask helper-a", "send
  reviewer"). Use `ask`/`send` directly.
- **Role / capability** — user described a skill ("a reviewer", "the
  researcher", "someone who knows the schema"). Use `ask_best` and
  let the bus route. If `ask_best` fails with `UNKNOWN_AGENT`, surface
  the error verbatim — the user may want to spin up a helper.
- **Area / project** — by default, routing and reads stay in the current
  repo-derived project and `.agent-bus.json` area. Use `area: "*"` or
  `project: "*"` only when the user asks for cross-area/global routing.

## How to talk while calling tools

Be transparent in ONE short line before each call:

> Asking helper-a (review): "is the token refresh race-free?"

Not:

> I will now invoke the agent-bus MCP `ask_best` tool with the
> parameter `capability` set to `"review"`...

When a reply lands, render it in plain English for the user. Don't
dump JSON. The user wants the answer, not the message envelope.

## Project and area addressing

By name still works (`send` / `ask` are direct addressed). `ask_best`,
`directory`, `recent`, and task reads default to the current
project/area. If the user asks broadly ("any reviewer anywhere"), pass
`project: "*"` and/or `area: "*"` intentionally.

For multi-folder repos, use areas to prevent accidental chatter. Agents
working in one area should normally route to agents in the same area.
A coordinator at the repo root can use `area: "*"` to see or route
across all areas when the user wants cross-area coordination.

## Manager workflow defaults

- Use `project_board()` as the task board: show `idle`, `working`,
  `blocked`, `waiting_review`, `sleeping`, active tasks, review queue,
  scope conflicts, pinned risks, handoffs, and suggested next actions.
- When creating tasks, set `mode` conservatively:
  `investigate_only` for analysis, `propose_patch` for patch sketches,
  `edit_files` only when edits are intended, and `test_only` for
  verifier sessions.
- Set `expected_output` so replies are comparable. Prefer:
  `Summary / Files inspected / Findings / Suggested fix / Risks /
  Test plan / Confidence`.
- Set `file_scope` when multiple agents may edit. Keep ownership
  disjoint and project-specific, such as one glob per component,
  package, app, service, or docs lane.
- Prefer `edit_scope` for files a worker may modify and `read_scope`
  for files a verifier may inspect. A broad verifier `read_scope` should
  not block a worker's edit ownership.
- Set `ack_required=true` when assigning work. A claimed task is not
  operationally accepted until the worker records `acknowledge_task`.
- Use `wait_for_agents` before assuming planned workers are online. Use
  `assign_task(..., allow_pending_agent=true)` when planning assignments
  before a worker session has registered.
- Set `review_required=true` for implementation work that should be
  checked by a verifier. The task cannot be completed until a reviewer
  records `submit_review(approved=true)`.
- Use `check_scope_conflicts` before assigning overlapping `edit_files`
  or `propose_patch` work. Split ownership when conflicts are real.
- Use `handoff_task` when a worker stops mid-task; it records a pinned
  handoff memory and can reassign the task in one step.
- Record durable decisions with `record_decision` when the team settles
  an approach. Use `list_decisions` before reopening an old debate.
- Record durable handoffs, summaries, risks, todos, and blockers with
  `remember`. Pin handoffs that the next agent should see first. Use
  `session_brief` at the start of a fresh session or before handing work
  to another agent.
- Record explicit build, lint, unit test, browser smoke, and manual
  verification evidence with `record_test_result`; final reports surface
  these rows.
- Record progress or phase changes with `record_task_event` so managers
  can tell "agent did not answer ask" apart from "task is still active".
- Use `task_result` before verifier review and handoff; it bundles task
  state, task events, test results, memories, and thread messages.
- Use `cancel_task` when work is superseded or intentionally stopped.
- Use `review_gate` and `final_report` before commit/push/deploy
  decisions.

For an existing project, let the user or current agent decide the team
shape. A common pattern is one coordinator, one or more area-focused
workers, and an optional reviewer/tester, but the bus should not assume
or enforce those roles. Use task `mode`, `expected_output`,
`file_scope`, `edit_scope`, and `read_scope` to describe each task
instead of relying on naming conventions.

For repeated app folders, use `agent-bus team init-folder --project
<unique-project> --area <area>` inside each new app subfolder. This
creates only neutral project/area scope. Agent roles, prompts, task
strategy, and implementation behavior belong to the user or the active
agent session, not to the bus itself.

## Hard rules

- Do not auto-poll the inbox between user turns. Only check inbox when
  the user asks ("any replies?") or after an `ask` that returns one
  you should surface.
- Do not enter a listener loop. You are not a worker; you are the
  driver. (For listener-mode sessions, see the separate `/listen`
  workflow, not this skill.)
- If the user wants you to pause bus translation, stop interpreting
  their messages as bus commands but stay registered.
- If a tool call fails, surface the error code (`UNKNOWN_AGENT`,
  `ASK_TIMEOUT`, `ASK_CYCLE`, `NAME_TAKEN`, `TASK_NOT_CLAIMABLE`,
  `TASK_INVALID_TRANSITION`, `TASK_FORBIDDEN`) and the recovery hint.
- Don't fabricate helper names. If `whois` shows nobody with the role
  the user asked for, say "no <role> helper is on the bus right now"
  and ask if they want to spin one up.
- Helper agents must not deploy, push, publish, or modify shared
  production resources unless the user explicitly approves.

## When to load more context

For deeper detail, read these references on demand:

- `references/tools.md` — the 47 MCP tools with input/output shapes
  and every error code. Load when you need the exact contract for a
  rare tool (e.g. `subscribe`, `send_channel`, `assign_task`,
  `record_decision`, `record_task_event`, `task_result`,
  `record_test_result`, `remember`, `session_brief`, `review_gate`).
- `references/patterns.md` — the listener loop, verifier prompt,
  ack/retry pattern, channel fan-out, task delegation. Load when the
  user asks "set up a listener", "make this reliable", "broadcast
  to…", or anything you can't answer from this top-level page.

Don't pre-load the references. Pull them only when the immediate
intent calls for them.

## Failure modes worth knowing

| Symptom | Cause | What you do |
|---|---|---|
| `UNKNOWN_AGENT` on send/ask | recipient name typo or never registered | tell the user, suggest `whois` to see who's available |
| `NAME_TAKEN` on register | name held by another active session | pass `replace: true` (with user's consent) or pick a different name |
| `ASK_TIMEOUT` | recipient didn't reply in time | tell the user, suggest re-sending as `send` or asking the user to nudge the recipient session |
| `ASK_CYCLE` | mutual deadlock — recipient has a pending ask to you | resolve their ask first, then retry |
| The user names a helper that isn't on the bus | not registered | offer to spin up a listener (`/listen <name>` in Claude Code, or paste `agent-bus listen-prompt <name>` output into Codex/Cursor) |
| Setup check fails | MCP not installed / wrong version | print install hint; if the user approves, run `scripts/check-setup.sh --install-cli`, then retry |
