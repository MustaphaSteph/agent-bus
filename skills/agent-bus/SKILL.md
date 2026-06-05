---
name: agent-bus
description: Coordinate work across Claude/Codex/Cursor sessions on the same machine via a local message bus. Use to delegate to helpers, get a second opinion, ask specialists by capability, or track shared tasks.
requires:
  - agent-bus-mcp >= 0.25.0
---

# agent-bus

Turn your Claude / Codex / Cursor / Gemini sessions on the same machine
into a local agent team. Each session registers a name, then you can
send messages, ask blocking questions, delegate tasks, broadcast to
channels, message scoped teams, route work by capability/role, track
agent status, record decisions and memories, record task progress,
generate session briefs, and produce merge-readiness reports — all
through one SQLite file at `~/.agent-bus/bus.db`.

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

1. Call `register` with a stable name and a concrete `team`. Ask the
   user once for any missing name or team, then reuse both for the rest
   of the session. Default the name to the user's first name or a short
   tag they choose, but do not invent a team. Pass `replace=true`,
   `team=<team>`, and capabilities `["human-driven", "coordinator"]`.
   Do not register without a team.
2. Call `directory` if available, otherwise `whois`, and show the user
   who else is on the bus, with
   their capabilities, in one compact line:
   `on the bus: helper-a [review, verify; idle], helper-b [docs; working]`.
   If nobody else is registered, say so.
3. Do NOT enter a listener loop. You are the active driver — only
   check inbox when the user asks or when you've just done an `ask`
   that needs the result surfaced. When checking inbox in a team
   workflow, pass your concrete `team`.

## Translating natural language into bus calls

The user speaks normally. You pick the tool. Common patterns:

