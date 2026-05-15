---
name: agent-bus
description: Coordinate work across Claude/Codex/Cursor sessions on the same machine via a local message bus. Use to delegate to helpers, get a second opinion, ask specialists by capability, or track shared tasks.
requires:
  - agent-bus-mcp >= 0.4.0
---

# agent-bus

Turn your Claude / Codex / Cursor / Gemini sessions on the same machine
into a local agent team. Each session registers a name, then you can
send messages, ask blocking questions, delegate tasks, broadcast to
channels, and route work by capability — all through one SQLite file
at `~/.agent-bus/bus.db`.

This skill is the **coordinator playbook**: when the user speaks
naturally, you translate their intent into agent-bus tool calls.

## Setup check (do this first)

Before using any bus tools, run `scripts/check-setup.sh`. If it exits
non-zero, halt and show the user the install hint it printed. Do not
try to use the bus until the check passes.

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
2. Call `whois` once and show the user who else is on the bus, with
   their capabilities, in one compact line:
   `on the bus: helper-a [review, verify], helper-b [research, docs]`.
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
| "Remember X" / "Note that X" (with a memory agent on the bus) | `send(to=<memory agent>, message="remember: X")` |
| "Recall X" / "What did we decide about X" | `ask_best(capability="memory" or specific name, question=…)` |
| "Catch me up on the bus" | `recent(limit=20)` and render |
| "Track this as a task" / "Open a task to do X" | `create_task(requested_by=<your name>, title=…, description=…)` |
| "What's on the task list?" | `list_tasks()` and render the active ones |

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

## How to talk while calling tools

Be transparent in ONE short line before each call:

> Asking helper-a (review): "is the token refresh race-free?"

Not:

> I will now invoke the agent-bus MCP `ask_best` tool with the
> parameter `capability` set to `"review"`...

When a reply lands, render it in plain English for the user. Don't
dump JSON. The user wants the answer, not the message envelope.

## Cross-project addressing

By name still works (`send` / `ask` are cross-project). `ask_best`
defaults to the current project's pool and fails loud if no in-project
match. If the user asks broadly ("any reviewer anywhere"), pass
`project: "*"` to opt into global.

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
  `TASK_INVALID_TRANSITION`) and the recovery hint.
- Don't fabricate helper names. If `whois` shows nobody with the role
  the user asked for, say "no <role> helper is on the bus right now"
  and ask if they want to spin one up.

## When to load more context

For deeper detail, read these references on demand:

- `references/tools.md` — the 20 MCP tools with input/output shapes
  and every error code. Load when you need the exact contract for a
  rare tool (e.g. `subscribe`, `send_channel`, `release_task`).
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
| Setup check fails | MCP not installed / wrong version | print install hint, halt — don't try to call tools |
