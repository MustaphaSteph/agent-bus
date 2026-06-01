import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import kleur from "kleur";
import {
  activityTimeline,
  cockpit,
  directory,
  getMessage,
  listDecisions,
  listMemories,
  listTasks,
  recentMessages,
  scopes,
  taskResult,
  type MessagePreview,
} from "../bus.js";
import { dbPath } from "../util/paths.js";
import { packageVersion } from "../util/package-info.js";
import { resolveScopeOptions, type ScopeOptions } from "./project-scope.js";

export interface UiOptions {
  host?: string;
  port?: number;
  project?: string;
  area?: string;
  team?: string;
  open?: boolean;
}

interface UiState {
  scope: ScopeOptions;
  generated_at: number;
  version: string;
  db_path: string;
  agents: ReturnType<typeof directory>;
  cockpit: ReturnType<typeof cockpit>;
  activity: ReturnType<typeof activityTimeline>;
  messages: MessagePreview[];
  tasks: ReturnType<typeof listTasks>;
  memories: ReturnType<typeof listMemories>;
  decisions: ReturnType<typeof listDecisions>;
  stats: {
    online: number;
    working: number;
    blocked: number;
    waiting_review: number;
    active_tasks: number;
    open_tasks: number;
    done_tasks: number;
    unread_messages: number;
    attention: number;
  };
}

export async function startUi(opts: UiOptions = {}): Promise<void> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 8787;
  const scope = resolveScopeOptions(opts.project, opts.area, opts.team);
  const server = createServer((req, res) => handleRequest(req, res, scope));
  await new Promise<void>((resolveStart, rejectStart) => {
    server.once("error", rejectStart);
    server.listen(port, host, () => {
      server.off("error", rejectStart);
      resolveStart();
    });
  });
  const url = `http://${host}:${port}`;
  console.log(kleur.green("agent-bus ui"));
  console.log(`url: ${url}`);
  console.log(`default scope: project=${scope.project ?? "-"} area=${scope.area ?? "-"} team=${scope.team ?? "-"}`);
  console.log(kleur.gray("(switch projects/teams live in the browser — no restart needed)"));
  console.log(`db: ${dbPath()}`);
  console.log(kleur.gray("Press Ctrl+C to stop."));
  if (opts.open !== false) {
    void import("node:child_process").then(({ spawn }) => {
      const child = spawn("open", [url], { stdio: "ignore", detached: true });
      child.unref();
    }).catch(() => undefined);
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse, defaultScope: ScopeOptions): void {
  const url = new URL(req.url ?? "/", "http://agent-bus.local");
  try {
    if (url.pathname === "/" || url.pathname === "/index.html") {
      send(res, 200, html(), "text/html; charset=utf-8");
      return;
    }
    if (url.pathname === "/app.css") {
      send(res, 200, css(), "text/css; charset=utf-8");
      return;
    }
    if (url.pathname === "/app.js") {
      send(res, 200, js(), "application/javascript; charset=utf-8");
      return;
    }
    if (url.pathname === "/api/scopes") {
      sendJson(res, scopes());
      return;
    }
    if (url.pathname === "/api/state") {
      sendJson(res, buildState(scopeFromQuery(url, defaultScope)));
      return;
    }
    const taskMatch = /^\/api\/tasks\/(\d+)$/.exec(url.pathname);
    if (taskMatch) {
      sendJson(res, taskResult(Number(taskMatch[1])));
      return;
    }
    const messageMatch = /^\/api\/messages\/(\d+)$/.exec(url.pathname);
    if (messageMatch) {
      sendJson(res, getMessage({ message_id: Number(messageMatch[1]), include_content: url.searchParams.get("full") === "1" }));
      return;
    }
    sendJson(res, { error: { code: "NOT_FOUND", message: "not found" } }, 404);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    sendJson(res, { error: { code: "UI_ERROR", message } }, 500);
  }
}

// When the browser drives scope (any of project/area/team in the query), honor
// it and default the unspecified dimensions to "all" so a project view spans
// every team. With no scope params we fall back to the server's launch scope.
function scopeFromQuery(url: URL, fallback: ScopeOptions): ScopeOptions {
  const q = url.searchParams;
  if (!q.has("project") && !q.has("area") && !q.has("team")) return fallback;
  const norm = (value: string | null): string | undefined => {
    if (value === null) return undefined;
    return value === "all" || value === "*" ? "*" : value;
  };
  return {
    project: q.has("project") ? norm(q.get("project")) : "*",
    area: q.has("area") ? norm(q.get("area")) : "*",
    team: q.has("team") ? norm(q.get("team")) : undefined,
  };
}

function buildState(scope: ScopeOptions): UiState {
  const agents = directory(scope);
  const board = cockpit({ ...scope, limit: 80 });
  const activity = activityTimeline({ ...scope, limit: 80 });
  const rawMessages = recentMessages({ ...scope, limit: 80 });
  const messages = rawMessages.map((message): MessagePreview => {
    const truncated = message.content.length > 360;
    const { content, ...metadata } = message;
    return {
      ...metadata,
      content_preview: truncated ? content.slice(0, 360) : content,
      content_length: content.length,
      truncated,
    };
  });
  const tasks = listTasks({ ...scope, include_terminal: true, limit: 120 });
  const memories = listMemories({ ...scope, pinned: true, limit: 12 });
  const decisions = listDecisions({ ...scope, limit: 12 });
  const attention =
    board.board.blocked_tasks.length +
    board.board.stale_tasks.length +
    board.board.waiting_review.length +
    board.board.waiting_acknowledgement.length +
    board.board.scope_conflicts.length;
  return {
    scope,
    generated_at: Date.now(),
    version: packageVersion(),
    db_path: dbPath(),
    agents,
    cockpit: board,
    activity,
    messages,
    tasks,
    memories,
    decisions,
    stats: {
      online: agents.filter((agent) => agent.presence === "online").length,
      working: agents.filter((agent) => agent.status === "working").length,
      blocked: agents.filter((agent) => agent.status === "blocked").length,
      waiting_review: agents.filter((agent) => agent.status === "waiting_review").length,
      active_tasks: board.board.active_tasks.length,
      open_tasks: board.board.open_tasks.length,
      done_tasks: tasks.filter((task) => ["completed", "failed", "canceled"].includes(task.state)).length,
      unread_messages: messages.filter((message) => message.status === "pending").length,
      attention,
    },
  };
}