| When the user says… | You call… |
|---|---|
| "Ask the reviewer / a reviewer to check X" | `ask_best(capability="review", question=…)` if they describe a role; `ask(to=<name>, …)` if they named a specific agent |
| "Get a second opinion on X" | `ask_best(capability="review" or "verify", …)` |
| "Have someone research / find / look up X" | `ask_best(capability="research", …)` |
| "Have someone summarize the docs for X" | `ask_best(capability="docs" or "summarize", …)` |
| "Ask the UI team / backend team / <team> team X" | `ask_team(team=<team>, question=…)`; add `capability` or `role` if the user wants a specialist inside that team |
| "Tell the <team> team X" / "message everyone on <team>" | `send_team(team=<team>, message=…)` |
| "Show team chat" / "watch the <team> conversation" | If using CLI, run `agent-bus team-chat --team <team>` or `agent-bus team-chat --team <team> --watch`; with MCP, use `recent(team=<team>)` and render only that team scope |
| "Listen only to my team" / "keep checking this team" | `inbox(agent=<your name>, team=<team>, wait_s=110, claim_s=300)`; use `inbox_status(agent=<your name>, team=<team>)` for non-consuming checks |
| "Inbox is too large" / "message got truncated" | Use `inbox_previews(agent=<your name>, team=<team>)`, then `get_message(message_id=…, team=<team>, include_content=false)` or fetch one full message only when needed |
| "Delegate this to a helper" or "tell someone to…" | `send(to=<best-fit helper>, message=…)`. Don't block; tell the user you dispatched it. |
| "Ask <specific name> to do X" | `ask(from=<your name>, to="<specific name>", question=…)` only if they are online/listening and the user needs the answer now; otherwise `ask_async(from=<your name>, to="<specific name>", question=…)` |
| "Send <specific name> a message: X" | `send(from=<your name>, to="<specific name>", message=…)` |
| "What did <name> say?" / "Did anyone reply?" | `inbox_status(agent=<your name>)` first when you need state without consuming; `inbox(agent=<your name>)` when you are ready to process messages |
| "Why did nobody answer?" | `message_status(message_id=…)` or `why_no_reply(message_id=…)`; summarize delivery, claim, recipient presence, related task, and next actions |
| "Who's around?" / "Who's listening?" | `whois()` rendered cleanly |
| "Wait for these workers" / "Are my agents ready?" | `wait_for_agents(names=[…])` and report ready/missing/stale/wrong-scope |
| "Show the team board" / "what is everyone doing?" | `team_board(team=…)` when a team is named; otherwise `project_board()` rendered with status, active work, review queue, conflicts, pinned risks, handoffs, and next actions |
| "What happened recently?" / "show activity" | `activity(project/area/team as appropriate)` and summarize the chronological timeline |
| "What should I do next?" / "show cockpit" | `cockpit(project/area/team as appropriate)` and report waiting items, ready items, blockers, and suggested next actions |
| "Remember X" / "Note that X" | `remember(by_agent=<your name>, kind="summary", content=…)`; use `pinned=true` for handoffs |
| "Recall X" / "What did we decide about X" | `list_memories()` and `list_decisions()` first; use `ask_best(capability="memory", …)` only if needed |
| "Give me a handoff / session brief" | `session_brief()` |
| "Catch me up on the bus" | `recent(limit=20)` and render |
| "Track this as a task" / "Open a task to do X" | `create_task(requested_by=<your name>, title=…, description=…, mode=…, expected_output=…, file_scope=…)`; set `ack_required` when assigned and `review_required` for implementation work |
| "Delegate this to <agent>" / "Assign this to <agent>" | Prefer `delegate(from=<your name>, to_agent=…, title=…, description=…, mode=…, expected_output=…, edit_scope=…)`; if the task already exists, use `assign_task(task_id=…, to_agent=…)`; use `allow_pending_agent=true` when the worker is not registered yet |
| "Delegate this to the <team> team" / "assign this to everyone on <team>" | `delegate_team(from=<your name>, team=<team>, title=…, description=…, mode=…, expected_output=…, edit_scope=…)`; add `capability`, `role`, or `max_recipients` when the user wants only matching members |
| "What's on the task list?" | `list_tasks()` and render the active ones |
| "Show the Kanban board" / "show done tasks" | If using CLI, run `agent-bus kanban` / `agent-bus done`; with MCP, use `list_tasks()` filtered by state and render the same columns |
| "Did <agent> accept the task?" | `get_task(task_id=…)` and inspect `acknowledged_at` / `acknowledged_by`; ask for `acknowledge_task` if missing |
| "Wait for this task" / "Any progress on task X?" | `wait_for_task(task_id=…, wait_s=110)` when you can block, otherwise `task_result(task_id=…)` |
| "Review / approve this task" | `submit_review(reviewer=<your name>, task_id=…, approved=…)`; required reviews gate completion |
| "Hand this task to <agent>" | `handoff_task(from_agent=<current holder>, task_id=…, to_agent=…, reason=…, memory=…)` |
| "Can these agents edit the same files?" | `check_scope_conflicts(file_scope=[…])` before assigning overlapping edit work |
| "Record progress / update phase" | `record_task_event(by_agent=<your name>, task_id=…, event_type="progress", message=…, phase=…)` |
| "What are you working on now?" / "mark current work" | `now(agent=<your name>, task_id=…, phase=…, note=…)` when updating your own visible status/task phase |
| "Move task X to testing / review / done" | With MCP, use `update_task` plus `record_task_event`; with CLI, use `agent-bus task-testing`, `agent-bus task-phase <id> review`, or `agent-bus task-done` |
| "Show what happened on this task" | `task_result(task_id=…)` and summarize task, events, test evidence, memories, and thread messages |
| "Cancel this task" | `cancel_task(agent=<your name>, task_id=…, reason=…)` |
| "Record that tests passed/failed" | `record_test_result(by_agent=<your name>, command=…, status=…)` |
| "Put <agent> to sleep" / "wake <agent>" | `sleep_agent(agent=…)` / `wake_agent(agent=…)` |
| "Set <agent> blocked / waiting for review" | `set_agent_status(agent=…, status=…)` |
| "Record this decision…" | `record_decision(by_agent=<your name>, decision=…, rationale=…)` |
| "Final merge report" | `review_gate()` first, then `final_report()`; render blockers, warnings, implemented work, gaps, risks, tests, and safe-to-commit/push flags |

## When to choose ask vs send

- **`ask` (synchronous, blocks up to 110s)** — when the user is
  waiting for the answer to continue and the recipient is online/listening.
  It fails fast for stale/paused recipients.
- **`ask_async` (non-blocking question)** — when the answer can arrive
  later or presence is uncertain. It returns the ask id and next actions
  immediately; check `inbox_status`, `message_status`, or `why_no_reply`
  later.
- **`send` (fire-and-forget)** — when the user wants to delegate and
  keep working. Tell them it's dispatched; offer to check the inbox
  on demand.
- **`delegate` / `delegate_team` (tracked long work)** — when ownership, progress,
  acknowledgement, review, file scope, or final evidence matters. Use it
  instead of `ask` for work that can outlive one 110s timeout.
- **Board-visible work must be a task.** `send`, `send_team`, `ask`, and
  `ask_team` are messages only; they do not create `open_tasks` or
  `active_tasks` on `project_board` / `team_board`. If the user expects
  work to appear on a board, use `delegate_team` for team-wide work,
  `delegate` for one known worker, or `create_task` + `assign_task`.

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
- **Team** — if agents are registered with `team`, prefer `ask_team`,
  `send_team`, or `team_board` when the user names that workgroup. Use
  `team: "*"` only when the user wants cross-team routing.

## How to talk while calling tools

Be transparent in ONE short line before each call:

> Asking helper-a (review): "is the token refresh race-free?"

Not:

> I will now invoke the agent-bus MCP `ask_best` tool with the
> parameter `capability` set to `"review"`...

