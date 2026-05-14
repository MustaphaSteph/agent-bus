# CLI reference

The `agent-bus` binary. Run `agent-bus --help` for an auto-generated list.

## Daily commands

### `agent-bus watch`

Live tail every message on the bus. Colors per agent, time-stamped,
shows kind (`msg`/`ask`/`reply`) and reply chains.

```bash
agent-bus watch
agent-bus watch --interval 100   # change poll interval in ms (default 250)
agent-bus watch --project all    # global
```

By default, `watch` is scoped to the current repo-derived project and
prints `scoped: <project> (use --project all for global)` when scoped.
Ctrl+C to exit.

### `agent-bus log`

Snapshot of the most recent messages.

```bash
agent-bus log                  # last 50
agent-bus log -n 200           # last 200
agent-bus log --project all    # global
```

### `agent-bus whois`

List every registered agent with capabilities, last-seen, paused state.

```bash
agent-bus whois
agent-bus whois --project all
```

Scoped output includes agents in the current project plus null-project
legacy/global agents. Null-project agents render with `{no-project}`.

### `agent-bus tasks`

Snapshot or watch first-class tasks.

```bash
agent-bus tasks                    # active tasks only
agent-bus tasks --state working    # filter by state
agent-bus tasks --all              # include completed/failed/canceled
agent-bus tasks --watch            # print new or changed tasks
agent-bus tasks --watch --interval 500
agent-bus tasks --project all      # global
```

Rows show id, priority, state, title, requester, holder, and abbreviated
thread id. Stale active tasks are highlighted red.

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

## Project scoping

Read commands derive a default project from the current working
directory by walking up to `.git` and using the repo folder name:

```bash
agent-bus watch
agent-bus log
agent-bus whois
agent-bus tasks
```

Use `--project all` for the whole bus, or `--project <name>` for a
specific project. CLI relay/admin commands (`inject`, `register`) default
to null/global project instead of deriving from cwd.