function sendJson(res: ServerResponse, body: unknown, status = 200): void {
  send(res, status, JSON.stringify(body), "application/json; charset=utf-8");
}

function send(res: ServerResponse, status: number, body: string, contentType: string): void {
  res.writeHead(status, {
    "content-type": contentType,
    "cache-control": "no-store",
  });
  res.end(body);
}

function html(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Agent Bus Cockpit</title>
  <link rel="stylesheet" href="/app.css" />
</head>
<body>
  <div id="root">
    <header class="topbar">
      <div class="brand">
        <div class="eyebrow">local cockpit</div>
        <h1>Agent Bus</h1>
      </div>
      <div class="scope">
        <span id="scopeText">loading…</span>
        <button class="ghost" data-act="toggle-inspector" title="Toggle inspector">inspector</button>
        <span class="live"><i></i> <span id="updatedAt">live</span></span>
      </div>
    </header>
    <main class="shell">
      <nav class="project-rail" id="projectRail"></nav>
      <nav class="team-rail" id="teamRail"></nav>
      <section class="main">
        <div class="main-head" id="mainHead"></div>
        <div class="main-body" id="mainBody"></div>
      </section>
      <aside class="inspector" id="inspector"></aside>
    </main>
  </div>
  <script src="/app.js"></script>
</body>
</html>`;
}

function css(): string {
  return `:root {
  color-scheme: dark;
  --bg: #0b0d10;
  --surface: #11151a;
  --surface-2: #171d24;
  --line: #28313b;
  --line-soft: #1c232b;
  --text: #eef3f8;
  --muted: #8d9aa8;
  --soft: #5d6a78;
  --accent: #47d6b6;
  --accent-2: #8aa7ff;
  --warning: #f2bf5e;
  --danger: #ff6b6b;
  --review: #c790ff;
  --done: #72d572;
  font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  min-height: 100vh;
  background: radial-gradient(circle at top left, rgba(71, 214, 182, .12), transparent 32rem), var(--bg);
  color: var(--text);
}
button, input { font: inherit; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 22px; font-weight: 720; }
h2 { font-size: 15px; font-weight: 680; }
h3 { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .09em; margin-bottom: 10px; }
.eyebrow { color: var(--accent); font-size: 10px; text-transform: uppercase; letter-spacing: .14em; margin-bottom: 3px; }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.topbar {
  height: 64px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid var(--line-soft);
  background: rgba(11, 13, 16, .9);
  backdrop-filter: blur(18px);
  position: sticky; top: 0; z-index: 10;
}
.scope { display: flex; align-items: center; gap: 14px; color: var(--muted); font-size: 12px; }
.live { display: inline-flex; gap: 7px; align-items: center; color: var(--text); }
.live i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 18px var(--accent); }
.ghost { appearance: none; background: transparent; border: 1px solid var(--line); color: var(--muted); border-radius: 7px; padding: 5px 10px; cursor: pointer; font-size: 12px; }
.ghost:hover { color: var(--text); border-color: var(--accent); }
.shell {
  display: grid;
  grid-template-columns: 76px 240px minmax(420px, 1fr) 344px;
  gap: 1px;
  min-height: calc(100vh - 64px);
  background: var(--line-soft);
}
.shell.no-inspector { grid-template-columns: 76px 240px 1fr; }
.shell.no-inspector .inspector { display: none; }
.project-rail, .team-rail, .main, .inspector { background: rgba(13, 16, 20, .98); min-width: 0; }
.project-rail { padding: 14px 10px; display: flex; flex-direction: column; gap: 10px; align-items: stretch; }
.proj {
  position: relative; border: 1px solid var(--line-soft); border-radius: 12px;
  padding: 10px 6px 8px; text-align: center; cursor: pointer; color: var(--muted);
}
.proj:hover { border-color: var(--line); color: var(--text); }
.proj.active { border-color: var(--accent); color: var(--text); background: rgba(71,214,182,.06); }
.proj .avatar { width: 34px; height: 34px; margin: 0 auto 6px; border-radius: 10px; background: var(--surface-2); display: flex; align-items: center; justify-content: center; font-weight: 720; color: var(--text); }
.proj .plabel { font-size: 10px; line-height: 1.2; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; }
.proj .ponline { font-size: 10px; color: var(--soft); }
.badge { position: absolute; top: 4px; right: 6px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 999px; background: var(--danger); color: #1b0d0d; font-size: 10px; font-weight: 720; display: inline-flex; align-items: center; justify-content: center; }
.team-rail { padding: 14px 12px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
.rail-section { color: var(--muted); font-size: 10px; text-transform: uppercase; letter-spacing: .09em; margin: 14px 6px 6px; }
.rail-item { display: flex; align-items: center; gap: 8px; padding: 7px 9px; border-radius: 8px; cursor: pointer; color: var(--muted); font-size: 13px; }
.rail-item:hover { background: var(--surface); color: var(--text); }
.rail-item.active { background: var(--surface-2); color: var(--text); }
.rail-item .glyph { width: 16px; text-align: center; opacity: .9; }
.rail-item .rlabel { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.rail-item .rcount { color: var(--soft); font-size: 11px; }
.rail-item .badge { position: static; }
.main { display: flex; flex-direction: column; }
.main-head { border-bottom: 1px solid var(--line-soft); padding: 16px 22px 0; }
.head-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 18px; padding-bottom: 14px; }
.head-row h2 { font-size: 22px; }
.channel-title { display: flex; align-items: center; gap: 8px; }
.members { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
.member { display: inline-flex; align-items: center; gap: 5px; font-size: 11px; color: var(--muted); border: 1px solid var(--line-soft); border-radius: 999px; padding: 2px 8px; cursor: pointer; }
.member:hover { color: var(--text); border-color: var(--line); }
.metrics { display: flex; gap: 16px; }
.metric strong { display: block; font-size: 22px; font-weight: 740; }
.metric span { color: var(--muted); font-size: 11px; }
.subtabs { display: flex; gap: 6px; }
.subtab { appearance: none; border: 0; background: transparent; color: var(--muted); padding: 9px 10px; border-bottom: 2px solid transparent; cursor: pointer; font-size: 13px; }
.subtab.active { color: var(--text); border-bottom-color: var(--accent); }
.main-body { padding: 18px 22px 26px; overflow-y: auto; }
.stream, .timeline { display: grid; gap: 1px; background: var(--line-soft); border: 1px solid var(--line-soft); }
.message, .event, .task-card, .note { background: var(--surface); padding: 13px 14px; }
.message { cursor: pointer; }
.message:hover { background: var(--surface-2); }
.message-head, .event-head, .task-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.route, .event-title { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { color: var(--soft); font-size: 11px; white-space: nowrap; }
.message p, .event p, .task-card p, .note p { color: #c7d0da; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.status-pill, .kind, .state {
  border: 1px solid var(--line); border-radius: 999px; color: var(--muted);
  padding: 4px 8px; font-size: 11px; white-space: nowrap;
}
.status-pill.working, .state.working { color: var(--accent); border-color: rgba(71, 214, 182, .35); }
.status-pill.blocked, .state.blocked, .state.failed { color: var(--danger); border-color: rgba(255, 107, 107, .35); }
.status-pill.waiting_review, .state.review { color: var(--review); border-color: rgba(199, 144, 255, .35); }
.kind.ask { color: var(--warning); border-color: rgba(242, 191, 94, .35); }
.kind.reply { color: var(--accent); border-color: rgba(71, 214, 182, .35); }
.kind.msg { color: var(--accent-2); border-color: rgba(138, 167, 255, .35); }
.large { margin-top: 10px; border: 1px solid rgba(242, 191, 94, .22); color: var(--warning); padding: 8px 10px; font-size: 11px; background: rgba(242, 191, 94, .06); }
.kanban { display: grid; grid-template-columns: repeat(7, minmax(150px, 1fr)); gap: 10px; align-items: start; }
.lane { min-width: 0; }
.lane-title { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
.lane-body { display: grid; gap: 8px; }
.task-card { border: 1px solid var(--line-soft); min-height: 104px; cursor: pointer; }
.task-card:hover { border-color: var(--line); }
.task-title { font-size: 13px; font-weight: 650; line-height: 1.35; }
.task-meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--soft); flex: none; }
.dot.online { background: var(--accent); }
.dot.idle { background: var(--accent-2); }
.dot.stale { background: var(--warning); }
.dot.paused { background: var(--danger); }
.people-group { margin-bottom: 18px; }
.people-group h3 { display: flex; gap: 8px; align-items: center; }
.person { display: grid; grid-template-columns: 10px 1fr auto; gap: 10px; align-items: center; min-height: 54px; border-bottom: 1px solid var(--line-soft); cursor: pointer; }
.person:hover .agent-name { color: var(--accent); }
.agent-name { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-meta { margin-top: 4px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.attn { display: grid; gap: 8px; }
.attn-row { display: grid; grid-template-columns: 92px 1fr auto; gap: 12px; align-items: center; background: var(--surface); border: 1px solid var(--line-soft); border-left: 3px solid var(--line); padding: 12px 14px; cursor: pointer; }
.attn-row:hover { background: var(--surface-2); }
.attn-row .sev { font-size: 10px; font-weight: 720; letter-spacing: .08em; }
.attn-row.blocked { border-left-color: var(--danger); } .attn-row.blocked .sev { color: var(--danger); }
.attn-row.stale { border-left-color: var(--warning); } .attn-row.stale .sev { color: var(--warning); }
.attn-row.review { border-left-color: var(--review); } .attn-row.review .sev { color: var(--review); }
.attn-row.ack { border-left-color: var(--accent-2); } .attn-row.ack .sev { color: var(--accent-2); }
.attn-row.conflict { border-left-color: var(--danger); } .attn-row.conflict .sev { color: var(--danger); }
.attn-row .at { color: var(--soft); font-size: 11px; }
.attn-main { min-width: 0; }
.attn-main strong { font-size: 13px; }
.attn-main p { color: var(--muted); font-size: 12px; margin-top: 3px; overflow-wrap: anywhere; }
.inspector { padding: 16px 16px 26px; overflow-y: auto; }
.insp-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 14px; color: var(--muted); }
.insp-head .ghost { padding: 3px 8px; }
.cockpit-list { display: grid; gap: 8px; margin-bottom: 16px; }
.cockpit-list .note { border-left: 2px solid var(--line); }
.cockpit-list.waiting .note { border-left-color: var(--warning); }
.cockpit-list.blockers .note { border-left-color: var(--danger); }
.cockpit-list.ready .note { border-left-color: var(--accent); }
.memory-block { border-top: 1px solid var(--line-soft); padding-top: 14px; margin-top: 14px; }
.kv { display: grid; grid-template-columns: 86px 1fr; gap: 4px 10px; font-size: 12px; margin-bottom: 14px; }
.kv dt { color: var(--soft); }
.kv dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
.empty { color: var(--soft); padding: 16px; font-size: 12px; background: var(--surface); }
.profile-name { font-size: 18px; font-weight: 700; display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.profile-sub { color: var(--muted); font-size: 12px; margin-bottom: 14px; }
@media (max-width: 1180px) {
  .shell { grid-template-columns: 76px 220px 1fr; }
  .shell .inspector { grid-column: 1 / -1; }
  .shell.no-inspector { grid-template-columns: 76px 220px 1fr; }
  .kanban { grid-template-columns: repeat(3, minmax(150px, 1fr)); }
}
@media (max-width: 760px) {
  .shell, .shell.no-inspector { grid-template-columns: 1fr; }
  .project-rail { flex-direction: row; overflow-x: auto; }
  .kanban { grid-template-columns: 1fr; }
}`;
}

function js(): string {
  return `const ui = {
  scopes: null,
  state: null,
  detail: null,
  inspectorOpen: true,
  sel: { project: "*", team: null, view: "attention" }
};
const VIEWS_PROJECT = [["attention","Attention","⚡"],["kanban","Kanban","▤"],["activity","Activity","●"],["people","People","◉"]];
const VIEWS_TEAM = [["chat","Chat"],["kanban","Kanban"],["activity","Activity"],["people","People"]];
const lanes = [
  ["todo", ["open"]],
  ["accepted", ["claimed"]],
  ["doing", ["working"]],
  ["testing", ["working"], "testing"],
  ["review", ["working"], "review"],
  ["blocked", ["blocked"]],
  ["done", ["completed", "failed", "canceled"]]
];

function api(path) { return fetch(path, { cache: "no-store" }).then((r) => r.json()); }

function stateUrl() {
  const p = new URLSearchParams();
  // The bus can filter by a named project/team or "*", but it has no
  // "project IS NULL only" query. For the null "unscoped"/"unteamed" buckets we
  // fetch the broad scope and narrow client-side (applyNullFilters).
  p.set("project", ui.sel.project === "__null__" ? "*" : (ui.sel.project || "*"));
  if (ui.sel.team && ui.sel.team !== "__null__") p.set("team", ui.sel.team);
  return "/api/state?" + p.toString();
}

function applyNullFilters(st) {
  const needProjNull = ui.sel.project === "__null__";
  const needTeamNull = ui.sel.team === "__null__";
  if (!needProjNull && !needTeamNull) return st;
  const keep = (project, team) => (!needProjNull || (project == null)) && (!needTeamNull || (team == null));
  st.agents = st.agents.filter((a) => keep(a.project, a.team));
  st.messages = st.messages.filter((m) => keep(m.project, m.team));
  st.tasks = st.tasks.filter((t) => keep(t.project, t.team));
  st.activity = st.activity.filter((it) => {
    const o = it.message || it.event || it.decision || it.memory || it.test_result || {};
    return keep(o.project, o.team);
  });
  const b = st.cockpit.board;
  const ft = (arr) => arr.filter((t) => keep(t.project, t.team));
  b.active_tasks = ft(b.active_tasks); b.open_tasks = ft(b.open_tasks); b.blocked_tasks = ft(b.blocked_tasks);
  b.waiting_review = ft(b.waiting_review); b.waiting_acknowledgement = ft(b.waiting_acknowledgement); b.stale_tasks = ft(b.stale_tasks);
  st.stats.online = st.agents.filter((a) => a.presence === "online").length;
  st.stats.working = st.agents.filter((a) => a.status === "working").length;
  st.stats.active_tasks = b.active_tasks.length;
  st.stats.attention = b.blocked_tasks.length + b.stale_tasks.length + b.waiting_review.length + b.waiting_acknowledgement.length + b.scope_conflicts.length;
  return st;
}

function readHash() {
  const h = location.hash.replace(/^#/, "");
  if (!h) return;
  const q = new URLSearchParams(h);
  if (q.has("p")) ui.sel.project = q.get("p");
  ui.sel.team = q.has("t") ? q.get("t") : null;
  if (q.has("v")) ui.sel.view = q.get("v");
}
function writeHash() {
  const q = new URLSearchParams();
  q.set("p", ui.sel.project || "*");
  if (ui.sel.team) q.set("t", ui.sel.team);
  q.set("v", ui.sel.view);
  history.replaceState(null, "", "#" + q.toString());
}

function projectViews() { return ui.sel.team ? VIEWS_TEAM : VIEWS_PROJECT; }

function selectProject(p) {
  ui.sel.project = p; ui.sel.team = null; ui.detail = null;
  if (!projectViews().some((v) => v[0] === ui.sel.view)) ui.sel.view = "attention";
  afterSelect();
}
function selectTeam(p, t) { ui.sel.project = p; ui.sel.team = t; ui.sel.view = "chat"; ui.detail = null; afterSelect(); }
function selectView(v) { ui.sel.view = v; afterSelect(); }
function afterSelect() { writeHash(); render(); tick(); }

function openEntity(type, id) {
  if (type === "agent") { ui.detail = { type: "agent", id: id }; render(); return; }
  if (type === "task") {
    ui.detail = { type: "task", id: id, data: null };
    api("/api/tasks/" + id).then((d) => { if (ui.detail && ui.detail.id === id) { ui.detail.data = d.error ? null : d; render(); } });
    render(); return;
  }
  if (type === "message") {
    ui.detail = { type: "message", id: id, data: null };
    api("/api/messages/" + id + "?full=1").then((d) => { if (ui.detail && ui.detail.id === id) { ui.detail.data = d.error ? null : d; render(); } });
    render(); return;
  }
}
function clearEntity() { ui.detail = null; render(); }
function toggleInspector() { ui.inspectorOpen = !ui.inspectorOpen; render(); }

document.addEventListener("click", (e) => {
  const el = e.target.closest("[data-act]");
  if (!el) return;
  const act = el.dataset.act;
  if (act === "project") selectProject(el.dataset.project);
  else if (act === "team") selectTeam(el.dataset.project, el.dataset.team);
  else if (act === "view") selectView(el.dataset.view);
  else if (act === "agent") openEntity("agent", el.dataset.name);
  else if (act === "task") openEntity("task", el.dataset.id);
  else if (act === "message") openEntity("message", el.dataset.id);
  else if (act === "clear-entity") clearEntity();
  else if (act === "toggle-inspector") toggleInspector();
});

async function tick() {
  try {
    const [sc, st] = await Promise.all([api("/api/scopes"), api(stateUrl())]);
    if (sc.error) throw new Error(sc.error.message);
    if (st.error) throw new Error(st.error.message);
    ui.scopes = sc; ui.state = applyNullFilters(st);
    if (ui.detail && ui.detail.type === "task") {
      const d = await api("/api/tasks/" + ui.detail.id);
      if (ui.detail && ui.detail.type === "task") ui.detail.data = d.error ? ui.detail.data : d;
    }
    render();
  } catch (e) {
    document.getElementById("mainBody").innerHTML = empty("Unable to read bus state: " + (e.message || String(e)));
  }
}

function render() {
  document.querySelector(".shell").classList.toggle("no-inspector", !ui.inspectorOpen);
  if (!ui.scopes || !ui.state) return;
  document.getElementById("scopeText").textContent = scopeLabel();
  document.getElementById("updatedAt").textContent = new Date(ui.state.generated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  renderProjectRail();
  renderTeamRail();
  renderHead();
  renderBody();
  renderInspector();
}

function projDisplay(p) { return p === "*" ? "all projects" : p === "__null__" ? "unscoped" : p; }
function scopeLabel() {
  const p = projDisplay(ui.sel.project);
  const t = ui.sel.team === "__null__" ? "unteamed" : ui.sel.team;
  return ui.sel.team ? p + " / #" + t : p;
}

function projectLabel(p) { return p === null ? "unscoped" : p; }
function initials(p) { if (p === null) return "~"; const parts = p.split(/[-_.]/).filter(Boolean); return ((parts[0] || p)[0] + (parts[1] ? parts[1][0] : "")).toUpperCase(); }

function renderProjectRail() {
  const totals = ui.scopes.totals;
  let html = "<div class='proj " + (ui.sel.project === "*" ? "active" : "") + "' data-act='project' data-project='*'>" +
    "<div class='avatar'>⊙</div><span class='plabel'>All</span><span class='ponline'>" + totals.agents_online + " on</span>" +
    (totals.attention ? "<span class='badge'>" + totals.attention + "</span>" : "") + "</div>";
  html += ui.scopes.projects.map((p) => {
    const key = p.project === null ? "__null__" : p.project;
    const active = ui.sel.project === key;
    return "<div class='proj " + (active ? "active" : "") + "' data-act='project' data-project='" + esc(key) + "' title='" + esc(projectLabel(p.project)) + "'>" +
      "<div class='avatar'>" + esc(initials(p.project)) + "</div>" +
      "<span class='plabel'>" + esc(projectLabel(p.project)) + "</span>" +
      "<span class='ponline'>" + p.agents_online + " on</span>" +
      (p.attention ? "<span class='badge'>" + p.attention + "</span>" : "") + "</div>";
  }).join("");
  document.getElementById("projectRail").innerHTML = html;
}

function teamsForRail() {
  if (ui.sel.project === "*") {
    const out = [];
    for (const p of ui.scopes.projects) for (const t of p.teams) out.push(Object.assign({ project: p.project }, t));
    return out;
  }
  const proj = ui.scopes.projects.find((p) => (p.project === null ? "__null__" : p.project) === ui.sel.project);
  if (!proj) return [];
  return proj.teams.map((t) => Object.assign({ project: proj.project }, t));
}
function teamKey(t) { return t === null ? "__null__" : t; }
function teamLabel(t) { return t === null ? "(unteamed)" : t; }

function renderTeamRail() {
  let html = "<div class='rail-section'>Views</div>";
  html += VIEWS_PROJECT.map((v) => {
    const active = !ui.sel.team && ui.sel.view === v[0];
    const badge = v[0] === "attention" && ui.state.stats.attention ? "<span class='badge'>" + ui.state.stats.attention + "</span>" : "";
    return "<div class='rail-item " + (active ? "active" : "") + "' data-act='view' data-view='" + v[0] + "'>" +
      "<span class='glyph'>" + v[2] + "</span><span class='rlabel'>" + v[1] + "</span>" + badge + "</div>";
  }).join("");
  const teams = teamsForRail();
  html += "<div class='rail-section'>Teams" + (teams.length ? " · " + teams.length : "") + "</div>";
  html += teams.length ? teams.map((t) => {
    const tk = teamKey(t.team);
    const pk = t.project === null ? "__null__" : t.project;
    const active = ui.sel.team === tk && ui.sel.project === pk;
    const prefix = ui.sel.project === "*" && t.project !== null ? esc(t.project) + " / " : "";
    const dotClass = t.agents_online > 0 ? "online" : "idle";
    const count = (t.active_tasks ? t.active_tasks + " task" + (t.active_tasks === 1 ? "" : "s") : (t.agents_total + " agent" + (t.agents_total === 1 ? "" : "s")));
    return "<div class='rail-item " + (active ? "active" : "") + "' data-act='team' data-project='" + esc(pk) + "' data-team='" + esc(tk) + "'>" +
      "<span class='glyph'><span class='dot " + dotClass + "'></span></span>" +
      "<span class='rlabel'>" + prefix + "#" + esc(teamLabel(t.team)) + "</span>" +
      (t.attention ? "<span class='badge'>" + t.attention + "</span>" : "<span class='rcount'>" + count + "</span>") + "</div>";
  }).join("") : "<div class='empty'>No teams in scope.</div>";
  document.getElementById("teamRail").innerHTML = html;
}

function renderHead() {
  const s = ui.state.stats;
  let html = "";
  if (ui.sel.team) {
    const members = ui.state.agents.map((a) =>
      "<span class='member' data-act='agent' data-name='" + esc(a.name) + "'><span class='dot " + esc(a.presence) + "'></span>" + esc(a.name) + "</span>").join("");
    html += "<div class='head-row'><div><div class='channel-title'><h2>#" + esc(teamLabel(ui.sel.team === "__null__" ? null : ui.sel.team)) + "</h2></div>" +
      "<div class='members'>" + (members || "<span class='time'>no agents in this team</span>") + "</div></div>" +
      metricsHtml(s) + "</div>";
    html += "<div class='subtabs'>" + VIEWS_TEAM.map((v) =>
      "<button class='subtab " + (ui.sel.view === v[0] ? "active" : "") + "' data-act='view' data-view='" + v[0] + "'>" + v[1] + "</button>").join("") + "</div>";
  } else {
    const title = (projectViews().find((v) => v[0] === ui.sel.view) || ["", "View"])[1];
    html += "<div class='head-row'><div><div class='eyebrow'>" + esc(projDisplay(ui.sel.project)) + "</div>" +
      "<h2>" + esc(title) + "</h2></div>" + metricsHtml(s) + "</div><div style='height:14px'></div>";
  }
  document.getElementById("mainHead").innerHTML = html;
}

function metricsHtml(s) {
  const m = [["online", s.online], ["working", s.working], ["tasks", s.active_tasks], ["attention", s.attention]];
  return "<div class='metrics'>" + m.map((x) => "<div class='metric'><strong>" + x[1] + "</strong><span>" + x[0] + "</span></div>").join("") + "</div>";
}

function renderBody() {
  const view = ui.sel.view;
  if (view === "chat") renderChat();
  else if (view === "kanban") renderKanban();
  else if (view === "activity") renderActivity();
  else if (view === "people") renderPeople();
  else renderAttention();
}

function renderChat() {
  const messages = ui.state.messages;
  document.getElementById("mainBody").innerHTML = "<div class='stream'>" + (messages.length ? messages.map((m) => {
    const large = m.truncated ? "<div class='large'>Large message · " + m.content_length + " chars · click to open full body</div>" : "";
    return "<article class='message' data-act='message' data-id='" + m.id + "'><div class='message-head'><div class='route'>" + esc(m.from_agent) + " → " + esc(m.to_agent) + "</div><span class='kind " + esc(m.kind) + "'>" + esc(m.kind) + "</span></div><p>" + esc(m.content_preview) + "</p>" + large + "<div class='time'>#" + m.id + " · " + time(m.created_at) + " · " + esc(m.status) + "</div></article>";
  }).join("") : empty("No messages in this scope yet.")) + "</div>";
}

function renderKanban() {
  const tasks = ui.state.tasks;
  document.getElementById("mainBody").innerHTML = "<div class='kanban'>" + lanes.map((lane) => {
    const title = lane[0], states = lane[1], phase = lane[2];
    const laneTasks = tasks.filter((t) => states.includes(t.state) && (!phase || t.phase === phase));
    return "<div class='lane'><div class='lane-title'><span>" + title + "</span><span>" + laneTasks.length + "</span></div><div class='lane-body'>" + (laneTasks.length ? laneTasks.map(taskCard).join("") : empty("empty")) + "</div></div>";
  }).join("") + "</div>";
}

function taskCard(t) {
  const owner = t.claimed_by || t.pending_assignee || t.requested_by;
  return "<article class='task-card' data-act='task' data-id='" + t.id + "'><div class='task-head'><div class='task-title'>#" + t.id + " " + esc(t.title) + "</div><span class='state " + esc(t.state) + "'>" + esc(t.state) + "</span></div><p>" + esc((t.description || t.result || "No description").slice(0, 140)) + "</p><div class='task-meta'><span class='status-pill'>" + esc(owner || "-") + "</span><span class='status-pill'>" + esc(t.mode || "task") + "</span><span class='status-pill'>" + esc(t.phase || "no phase") + "</span></div></article>";
}

function renderActivity() {
  const items = ui.state.activity;
  document.getElementById("mainBody").innerHTML = "<div class='timeline'>" + (items.length ? items.slice().reverse().map((item) =>
    "<article class='event'><div class='event-head'><div class='event-title'>" + esc(item.source) + "</div><span class='time'>" + time(item.at) + "</span></div><p>" + esc(item.summary) + "</p></article>").join("") : empty("No activity yet.")) + "</div>";
}

const PEOPLE_ORDER = ["Blocked", "Waiting review", "Working", "Idle", "Stale / away", "Sleeping", "Paused"];
function peopleBucket(a) {
  if (a.presence === "paused") return "Paused";
  if (a.presence === "stale") return "Stale / away";
  if (a.status === "blocked") return "Blocked";
  if (a.status === "waiting_review") return "Waiting review";
  if (a.status === "sleeping") return "Sleeping";
  if (a.status === "working") return "Working";
  return "Idle";
}
function renderPeople() {
  const agents = ui.state.agents;
  if (!agents.length) { document.getElementById("mainBody").innerHTML = empty("No agents registered in this scope."); return; }
  const groups = {};
  for (const a of agents) { const b = peopleBucket(a); (groups[b] = groups[b] || []).push(a); }
  const html = PEOPLE_ORDER.filter((b) => groups[b]).map((b) => {
    const rows = groups[b].map((a) => {
      const caps = (a.capabilities || []).slice(0, 3).join(", ") || "no capabilities";
      const task = a.active_task_id ? " · on task #" + a.active_task_id : "";
      return "<div class='person' data-act='agent' data-name='" + esc(a.name) + "'><span class='dot " + esc(a.presence) + "'></span><div><div class='agent-name'>" + esc(a.name) + "</div><div class='agent-meta'>" + esc(a.role || "worker") + " · " + esc(caps) + " · seen " + ageText(a.age_s) + task + "</div></div><span class='status-pill " + esc(a.status) + "'>" + esc(a.status) + "</span></div>";
    }).join("");
    return "<div class='people-group'><h3>" + b + " <span class='time'>" + groups[b].length + "</span></h3>" + rows + "</div>";
  }).join("");
  document.getElementById("mainBody").innerHTML = html;
}

function attentionRows(board) {
  const rows = [];
  for (const t of board.blocked_tasks) rows.push({ sev: "blocked", label: "BLOCKED", id: t.id, title: t.title, note: t.blocked_reason || "no reason recorded", at: t.updated_at });
  for (const t of board.stale_tasks) rows.push({ sev: "stale", label: "STALE", id: t.id, title: t.title, note: "holder " + (t.claimed_by || "?") + " went quiet", at: t.updated_at });
  for (const t of board.waiting_review) rows.push({ sev: "review", label: "REVIEW", id: t.id, title: t.title, note: "needs a verifier to approve", at: t.updated_at });
  for (const t of board.waiting_acknowledgement) rows.push({ sev: "ack", label: "ACK", id: t.id, title: t.title, note: "assigned to " + (t.pending_assignee || t.claimed_by || "?") + ", not acknowledged", at: t.updated_at });
  for (const c of board.scope_conflicts) rows.push({ sev: "conflict", label: "CONFLICT", id: c.task_id, title: c.title, note: "edit scope overlaps " + c.conflicts.map((x) => "#" + x.task_id).join(", "), at: 0 });
  return rows;
}
function renderAttention() {
  const board = ui.state.cockpit.board;
  const rows = attentionRows(board);
  let html = "";
  if (rows.length) {
    html += "<div class='attn'>" + rows.map((r) =>
      "<div class='attn-row " + r.sev + "' data-act='task' data-id='" + r.id + "'><div class='sev'>" + r.label + "</div>" +
      "<div class='attn-main'><strong>#" + r.id + " " + esc(r.title) + "</strong><p>" + esc(r.note) + "</p></div>" +
      "<div class='at'>" + (r.at ? relTime(r.at) : "") + "</div></div>").join("") + "</div>";
  } else {
    html += empty("Nothing needs attention in this scope. ✨");
  }
  const ready = ui.state.cockpit.ready;
  if (ready.length) html += "<div class='memory-block'><h3>Ready to pick up</h3><div class='cockpit-list ready'>" + ready.map(note).join("") + "</div></div>";
  document.getElementById("mainBody").innerHTML = html;
}

function renderInspector() {
  const box = document.getElementById("inspector");
  if (ui.detail && ui.detail.type === "agent") { box.innerHTML = inspectorHead("Agent") + agentProfile(ui.detail.id); return; }
  if (ui.detail && ui.detail.type === "task") { box.innerHTML = inspectorHead("Task #" + ui.detail.id) + (ui.detail.data ? taskDetail(ui.detail.data) : empty("Loading task…")); return; }
  if (ui.detail && ui.detail.type === "message") { box.innerHTML = inspectorHead("Message #" + ui.detail.id) + (ui.detail.data ? messageDetail(ui.detail.data) : empty("Loading message…")); return; }
  box.innerHTML = inspectorHead("Cockpit", false) + cockpitSummary();
}
function inspectorHead(title, closable) {
  const btn = closable === false ? "" : "<button class='ghost' data-act='clear-entity'>back</button>";
  return "<div class='insp-head'><h2>" + esc(title) + "</h2>" + btn + "</div>";
}

function cockpitSummary() {
  const c = ui.state.cockpit;
  const sections = [["waiting", "Waiting on", c.waiting_on], ["ready", "Ready", c.ready], ["blockers", "Blockers", c.blockers], ["suggested", "Suggested next", c.suggested_next_actions]];
  let html = sections.map((sec) => "<h3>" + sec[1] + "</h3><div class='cockpit-list " + sec[0] + "'>" + (sec[2].length ? sec[2].map(note).join("") : note("none")) + "</div>").join("");
  html += "<div class='memory-block'><h3>Pinned memory</h3>" + (ui.state.memories.length ? ui.state.memories.map((m) => note("[" + m.kind + "] " + m.content)).join("") : note("none")) + "</div>";
  html += "<div class='memory-block'><h3>Decisions</h3>" + (ui.state.decisions.length ? ui.state.decisions.map((d) => note(d.decision + (d.implemented ? " (implemented)" : ""))).join("") : note("none")) + "</div>";
  return html;
}

function agentProfile(name) {
  const a = (ui.state.agents || []).find((x) => x.name === name);
  if (!a) return empty("Agent " + esc(name) + " is not in the current scope.");
  const caps = (a.capabilities || []).join(", ") || "none";
  let html = "<div class='profile-name'><span class='dot " + esc(a.presence) + "'></span>" + esc(a.name) + "</div>";
  html += "<div class='profile-sub'>" + esc(a.role || "worker") + " · " + esc(a.presence) + " · seen " + ageText(a.age_s) + "</div>";
  html += "<dl class='kv'>" +
    kv("status", a.status) + kv("project", a.project || "—") + kv("team", a.team || "—") +
    kv("capabilities", caps) + kv("active task", a.active_task_id ? "#" + a.active_task_id : "—") + "</dl>";
  const mine = (ui.state.messages || []).filter((m) => m.from_agent === name || m.to_agent === name).slice(0, 6);
  html += "<h3>Recent messages</h3><div class='stream'>" + (mine.length ? mine.map((m) =>
    "<article class='message' data-act='message' data-id='" + m.id + "'><div class='message-head'><div class='route'>" + esc(m.from_agent) + " → " + esc(m.to_agent) + "</div><span class='kind " + esc(m.kind) + "'>" + esc(m.kind) + "</span></div><p>" + esc(m.content_preview) + "</p></article>").join("") : empty("No recent messages.")) + "</div>";
  return html;
}

function taskDetail(d) {
  const t = d.task;
  const owner = t.claimed_by || t.pending_assignee || t.requested_by;
  let html = "<div class='profile-name'>#" + t.id + " <span class='state " + esc(t.state) + "'>" + esc(t.state) + "</span></div>";
  html += "<div class='profile-sub'>" + esc(t.title) + "</div>";
  html += "<dl class='kv'>" +
    kv("owner", owner || "—") + kv("requested", t.requested_by) + kv("mode", t.mode) +
    kv("phase", t.phase || "—") + kv("review", t.review_required ? t.review_state : "not required") +
    kv("ack", t.ack_required ? (t.acknowledged_at ? "yes" : "pending") : "not required") +
    kv("edit", (t.edit_scope || []).join(", ") || "—") + "</dl>";
  if (t.description) html += "<div class='note'><p>" + esc(t.description) + "</p></div>";
  html += "<div class='memory-block'><h3>Events</h3><div class='timeline'>" + (d.events.length ? d.events.slice().reverse().map((e) =>
    "<article class='event'><div class='event-head'><div class='event-title'>" + esc(e.by_agent) + " · " + esc(e.event_type) + (e.phase ? " → " + esc(e.phase) : "") + "</div><span class='time'>" + time(e.created_at) + "</span></div><p>" + esc(e.message) + "</p></article>").join("") : empty("No events.")) + "</div></div>";
  if (d.test_results.length) html += "<div class='memory-block'><h3>Test results</h3>" + d.test_results.map((r) => note("[" + r.status + "] " + r.command + (r.output_summary ? " — " + r.output_summary : ""))).join("") + "</div>";
  html += "<div class='memory-block'><h3>Thread</h3><div class='stream'>" + (d.messages.length ? d.messages.slice(-8).map((m) =>
    "<article class='message' data-act='message' data-id='" + m.id + "'><div class='message-head'><div class='route'>" + esc(m.from_agent) + " → " + esc(m.to_agent) + "</div><span class='kind " + esc(m.kind) + "'>" + esc(m.kind) + "</span></div><p>" + esc((m.content || "").slice(0, 360)) + "</p></article>").join("") : empty("No thread messages.")) + "</div></div>";
  return html;
}

function messageDetail(m) {
  const body = m.content != null ? m.content : (m.content_preview || "");
  let html = "<dl class='kv'>" + kv("from", m.from_agent) + kv("to", m.to_agent) + kv("kind", m.kind) +
    kv("status", m.status) + kv("thread", m.thread_id || "—") + kv("sent", time(m.created_at)) + "</dl>";
  html += "<div class='note'><p>" + esc(body) + "</p></div>";
  if (m.truncated && m.content == null) html += "<div class='large'>" + m.content_length + " chars total.</div>";
  return html;
}

function kv(k, v) { return "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>"; }
function note(value) { return "<div class='note'><p>" + esc(value) + "</p></div>"; }
function empty(value) { return "<div class='empty'>" + esc(value) + "</div>"; }
function time(ms) { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function relTime(ms) { const s = Math.max(0, Math.round((Date.now() - ms) / 1000)); return ageText(s); }
function ageText(s) {
  if (s == null) return "—";
  if (s < 60) return s + "s";
  const m = Math.round(s / 60); if (m < 60) return m + "m";
  const h = Math.round(m / 60); if (h < 24) return h + "h";
  return Math.round(h / 24) + "d";
}
function esc(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.addEventListener("hashchange", () => { readHash(); render(); tick(); });
readHash();
tick();
setInterval(tick, 2000);`;
}
