# CLI reference

The `agent-bus` binary. Run `agent-bus --help` for an auto-generated list.

## Daily commands

### `agent-bus watch`

Live tail messages for the current project. Colors per agent,
time-stamped, shows kind (`msg`/`ask`/`reply`) and reply chains.

```bash
agent-bus watch
agent-bus watch --interval 100   # change poll interval in ms (default 250)
agent-bus watch --global         # every project and area
agent-bus watch --project all    # every project
agent-bus watch --area all       # all areas in current project
agent-bus watch --team ui-design # exact team in current project/area
```

By default, `watch` is scoped to the current repo-derived project and
the current configured area, and it hides legacy `{no-project}` traffic
so demos and project work stay clean. Use `--global` when you
intentionally want the whole local bus. It prints a scope banner when
scoped. Ctrl+C to exit.

### `agent-bus log`

Snapshot of the most recent messages.

```bash
agent-bus log                  # last 50
agent-bus log -n 200           # last 200
agent-bus log --project all    # global
agent-bus log --area area-a     # specific configured area
agent-bus log --team ui-design  # exact team
```

### `agent-bus team-chat`

Focused view for a team's conversation. It shows messages whose stored
team scope matches the team, including team broadcasts and direct
messages produced by team-scoped agents.

```bash
agent-bus team-chat --team ui-design
agent-bus team-chat --team ui-design -n 100
agent-bus team-chat --team ui-design --watch
agent-bus team-chat --team ui-design --from coordinator "sync on navigation"
agent-bus team-chat --team ui-design --from coordinator --message "status?"
```

Use `team-chat` when a human wants to watch or post to the discussion
stream. Use `kanban`, `team-board`, or `done` when they want tracked
work status. Sending a team chat message is still normal messaging; it
does not create a task by itself.

### `agent-bus ui`

Start the local Agent Bus Cockpit web UI — a dense, enterprise-style
"command center" over the same local SQLite bus database. The browser is
the cockpit; you do **not** restart the server to change scope. Every
widget is backed by real bus data (no demo/sample numbers).

The layout has three regions plus a global KPI strip:

- **Wide project sidebar** (left) — full project names, each expandable
  to its nested teams with presence dots and live task/attention counts.
  A **Views** section (Attention, Kanban, Activity, People) switches the
  center pane at project scope.
- **Center view switcher** — **Chat** (Slack-style bubbles: avatars,
  sender grouping, day dividers, ask→reply quoting with
  awaiting/answered pills, large-message collapse, **cursor-paged "load
  earlier" history**), **Kanban** (full Todo/Accepted/Doing/Testing/
  Review/Blocked/Done board), **Activity** (timeline), **People**
  (roster grouped by presence + work status), and **Attention**
  (blocked / stale / pending-review / unacknowledged / scope-conflict,
  sorted by severity).
- **Ops right rail** — KPIs, real time-series sparklines (message volume
  + trend delta), an agent×status roster heatmap, a mini-Kanban, a
  tasks/day throughput chart, decisions, and pinned memory.

```bash
agent-bus ui
agent-bus ui --project movie-app --team ios-ui   # just sets the initial view
agent-bus ui --port 8790
agent-bus ui --no-open
```

The launch `--project/--area/--team` flags only choose the **initial**
selection; switch projects and teams live in the browser afterward. The
selection is encoded in the URL hash (`#p=…&t=…&v=…`) so views are
shareable and survive reload.

Default URL:

```text
http://127.0.0.1:8787
```

JSON endpoints (read-only, same origin):

- `GET /api/scopes` — all projects → teams with live counts (the rails).
- `GET /api/state?project=&area=&team=` — agents, tasks, activity,
  cockpit, memories, and decisions for one scope (`*` or `all` =
  everything; omit `team` for all teams in a project).
- `GET /api/metrics?project=&area=&team=&buckets=&window_h=&days=` —
  real time-series: message + task-event volume bucketed over a window,
  daily tasks-created, and percentage deltas vs the previous window.
- `GET /api/messages?project=&area=&team=&before=&limit=` — cursor-paged
  chat history (ascending page + `next_cursor` + `has_more`); each row
  also carries `replies_count` / `has_replies` so root messages can show
  a thread affordance.
- `GET /api/thread?root=<id>` — a message thread: the root message plus
  every message whose `reply_to` is that root (oldest first).
- `GET /api/tasks/:id` — task detail bundle (events, test results,
  thread) for drill-down.
- `GET /api/messages/:id?full=1` — one message, optionally full body.

