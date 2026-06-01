import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { resolve } from "node:path";
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
  console.log(`scope: project=${scope.project ?? "-"} area=${scope.area ?? "-"} team=${scope.team ?? "-"}`);
  console.log(`db: ${dbPath()}`);
  console.log(kleur.gray("Press Ctrl+C to stop."));
  if (opts.open !== false) {
    void import("node:child_process").then(({ spawn }) => {
      const child = spawn("open", [url], { stdio: "ignore", detached: true });
      child.unref();
    }).catch(() => undefined);
  }
}

function handleRequest(req: IncomingMessage, res: ServerResponse, scope: ScopeOptions): void {
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
    if (url.pathname === "/api/state") {
      sendJson(res, buildState(scope));
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
      <div>
        <div class="eyebrow">local cockpit</div>
        <h1>Agent Bus</h1>
      </div>
      <div class="scope">
        <span id="scopeText">loading scope</span>
        <span class="live"><i></i> live</span>
      </div>
    </header>
    <main class="shell">
      <section class="agents">
        <div class="section-head">
          <h2>Agents</h2>
          <span id="agentCount">0</span>
        </div>
        <div id="agents"></div>
      </section>
      <section class="workspace">
        <div class="hero-line">
          <div>
            <div class="eyebrow">team operating picture</div>
            <h2 id="headline">No bus state loaded yet</h2>
          </div>
          <div class="metrics" id="metrics"></div>
        </div>
        <nav class="tabs">
          <button class="tab active" data-tab="chat">Chat</button>
          <button class="tab" data-tab="kanban">Kanban</button>
          <button class="tab" data-tab="activity">Activity</button>
          <button class="tab" data-tab="map">Map</button>
        </nav>
        <section class="panel active" id="tab-chat">
          <div class="stream" id="messages"></div>
        </section>
        <section class="panel" id="tab-kanban">
          <div class="kanban" id="kanban"></div>
        </section>
        <section class="panel" id="tab-activity">
          <div class="timeline" id="activity"></div>
        </section>
        <section class="panel" id="tab-map">
          <div class="map" id="map"></div>
        </section>
      </section>
      <aside class="inspector">
        <div class="section-head">
          <h2>Cockpit</h2>
          <span id="updatedAt">--</span>
        </div>
        <div id="cockpit"></div>
        <div class="memory-block">
          <h3>Pinned Memory</h3>
          <div id="memories"></div>
        </div>
        <div class="memory-block">
          <h3>Decisions</h3>
          <div id="decisions"></div>
        </div>
      </aside>
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
  letter-spacing: 0;
}
button, input { font: inherit; }
.topbar {
  height: 72px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 22px;
  border-bottom: 1px solid var(--line-soft);
  background: rgba(11, 13, 16, .88);
  backdrop-filter: blur(18px);
  position: sticky;
  top: 0;
  z-index: 10;
}
h1, h2, h3, p { margin: 0; }
h1 { font-size: 24px; font-weight: 720; }
h2 { font-size: 15px; font-weight: 680; }
h3 { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; margin-bottom: 10px; }
.eyebrow { color: var(--accent); font-size: 11px; text-transform: uppercase; letter-spacing: .12em; margin-bottom: 5px; }
.scope { display: flex; align-items: center; gap: 14px; color: var(--muted); font-size: 12px; }
.live { display: inline-flex; gap: 7px; align-items: center; color: var(--text); }
.live i { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 18px var(--accent); }
.shell {
  display: grid;
  grid-template-columns: 280px minmax(560px, 1fr) 340px;
  gap: 1px;
  min-height: calc(100vh - 72px);
  background: var(--line-soft);
}
.agents, .workspace, .inspector { background: rgba(13, 16, 20, .98); min-width: 0; }
.agents, .inspector { padding: 18px; }
.workspace { padding: 20px 22px 26px; }
.section-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; color: var(--muted); }
.section-head span { color: var(--soft); font-size: 12px; }
.agent-row {
  display: grid;
  grid-template-columns: 10px 1fr auto;
  gap: 10px;
  align-items: center;
  min-height: 58px;
  border-bottom: 1px solid var(--line-soft);
}
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--soft); }
.dot.online { background: var(--accent); }
.dot.idle { background: var(--accent-2); }
.dot.stale { background: var(--warning); }
.dot.paused { background: var(--danger); }
.agent-name { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.agent-meta { margin-top: 5px; color: var(--muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.status-pill, .kind, .state {
  border: 1px solid var(--line);
  border-radius: 999px;
  color: var(--muted);
  padding: 4px 8px;
  font-size: 11px;
  white-space: nowrap;
}
.status-pill.working, .state.working { color: var(--accent); border-color: rgba(71, 214, 182, .35); }
.status-pill.blocked, .state.blocked, .state.failed { color: var(--danger); border-color: rgba(255, 107, 107, .35); }
.status-pill.waiting_review, .state.review { color: var(--review); border-color: rgba(199, 144, 255, .35); }
.hero-line {
  min-height: 96px;
  display: flex;
  justify-content: space-between;
  align-items: end;
  gap: 24px;
  border-bottom: 1px solid var(--line-soft);
  padding-bottom: 18px;
}
.hero-line h2 { font-size: 28px; line-height: 1.08; max-width: 680px; }
.metrics { display: grid; grid-template-columns: repeat(4, 82px); gap: 10px; }
.metric { border-left: 1px solid var(--line); padding-left: 10px; }
.metric strong { display: block; font-size: 24px; font-weight: 740; }
.metric span { color: var(--muted); font-size: 11px; }
.tabs { display: flex; gap: 8px; border-bottom: 1px solid var(--line-soft); padding: 14px 0 0; }
.tab {
  appearance: none;
  border: 0;
  background: transparent;
  color: var(--muted);
  padding: 11px 12px;
  border-bottom: 2px solid transparent;
  cursor: pointer;
}
.tab.active { color: var(--text); border-bottom-color: var(--accent); }
.panel { display: none; padding-top: 18px; }
.panel.active { display: block; }
.stream, .timeline { display: grid; gap: 1px; background: var(--line-soft); border: 1px solid var(--line-soft); }
.message, .event, .task-card, .note {
  background: var(--surface);
  padding: 13px 14px;
}
.message-head, .event-head, .task-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.route, .event-title { font-size: 13px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.time { color: var(--soft); font-size: 11px; white-space: nowrap; }
.message p, .event p, .task-card p, .note p { color: #c7d0da; font-size: 12px; line-height: 1.45; overflow-wrap: anywhere; }
.kind.ask { color: var(--warning); border-color: rgba(242, 191, 94, .35); }
.kind.reply { color: var(--accent); border-color: rgba(71, 214, 182, .35); }
.kind.msg { color: var(--accent-2); border-color: rgba(138, 167, 255, .35); }
.large {
  margin-top: 10px;
  border: 1px solid rgba(242, 191, 94, .22);
  color: var(--warning);
  padding: 8px 10px;
  font-size: 11px;
  background: rgba(242, 191, 94, .06);
}
.kanban {
  display: grid;
  grid-template-columns: repeat(6, minmax(148px, 1fr));
  gap: 10px;
  align-items: start;
}
.lane { min-width: 0; }
.lane-title {
  display: flex;
  justify-content: space-between;
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: .08em;
  margin-bottom: 10px;
}
.lane-body { display: grid; gap: 8px; }
.task-card { border: 1px solid var(--line-soft); background: var(--surface); min-height: 112px; }
.task-title { font-size: 13px; font-weight: 650; line-height: 1.35; }
.task-meta { margin-top: 10px; display: flex; flex-wrap: wrap; gap: 6px; }
.cockpit-list { display: grid; gap: 8px; margin-bottom: 18px; }
.cockpit-list .note { border-left: 2px solid var(--line); }
.cockpit-list.waiting .note { border-left-color: var(--warning); }
.cockpit-list.blockers .note { border-left-color: var(--danger); }
.cockpit-list.ready .note { border-left-color: var(--accent); }
.memory-block { border-top: 1px solid var(--line-soft); padding-top: 16px; margin-top: 16px; }
.map {
  min-height: 470px;
  position: relative;
  overflow: hidden;
  border: 1px solid var(--line-soft);
  background:
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px),
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    var(--surface);
  background-size: 32px 32px;
}
.node {
  position: absolute;
  min-width: 148px;
  padding: 12px;
  border: 1px solid var(--line);
  background: rgba(17, 21, 26, .94);
}
.node strong { display: block; font-size: 13px; margin-bottom: 5px; }
.node span { color: var(--muted); font-size: 11px; }
.edge {
  position: absolute;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  transform-origin: left center;
  opacity: .72;
}
.empty { color: var(--soft); padding: 18px; font-size: 12px; background: var(--surface); }
@media (max-width: 1180px) {
  .shell { grid-template-columns: 240px 1fr; }
  .inspector { grid-column: 1 / -1; }
  .metrics { grid-template-columns: repeat(2, 82px); }
}
@media (max-width: 760px) {
  .topbar { height: auto; min-height: 72px; align-items: flex-start; flex-direction: column; padding: 16px; gap: 10px; }
  .shell { grid-template-columns: 1fr; min-height: auto; }
  .hero-line { align-items: start; flex-direction: column; }
  .hero-line h2 { font-size: 23px; }
  .metrics { grid-template-columns: repeat(4, 1fr); width: 100%; }
  .kanban { grid-template-columns: 1fr; }
}`;
}

function js(): string {
  return `const stateUrl = "/api/state";
let currentTab = "chat";
const lanes = [
  ["todo", ["open"]],
  ["accepted", ["claimed"]],
  ["doing", ["working"]],
  ["testing", ["working"], "testing"],
  ["review", ["working"], "review"],
  ["blocked", ["blocked"]],
  ["done", ["completed", "failed", "canceled"]]
];

document.querySelectorAll(".tab").forEach((button) => {
  button.addEventListener("click", () => {
    currentTab = button.dataset.tab;
    document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab === button));
    document.querySelectorAll(".panel").forEach((panel) => panel.classList.toggle("active", panel.id === "tab-" + currentTab));
  });
});

async function load() {
  try {
    const res = await fetch(stateUrl, { cache: "no-store" });
    const state = await res.json();
    if (state.error) throw new Error(state.error.message);
    render(state);
  } catch (error) {
    document.getElementById("headline").textContent = "Unable to read bus state";
    document.getElementById("cockpit").innerHTML = note(error.message || String(error));
  }
}

function render(state) {
  document.getElementById("scopeText").textContent = "project=" + (state.scope.project || "-") + " / area=" + (state.scope.area || "-") + " / team=" + (state.scope.team || "-");
  document.getElementById("updatedAt").textContent = new Date(state.generated_at).toLocaleTimeString();
  document.getElementById("headline").textContent = headline(state);
  renderMetrics(state.stats);
  renderAgents(state.agents);
  renderMessages(state.messages);
  renderKanban(state.tasks);
  renderActivity(state.activity);
  renderCockpit(state.cockpit);
  renderNotes("memories", state.memories.map((m) => "[" + m.kind + "] " + m.content));
  renderNotes("decisions", state.decisions.map((d) => d.decision + (d.implemented ? " (implemented)" : "")));
  renderMap(state.agents, state.messages);
}

function headline(state) {
  if (state.stats.blocked) return state.stats.blocked + " blocked agent" + plural(state.stats.blocked) + " need attention";
  if (state.cockpit.waiting_on.length) return state.cockpit.waiting_on.length + " coordination item" + plural(state.cockpit.waiting_on.length) + " waiting";
  if (state.stats.active_tasks) return state.stats.active_tasks + " active task" + plural(state.stats.active_tasks) + " moving through the bus";
  if (state.stats.online) return state.stats.online + " agent" + plural(state.stats.online) + " online and ready";
  return "No active agents in this scope";
}

function renderMetrics(stats) {
  const metrics = [
    ["online", stats.online],
    ["working", stats.working],
    ["tasks", stats.active_tasks],
    ["unread", stats.unread_messages]
  ];
  document.getElementById("metrics").innerHTML = metrics.map(([label, value]) => "<div class='metric'><strong>" + value + "</strong><span>" + label + "</span></div>").join("");
}

function renderAgents(agents) {
  document.getElementById("agentCount").textContent = String(agents.length);
  document.getElementById("agents").innerHTML = agents.length ? agents.map((agent) => {
    const caps = (agent.capabilities || []).slice(0, 3).join(", ") || "no capabilities";
    return "<div class='agent-row'><span class='dot " + esc(agent.presence) + "'></span><div><div class='agent-name'>" + esc(agent.name) + "</div><div class='agent-meta'>" + esc(agent.role || agent.team || "unscoped") + " · " + esc(caps) + " · seen " + agent.age_s + "s</div></div><span class='status-pill " + esc(agent.status) + "'>" + esc(agent.status) + "</span></div>";
  }).join("") : empty("No agents registered in this scope.");
}

function renderMessages(messages) {
  document.getElementById("messages").innerHTML = messages.length ? messages.map((message) => {
    const large = message.truncated ? "<div class='large'>Large message · " + message.content_length + " chars · use get_message for full body</div>" : "";
    return "<article class='message'><div class='message-head'><div class='route'>" + esc(message.from_agent) + " → " + esc(message.to_agent) + "</div><span class='kind " + esc(message.kind) + "'>" + esc(message.kind) + "</span></div><p>" + esc(message.content_preview) + "</p>" + large + "<div class='time'>#" + message.id + " · " + time(message.created_at) + " · " + esc(message.status) + "</div></article>";
  }).join("") : empty("No recent messages in this scope.");
}

function renderKanban(tasks) {
  const html = lanes.map(([title, states, phase]) => {
    const laneTasks = tasks.filter((task) => states.includes(task.state) && (!phase || task.phase === phase));
    return "<div class='lane'><div class='lane-title'><span>" + title + "</span><span>" + laneTasks.length + "</span></div><div class='lane-body'>" + (laneTasks.length ? laneTasks.map(taskCard).join("") : empty("empty")) + "</div></div>";
  }).join("");
  document.getElementById("kanban").innerHTML = html;
}

function taskCard(task) {
  const owner = task.claimed_by || task.pending_assignee || task.requested_by;
  return "<article class='task-card'><div class='task-head'><div class='task-title'>#" + task.id + " " + esc(task.title) + "</div><span class='state " + esc(task.state) + "'>" + esc(task.state) + "</span></div><p>" + esc(task.description || task.result || "No description") + "</p><div class='task-meta'><span class='status-pill'>" + esc(owner || "-") + "</span><span class='status-pill'>" + esc(task.mode || "task") + "</span><span class='status-pill'>" + esc(task.phase || "no phase") + "</span></div></article>";
}

function renderActivity(items) {
  document.getElementById("activity").innerHTML = items.length ? items.map((item) => "<article class='event'><div class='event-head'><div class='event-title'>" + esc(item.source) + "</div><span class='time'>" + time(item.at) + "</span></div><p>" + esc(item.summary) + "</p></article>").join("") : empty("No activity yet.");
}

function renderCockpit(cockpit) {
  const sections = [
    ["waiting", "Waiting on", cockpit.waiting_on],
    ["ready", "Ready", cockpit.ready],
    ["blockers", "Blockers", cockpit.blockers],
    ["suggested", "Suggested", cockpit.suggested_next_actions]
  ];
  document.getElementById("cockpit").innerHTML = sections.map(([cls, title, values]) => "<h3>" + title + "</h3><div class='cockpit-list " + cls + "'>" + (values.length ? values.map((value) => note(value)).join("") : note("none")) + "</div>").join("");
}

function renderNotes(id, rows) {
  document.getElementById(id).innerHTML = rows.length ? rows.map(note).join("") : note("none");
}

function renderMap(agents, messages) {
  const box = document.getElementById("map");
  const count = Math.max(agents.length, 1);
  const centerX = 46;
  const centerY = 42;
  const radiusX = 33;
  const radiusY = 28;
  const nodes = agents.map((agent, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2;
    const x = centerX + Math.cos(angle) * radiusX;
    const y = centerY + Math.sin(angle) * radiusY;
    return { agent, x, y };
  });
  const nodeHtml = nodes.map(({ agent, x, y }) => "<div class='node' style='left:" + x + "%;top:" + y + "%;transform:translate(-50%,-50%)'><strong>" + esc(agent.name) + "</strong><span>" + esc(agent.status) + " · " + esc(agent.presence) + "</span></div>").join("");
  const byName = new Map(nodes.map((node) => [node.agent.name, node]));
  const edgeHtml = messages.slice(-18).map((message) => {
    const a = byName.get(message.from_agent);
    const b = byName.get(message.to_agent);
    if (!a || !b) return "";
    const x1 = a.x;
    const y1 = a.y;
    const x2 = b.x;
    const y2 = b.y;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const len = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    return "<div class='edge' style='left:" + x1 + "%;top:" + y1 + "%;width:" + len + "%;transform:rotate(" + angle + "deg)'></div>";
  }).join("");
  box.innerHTML = edgeHtml + nodeHtml || empty("No agent graph available.");
}

function note(value) { return "<div class='note'><p>" + esc(value) + "</p></div>"; }
function empty(value) { return "<div class='empty'>" + esc(value) + "</div>"; }
function plural(n) { return n === 1 ? "" : "s"; }
function time(ms) { return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

load();
setInterval(load, 1500);`;
}