When a reply lands, render it in plain English for the user. Don't
dump JSON. The user wants the answer, not the message envelope.

## User-visible bus status

Do not leave the user staring at a silent bus wait. When you call
`ask`, `ask_best`, `ask_team`, `wait_for_task`, or intentional
`inbox(wait_s)` in an active user-facing session:

- Before waiting, say who or what you are waiting on in one short line.
- When the answer or task evidence arrives, immediately say:
  `Got <source>'s answer: <one-line summary>. Continuing locally with <next step>.`
- After receiving the needed answer, stop waiting on the bus. Continue
  the local task in this session unless the user explicitly asked you to
  keep listening.
- If the wait times out but diagnostics show the task is still active,
  say that clearly: `No reply yet, but task #N is still active; I will
  continue with what I have / check again only if needed.`
- Do not chain repeated `inbox`, `inbox_status`, `message_status`, or
  `why_no_reply` calls just because one bus interaction completed.

Example:

```text
Asking verifier for the export risk check.
Got verifier's answer: the main risk is canvas scale parity. Continuing locally by updating the test plan.
```

## Project, area, and team addressing

By name still works (`send` / `ask` are direct addressed). `ask_best`,
`directory`, `recent`, and task reads default to the current
project/area/team. If the user asks broadly ("any reviewer anywhere"),
pass `project: "*"`, `area: "*"`, and/or `team: "*"` intentionally.

For multi-folder repos, use areas to prevent accidental chatter. Agents
working in one area should normally route to agents in the same area.
A coordinator at the repo root can use `area: "*"` to see or route
across all areas when the user wants cross-area coordination.

Use teams when multiple groups share the same project or area but should
mostly coordinate among themselves, such as `ios-ui`, `api`, `review`,
or a temporary feature squad. Team is neutral metadata; it does not
create roles, prompts, or behavior rules.

## Manager workflow defaults

- Use `project_board()` as the task board: show `idle`, `working`,
  `blocked`, `waiting_review`, `sleeping`, active tasks, review queue,
  scope conflicts, pinned risks, handoffs, and suggested next actions.
- Use `team_board(team=…)` when the user is managing one workgroup
  inside a broader project.
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
- Use phases consistently: `planning`, `editing`, `testing`, `review`,
  and `done`. The CLI Kanban maps state plus phase into `Todo`,
  `Accepted`, `Doing`, `Testing`, `Review`, and `Blocked` lanes. Do not
  invent new task states for phases; keep the state machine stable.
- Use `team-chat`/`recent(team=...)` for discussion history and human
  visibility. Use `delegate_team`, `team_board`, `kanban`, and `done`
  for tracked work. A team chat message alone is not a task.
- If an inbox result is too large or likely to truncate, switch to
  `inbox_previews` and `get_message(include_content=false)` before
  reading a full message body. Prefer sending file paths or task
  artifacts for very large briefs.
- `reply` works for both asks and normal messages. For `kind="ask"`, it
  answers the pending ask. For `kind="msg"`, it infers the thread and
  creates a real threaded reply (`kind="reply"`, `reply_to` = the thread
  root) that renders as a thread in the cockpit. For task assignments,
  use the task tools.
- Use `activity` when the user asks what happened recently. Use
  `cockpit` when the user asks what the manager should do next. Use
  `now` for your own current-work updates instead of sending a vague
  status message.
- Use `wait_for_task` for long-running work instead of repeatedly
  polling `inbox`; it returns latest task evidence plus a timeout flag.
- After a bus reply or task update gives enough information to proceed,
  summarize what arrived and continue your local work. Do not keep
  waiting for unrelated bus messages.
- Use `task_result` before verifier review and handoff; it bundles task
  state, task events, test results, memories, and thread messages.
- Use memory intentionally: `remember(kind="decision")` for settled
  team choices, `remember(kind="risk", pinned=true)` for active risks,
  and `remember(kind="handoff", pinned=true)` before a session exits.
  New sessions should call `session_brief` before taking work.
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

When users want several teams inside one project folder, have each
session register with the same project/area and a chosen `team`, for
example `team: "ios-ui"` or `team: "api"`. The bus will route and board
within that scope when tools receive the team filter.

## Hard rules

- Do not auto-poll the inbox between user turns. Only check inbox when
  the user asks ("any replies?") or after an `ask` that returns one
  you should surface.
- Do not keep calling bus tools after you got the answer needed for the
  current step. Tell the user what arrived, then continue the local task.
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

- `references/tools.md` — the 63 MCP tools with input/output shapes
  and every error code. Load when you need the exact contract for a
  rare tool (e.g. `subscribe`, `send_channel`, `send_team`,
  `ask_team`, `team_board`, `assign_task`, `record_decision`,
  `record_task_event`, `task_result`, `record_test_result`,
  `remember`, `session_brief`, `review_gate`).
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