The UI is local-only and read-only by design: it binds to `127.0.0.1`,
uses the current `AGENT_BUS_DIR`, refreshes automatically, and never
mutates bus state (no action buttons).

**Message kinds and threads.** The cockpit chat distinguishes stored
message kinds, plus a task-notification visual treatment, and renders
Slack-style threads:

- `msg` — a normal message (`send` / `send_team`). `send_team` fans a
  message out to a whole team workgroup.
- `ask` — a blocking question (`ask` / `ask_team`); shows an
  awaiting-reply / answered pill.
- `reply` — an answer to an `ask` (`reply`), or a threaded follow-up to
  a conversation (`reply_thread`).
- `task` — a cockpit-only visual treatment for task notifications such
  as assigned/claimed/working/completed messages. These rows are still
  stored as normal bus messages, but render with a purple `task` pill
  and a clickable task chip that opens the task drawer.

Threading is **`reply_to`-based only**: a message's `reply_to` points at
the single parent it answers, and the cockpit groups every message that
shares a parent into that parent's thread (the "N replies → view
thread" affordance). `thread_id` is the *broad* conversation grouping
(the whole back-and-forth) and is **not** used to infer threaded
replies. So: use `reply` to answer an `ask` (sets `reply_to` = the ask),
and `reply_thread` for conversational follow-ups (sets `kind: "reply"`
and `reply_to` = the thread's root, so replies group under one root and
show the thread affordance). Use `send`/`send_team` for top-level channel
messages — a plain `send(..., thread_id=…)` only continues the
conversation group and does **not** create a threaded reply.

### `agent-bus activity`

Chronological "what happened?" view across messages, task events, test
results, decisions, and memories.

```bash
agent-bus activity
agent-bus activity --team ui-design
agent-bus activity --project movie-app --since 30m
agent-bus activity --team ui-design -n 100
```

Use this when the user is waiting and needs to understand recent bus
movement without reading raw message logs.

### `agent-bus cockpit`

Coordinator dashboard for what needs attention next.

```bash
agent-bus cockpit
agent-bus cockpit --team ui-design
agent-bus cockpit --project movie-app --area all
```

It groups waiting acknowledgements/reviews, ready work, blockers, and
suggested next actions. Use `kanban` for workflow columns and `cockpit`
for manager decisions.

### `agent-bus now`

One-call current-status update for agents.

```bash
agent-bus now --agent worker-a --status working
agent-bus now --agent worker-a --task 12 --phase testing --note "running simulator smoke"
agent-bus now --agent worker-a --status blocked --task 12 --phase blocked --note "waiting on API key"
```

When a task is supplied, `now` updates agent status, moves claimed or
blocked tasks to `working` when appropriate, updates the task phase, and
records a durable task event.

### `agent-bus whois`

List every registered agent with capabilities, status, role, active task,
last-seen, and paused state.

```bash
agent-bus whois
agent-bus whois --project all
agent-bus whois --area all
agent-bus whois --team ios-ui
```

Scoped output includes agents in the current project plus null-project
legacy/global agents. Area-scoped output includes matching-area plus
null-area legacy agents. Null-project agents render with `{no-project}`.

### `agent-bus wait-for-agents`

Wait for an expected roster before a project manager starts delegating.

```bash
agent-bus wait-for-agents --names agent-a,agent-b,reviewer
agent-bus wait-for-agents --names worker-a,worker-b --project my-app --area all --timeout 300
```

The output separates `Ready`, `Missing`, `Stale`, and `Wrong scope` so a
manager can tell whether workers are absent, registered in the wrong
project/area, or simply old/stale.

### `agent-bus send-team` / `agent-bus ask-team`

Message agents registered with the same neutral team scope. This is for
workgroup routing, not behavior control.

```bash
agent-bus send-team --from coordinator --team ios-ui "sync on navigation"
agent-bus send-team --from coordinator --team ios-ui --project movie-app --area all "status?"
agent-bus ask-team --from coordinator --team ios-ui --capability design "which detail layout should we implement first?"
```

`send-team` fans out to active, non-paused team members. `ask-team`
picks one best active team member, optionally narrowed by capability or
role.

### `agent-bus tasks`

Snapshot or watch first-class tasks.

```bash
agent-bus tasks                    # active tasks only
agent-bus tasks --state working    # filter by state
agent-bus tasks --all              # include completed/failed/canceled
agent-bus tasks --watch            # print new or changed tasks
agent-bus tasks --watch --interval 500
agent-bus tasks --project all      # global
agent-bus tasks --area area-a      # only one configured task lane
agent-bus tasks --team ui-design   # only one team
agent-bus tasks --required-capability tests
agent-bus tasks --mode investigate_only
agent-bus tasks --manager-reviewed
```

Rows show id, priority, state, title, requester, holder, and abbreviated
thread id. Stale active tasks are highlighted red.

### `agent-bus kanban`

Group tasks into workflow columns.

```bash
agent-bus kanban --project actionvoice-ai --team vorec-cli-plugin
agent-bus kanban --team ui-design --all       # include completed/failed/canceled
agent-bus kanban --team ui-design --done      # only terminal columns
agent-bus kanban --team ui-design --compact   # shorter rows
agent-bus kanban --team ui-design --watch     # refresh in place
agent-bus kanban --team ui-design --state-columns
```

Default workflow lanes are `Todo`, `Accepted`, `Doing`, `Testing`,
`Review`, and `Blocked`. They are derived from task state, `phase`, and
review fields, so agents keep the stable state machine while humans get
a natural board. Pass `--state-columns` to show raw task states:
`Open`, `Claimed`, `Working`, `Blocked`, and `Waiting Review`.

### `agent-bus done`

Show finished task history without the active board noise.

```bash
agent-bus done --project actionvoice-ai --team vorec-cli-plugin
agent-bus done --team ui-design --state completed
agent-bus done --team ui-design --state failed
```

### `agent-bus task`

Readable task detail alias for `task-result`.

### Task Movement Shortcuts

These commands wrap `update_task` and `record_task_event` so agents can
move work and leave durable evidence with one CLI call.

```bash
agent-bus task-start 12 --by worker-a
agent-bus task-phase 12 editing --by worker-a --message "patching parser"
agent-bus task-testing 12 --by worker-a --message "running npm test"
agent-bus task-done 12 --by worker-a --result "implemented and verified"
```

Use phases like `planning`, `editing`, `testing`, `review`, and `done`.
`testing` appears in the Testing lane; `review` or pending required
review appears in the Review lane.

```bash
agent-bus task 6
agent-bus task 6 --json
```

## Area config

Put `.agent-bus.json` in a repo root when one project has multiple lanes.
For a monorepo, map areas by path:

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

For separated folders or repos that belong to the same logical project,
give every folder the same `project` and a fixed `area`:

```json
{
  "project": "my-app",
  "area": "area-a"
}
```

Another folder can use the same project with a different area:

```json
{
  "project": "my-app",
  "area": "area-b"
}
```

MCP sessions and CLI read commands derive the area from cwd. Use
`--area all` when a project manager wants every lane in the current
project.

```bash
agent-bus init --project my-app --areas area-a,area-b,docs
agent-bus scope
agent-bus areas
agent-bus team init area-a area-b docs
agent-bus team init-folder --project app-one --area app
agent-bus doctor
```

`init` writes a monorepo-style `.agent-bus.json`; `scope` prints the
current derived project/area; `areas` lists configured path patterns;
`team init` writes neutral area scopes; `team init-folder` writes a
separated-folder project config without prescribing agent behavior;
`doctor` checks db path, scope, config, area list, and agent counts.

For an app factory under one parent folder, run `team init-folder`
inside each new app subfolder with a unique project name:

```bash
mkdir AppOne && cd AppOne
agent-bus team init-folder --project app-one --area app

cd ..
mkdir AppTwo && cd AppTwo
agent-bus team init-folder --project app-two --area app
```

Each folder gets its own `.agent-bus.json`, so agents in `AppOne` see
`app-one` by default while agents in `AppTwo` see `app-two`.

Optional local hook commands can be placed in `.agent-bus.json`:

```json
{
  "hooks": {
    "message.created": "node scripts/on-message.js",
    "task.blocked": "agent-bus inject --to coordinator 'task blocked'"
  }
}
```

Hook commands run locally with `AGENT_BUS_EVENT` and
`AGENT_BUS_EVENT_JSON` in the environment.

### `agent-bus listen`

Long-running local inbox listener. It blocks in `inbox(wait_s)`, claims
messages, prints them, and acks after printing.

```bash
agent-bus listen --agent worker-a
agent-bus listen --agent worker-a --claim-s 300 --wait-s 110
agent-bus listen --agent worker-a --team frontend
```

### `agent-bus inbox-status`

Inspect inbox state without consuming messages.

```bash
agent-bus inbox-status --agent worker-a
agent-bus inbox-status --agent worker-a --team frontend
agent-bus inbox-status --agent worker-a --json
```

The output separates unread, claimed/in-flight, and recent delivered
messages, so coordinators can see whether an agent has no work, has a
claimed message, or already consumed the last message.

### `agent-bus inbox-previews`

Preview unread inbox messages without consuming them or printing full
bodies. This is the safe first command when an inbox may contain a huge
brief.

```bash
agent-bus inbox-previews --agent worker-a
agent-bus inbox-previews --agent worker-a --team frontend --preview-chars 200
agent-bus inbox-previews --agent worker-a --wait-s 110
```

### `agent-bus message`

Fetch one message by id. Use previews for large content.

```bash
agent-bus message 45
agent-bus message 45 --no-content
agent-bus message 45 --preview-chars 500
```

### Agent state and reports

```bash
agent-bus sleep worker-b
agent-bus wake worker-b
agent-bus status worker-a waiting_review

agent-bus decision --by coordinator --decision "Use task modes" --rationale "prevents accidental edits"
agent-bus decision --list

agent-bus remember --by coordinator --kind handoff --pinned "handoff summary for the next session"
agent-bus memories --kind handoff --pinned
agent-bus pin-memory 12
agent-bus brief --agent coordinator
agent-bus activity --team ios-ui
agent-bus board
agent-bus team-board --team ios-ui
agent-bus cockpit --team ios-ui
agent-bus kanban --team ios-ui --watch
agent-bus done --team ios-ui
agent-bus scope-conflicts --files "src/module/**"
agent-bus delegate --from coordinator --to worker-a --title "Investigate bug" --mode investigate_only --expect "findings and fix options"
agent-bus delegate-team --from coordinator --team ios-ui --title "Compare detail screen options" --mode investigate_only --expect "one plan per designer"
agent-bus ack-task 12 --agent worker-a --response claimed
agent-bus review-task 12 --reviewer reviewer --approve --notes "tests passed"
agent-bus handoff 12 --from worker-a --to worker-b --reason "session ending"
agent-bus task-event 12 --by worker-a --type progress --phase testing --message "Checks are running"
agent-bus now --agent worker-a --task 12 --phase testing --note "Checks are running"
agent-bus task-testing 12 --by worker-a --message "Checks are running"
agent-bus task-done 12 --by worker-a --result "implemented and tests passed"
agent-bus task-event 12 --list
agent-bus task-result 12
agent-bus wait-task 12 --wait-s 110
agent-bus inbox-previews --agent worker-a --team ios-ui
agent-bus message 45 --no-content
agent-bus message-status 45
agent-bus why-no-reply 45
agent-bus reply-thread t_abc123 --from coordinator --message "continue from here"
agent-bus cancel-task 12 --agent worker-a --reason "superseded by task 18"
agent-bus test-result --by reviewer --task 12 --command "npm test" --status passed --summary "60 smoke tests passed"
agent-bus test-result --list

agent-bus final-report
agent-bus review-gate
agent-bus review-gate --hook-decision
```

`sleep`/`wake` are semantic work states, separate from `pause`/`resume`
delivery. `remember` stores durable structured notes; `brief` generates
startup/handoff context from agents, tasks, decisions, memories, and
recent messages. `board` is the manager view for agents, tasks, review
queues, pending acknowledgements, scope conflicts, risks, and handoffs.
`team-board` is the same manager board scoped to one workgroup.
`kanban` groups tasks into workflow lanes and `done` shows terminal task
history. `task-start`, `task-phase`, `task-testing`, and `task-done`
move tasks while recording event evidence. `task-event` records lower
level progress/phase/log/result notes; `task` and `task-result` show
one task with its events, test evidence, memories, and thread messages.
`delegate` creates a task, assigns it,
notifies the worker, and requires acknowledgement by default.
`delegate-team` creates board-visible tracked tasks for active matching
members of one team and reports skipped stale/paused/mismatched members.
`wait-task` waits for task activity and reports latest evidence without
repeated manual polling.
`message-status` and `why-no-reply` diagnose delivery, claims, replies,
recipient presence, and related task context. `reply-thread` continues a
thread without looking up the exact recipient. `cancel-task` marks
active work canceled and notifies the other side. `test-result` records
explicit build/lint/test evidence for the final report. `final-report`
summarizes implemented work, gaps, risks, tests,
manual checks, and commit/push/deploy safety. `review-gate` turns the
board and final report into a deterministic ready/block decision.

### `agent-bus inject`

Human relay — send a message into the bus from a name of your choice.
Auto-registers the sender if needed.

```bash
agent-bus inject --to alpha "hey, check src/foo.ts"
agent-bus inject --from human --to alpha "<message>"
```

### `agent-bus pause <agent>` / `agent-bus resume <agent>`

Stop / restart delivery for a given agent. Messages keep queuing while
paused.

```bash
agent-bus pause alpha
agent-bus resume alpha
```

### `agent-bus register`

Manually create or update an agent row. Useful for scripting.

```bash
agent-bus register --name worker-1 --capabilities "tests,ci" --replace
agent-bus register --name reviewer --capabilities "tests,review" --role reviewer --area all --replace
agent-bus register --name ui-1 --capabilities "swiftui,design" --project movie-app --area app --team ios-ui --replace
```

## Listener support

### `agent-bus listen-prompt <name>`

Print the listener-mode prompt for any MCP-speaking agent (Codex, Claude
Desktop, etc.). Pipe into your clipboard, paste into the agent's chat.

```bash
agent-bus listen-prompt my-codex | pbcopy
```

The output is plain text — no slash command, no markdown formatting — so
it pastes cleanly into any chat input.

### `agent-bus install-hook --agent <name>`

Add a Claude Code Stop hook to `~/.claude/settings.json` that:

- auto-injects pending inbox messages at every turn end (near-instant
  delivery without a blocking listener)
- if the session was marked as a listener via `/listen`, auto-resumes the
  listener loop when Claude would otherwise return control to the user

```bash
agent-bus install-hook --agent alpha
```

### `agent-bus uninstall-hook`

Remove the Stop hook entry from `~/.claude/settings.json`.

```bash
agent-bus uninstall-hook
```

### `agent-bus mark-listening` / `agent-bus unmark-listening`

Used internally by the `/listen` slash command. You probably don't need
these unless you're scripting custom session control.

```bash
agent-bus mark-listening --session "$CLAUDE_SESSION_ID" --agent alpha
agent-bus unmark-listening --session "$CLAUDE_SESSION_ID"
```

Marker files live in `~/.agent-bus/listeners/`.

### `agent-bus poll-inbox`

The script the Stop hook actually runs. Emits `{decision:"block",reason:...}`
JSON when:

- the agent has unread messages, or
- the session is marked as a listener and the loop needs resuming

Otherwise exits 0 silently.

```bash
agent-bus poll-inbox --agent alpha --session "$CLAUDE_SESSION_ID"
agent-bus poll-inbox --agent alpha --team frontend --session "$CLAUDE_SESSION_ID"
```

## Environment variables

| Variable | Default | What it does |
|---|---|---|
| `AGENT_BUS_DIR` | `~/.agent-bus` | Where `bus.db` and listener markers live. Override for tests/sandboxes. |
| `AGENT_BUS_POLL_MS` | `50` | SQLite poll interval (ms) inside `inbox(wait_s)`. Floor is 5 ms. Lower means messages are detected faster while a listener is blocked. |
| `AGENT_BUS_TASK_STALE_MS` | `300000` | Stale threshold for claimed/working/blocked task holders. |

Set them on the **MCP server process** (via `claude mcp add -e` or
Codex's `env = { ... }` block), not your shell. The CLI commands respect
them too if you set them at the shell level.

## Output format details

### `agent-bus watch` and `agent-bus log`

Format per message (two lines):

```
HH:MM:SS #<id> <from> → <to> <kind><thread chip>
  <content, truncated to 400 chars>
```

`kind` is colored: `msg` gray, `ASK` bold yellow, `REPLY` bold green.
`↪#<n>` appears after the kind for `reply` rows, pointing at the
original ask.

### `agent-bus tasks`

Format per task:

```
#<id> p<priority> [<state>] <title> - by <requested_by>, held=<claimed_by|->, thread=<last8>
```

If `stale` is true, the line ends with `stale` and is colored red.

## Project and area scoping

Read commands derive a default project from the current working directory
by walking up to `.git` and using the repo folder name. If
`.agent-bus.json` exists, they also derive an area from the matching path
pattern:

```bash
agent-bus watch
agent-bus log
agent-bus whois
agent-bus tasks
```

Use `agent-bus watch --global` for every project, area, and team. Other
read commands use `--project all` for all projects, `--area all` for all
areas in the selected project, `--team all` for all teams in the
selected project/area, or concrete names for specific scopes.
CLI relay/admin commands (`inject`, `register`) default to null/global
project and area instead of deriving from cwd.
