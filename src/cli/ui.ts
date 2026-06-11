import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import kleur from "kleur";
import {
  activityTimeline,
  cockpit,
  deleteTeam,
  directory,
  getMessage,
  listDecisions,
  listMemories,
  listTasks,
  messagePage,
  messageThread,
  recentMessages,
  removeAgent,
  scopes,
  taskResult,
  timeseries,
  type MessagePreview,
} from "../bus.js";
import { BusError } from "../util/errors.js";
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
  const server = createServer((req, res) => {
    void handleRequest(req, res, scope);
  });
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

async function handleRequest(req: IncomingMessage, res: ServerResponse, defaultScope: ScopeOptions): Promise<void> {
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
    if (url.pathname === "/api/remove-agent" && req.method === "POST") {
      const body = await readJsonBody(req);
      sendJson(res, removeAgent({
        name: requiredString(body, "name"),
        release_tasks: optionalBoolean(body, "release_tasks"),
        force: optionalBoolean(body, "force"),
      }));
      return;
    }
    if (url.pathname === "/api/delete-team" && req.method === "POST") {
      const body = await readJsonBody(req);
      const project = optionalString(body, "project");
      const area = optionalString(body, "area");
      sendJson(res, deleteTeam({
        team: requiredString(body, "team"),
        project: project === "all" ? "*" : project,
        area: area === "all" ? "*" : area,
        release_tasks: optionalBoolean(body, "release_tasks"),
        force: optionalBoolean(body, "force"),
      }));
      return;
    }
    if (url.pathname === "/api/state") {
      sendJson(res, buildState(scopeFromQuery(url, defaultScope)));
      return;
    }
    if (url.pathname === "/api/metrics") {
      const scope = scopeFromQuery(url, defaultScope);
      const buckets = url.searchParams.get("buckets");
      const windowH = url.searchParams.get("window_h");
      const days = url.searchParams.get("days");
      sendJson(res, timeseries({
        project: scope.project,
        area: scope.area,
        team: scope.team,
        buckets: buckets ? Number(buckets) : undefined,
        window_ms: windowH ? Number(windowH) * 3600 * 1000 : undefined,
        days: days ? Number(days) : undefined,
      }));
      return;
    }
    if (url.pathname === "/api/messages") {
      const scope = scopeFromQuery(url, defaultScope);
      const before = url.searchParams.get("before");
      const limit = url.searchParams.get("limit");
      sendJson(res, messagePage({
        project: scope.project,
        area: scope.area,
        team: scope.team,
        before_id: before ? Number(before) : undefined,
        limit: limit ? Number(limit) : undefined,
      }));
      return;
    }
    if (url.pathname === "/api/thread") {
      const root = url.searchParams.get("root");
      if (root) {
        sendJson(res, messageThread(Number(root)));
        return;
      }
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
    const code = error instanceof BusError ? error.code : "UI_ERROR";
    sendJson(res, { error: { code, message } }, error instanceof BusError ? 400 : 500);
  }
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 64 * 1024) throw new Error("request body too large");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("expected JSON object body");
  }
  return parsed as Record<string, unknown>;
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${key} is required`);
  }
  return value;
}

function optionalString(body: Record<string, unknown>, key: string): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string") throw new Error(`${key} must be a string`);
  return value;
}

function optionalBoolean(body: Record<string, unknown>, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "boolean") throw new Error(`${key} must be a boolean`);
  return value;
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
    board.board.overdue_tasks.length +
    board.board.checkin_due_tasks.length +
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
  <header class="top">
    <div class="brand"><div class="logo">AB</div><div><div class="ey">command center</div><h1>Agent Bus</h1></div></div>
    <div class="kpis" id="kpis"></div>
    <div class="tr"><span class="cmdk" id="scopeText">loading…</span><span class="clock"><span class="dotlive"></span><span id="clock">live</span></span></div>
  </header>
  <div class="shell">
    <nav class="sidebar">
      <div class="s-grp">Views</div>
      <div class="viewitem" data-view="attention"><span class="g">⚡</span>Attention<span class="c alert" id="vc-attention"></span></div>
      <div class="viewitem" data-view="kanban"><span class="g">▤</span>Kanban<span class="c" id="vc-kanban"></span></div>
      <div class="viewitem" data-view="activity"><span class="g">◴</span>Activity<span class="c" id="vc-activity"></span></div>
      <div class="viewitem" data-view="people"><span class="g">◉</span>People<span class="c" id="vc-people"></span></div>
      <div class="s-grp">Projects <span id="projCount"></span></div>
      <div id="projects"></div>
    </nav>
    <div class="center">
      <div class="metrics-strip" id="metrics"></div>
      <div class="chat-card">
        <div class="chat-head" id="mainHead"></div>
        <div class="scroller" id="mainBody"></div>
        <div class="chat-foot" id="mainFoot"></div>
      </div>
    </div>
    <aside class="right" id="right"></aside>
  </div>
  <div class="drawer-wrap" id="drawer"></div>
  <script src="/app.js"></script>
</body>
</html>`;
}

function css(): string {
  return `:root{
  --bg:#070a0e; --panel:#0f141b; --panel-2:#141b24; --panel-3:#19212b; --line:#1f2630; --line-soft:#161c24;
  --text:#eaf1f8; --muted:#8a98a8; --soft:#566270;
  --accent:#3ad6b6; --blue:#6ea8fe; --purple:#c79bff; --amber:#f4c06a; --red:#ff6f6f; --green:#62d98a;
  --mono:ui-monospace,SFMono-Regular,Menlo,monospace;
  font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:
  radial-gradient(900px 380px at 12% -12%,rgba(58,214,182,.10),transparent 60%),
  radial-gradient(700px 360px at 98% -8%,rgba(110,168,254,.08),transparent 55%),
  var(--bg);color:var(--text);height:100vh;overflow:hidden}
h1,h2,h3,h4,p{margin:0}.mono{font-family:var(--mono)}button{font:inherit}
.top{height:58px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--line-soft);background:rgba(7,10,14,.7);backdrop-filter:blur(14px)}
.brand{display:flex;align-items:center;gap:11px;width:230px}
.logo{width:30px;height:30px;border-radius:8px;background:linear-gradient(135deg,var(--accent),var(--blue));display:grid;place-items:center;color:#04130f;font-weight:800}
.brand .ey{font-size:9px;letter-spacing:.16em;text-transform:uppercase;color:var(--accent)}.brand h1{font-size:16px;font-weight:760}
.kpis{display:flex;gap:8px;flex-wrap:wrap}
.kchip{display:flex;align-items:center;gap:8px;background:var(--panel);border:1px solid var(--line-soft);border-radius:10px;padding:6px 12px}
.kchip .v{font-family:var(--mono);font-weight:700;font-size:15px}.kchip .l{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.07em}
.kchip.alert .v{color:var(--red)}
.tr{display:flex;align-items:center;gap:12px}
.cmdk{font-size:12px;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:5px 9px;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.clock{font-family:var(--mono);font-size:13px;color:var(--muted);display:flex;align-items:center;gap:7px}
.dotlive{width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:0 0 14px var(--accent)}
.shell{display:grid;grid-template-columns:248px 1fr 326px;height:calc(100vh - 58px)}
.sidebar{border-right:1px solid var(--line-soft);overflow-y:auto;padding:12px 10px}
.s-grp{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--soft);margin:14px 8px 6px;display:flex;justify-content:space-between}
.viewitem{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:9px;cursor:pointer;color:var(--muted);font-size:13px}
.viewitem:hover{background:var(--panel)}.viewitem.active{background:var(--panel-2);color:var(--text)}
.viewitem .g{width:16px;text-align:center}.viewitem .c{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--soft)}
.viewitem .c.alert{color:var(--red)}
.proj{border-radius:10px;margin-bottom:2px}
.proj-row{display:flex;align-items:center;gap:10px;padding:9px 10px;border-radius:9px;cursor:pointer;color:var(--text)}
.proj-row:hover{background:var(--panel)}
.proj.active>.proj-row{background:var(--panel-2);box-shadow:inset 2px 0 0 var(--accent)}
.proj-row .chev{color:var(--soft);font-size:10px;transition:transform .15s;width:10px}
.proj.open .chev{transform:rotate(90deg)}
.proj-row .pava{width:26px;height:26px;border-radius:8px;background:var(--panel-3);display:grid;place-items:center;font-size:10px;font-weight:800;color:var(--text);flex:none}
.proj-row .pname{font-size:13.5px;font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.proj-row .pmeta{font-size:10px;color:var(--soft);font-family:var(--mono)}
.proj-row .badge,.team-row .badge{min-width:16px;height:16px;border-radius:8px;background:var(--red);color:#1a0707;font-size:9px;font-weight:800;display:grid;place-items:center;padding:0 4px}
.teams{display:none;padding:2px 0 6px 14px}
.proj.open .teams{display:block}
.team-row{display:flex;align-items:center;gap:9px;padding:7px 10px;border-radius:8px;cursor:pointer;color:var(--muted);font-size:12.5px}
.team-row:hover{background:var(--panel)}.team-row.active{background:var(--panel-2);color:var(--text)}
.team-row .d{width:7px;height:7px;border-radius:50%;background:var(--soft);flex:none}.team-row .d.on{background:var(--accent);box-shadow:0 0 9px var(--accent)}
.team-row .tn{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.team-row .tc{font-family:var(--mono);font-size:10px;color:var(--soft)}
.center{display:flex;flex-direction:column;min-width:0;overflow:hidden;padding:14px;gap:12px}
.metrics-strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}
.mtile{background:linear-gradient(180deg,var(--panel),#0c1118);border:1px solid var(--line-soft);border-radius:14px;padding:12px 14px}
.mtile h3{font-size:10px;text-transform:uppercase;letter-spacing:.09em;color:var(--muted);margin-bottom:7px}
.mtile .big{font-family:var(--mono);font-size:26px;font-weight:740;line-height:1}
.mtile .sub{font-size:10.5px;color:var(--soft);margin-top:4px}
.mtile .up{color:var(--green)}.mtile .down{color:var(--red)}
svg.spark{width:100%;height:26px;display:block;margin-top:6px}
.chat-card{flex:1;display:flex;flex-direction:column;overflow:hidden;background:linear-gradient(180deg,var(--panel),#0c1118);border:1px solid var(--line-soft);border-radius:16px}
.chat-head{display:flex;align-items:center;justify-content:space-between;padding:13px 16px;border-bottom:1px solid var(--line-soft)}
.chat-head .ttl{font-size:15px;font-weight:700;display:flex;align-items:center;gap:9px}
.chat-head .members{display:flex}
.mini-ava{width:24px;height:24px;border-radius:50%;border:2px solid var(--panel);margin-left:-8px;display:grid;place-items:center;font-size:9px;font-weight:800;color:#04130f}
.chat-head .meta{font-size:12px;color:var(--muted)}
.view-head{display:flex;align-items:center;justify-content:space-between;width:100%}
.view-head .vt{font-size:16px;font-weight:740;display:flex;align-items:center;gap:9px}
.view-head .vsub{font-size:12px;color:var(--muted)}
.scroller{flex:1;overflow-y:auto;padding:8px 0}
.scroller::-webkit-scrollbar{width:9px}.scroller::-webkit-scrollbar-thumb{background:#222c38;border-radius:5px;border:2px solid var(--panel)}
.loadmore{display:flex;justify-content:center;padding:10px}
.loadmore button{background:var(--panel-2);border:1px solid var(--line-soft);color:var(--muted);border-radius:999px;padding:7px 16px;font-size:12px;cursor:pointer}
.loadmore button:hover{color:var(--text);border-color:var(--line)}
.daydiv{display:flex;align-items:center;gap:12px;color:var(--soft);font-size:11px;padding:10px 20px;text-transform:uppercase;letter-spacing:.08em}
.daydiv:before,.daydiv:after{content:"";flex:1;height:1px;background:var(--line-soft)}
.grp{display:grid;grid-template-columns:44px 1fr;gap:11px;padding:5px 18px 3px}
.grp .ava{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-size:12px;font-weight:800;color:#04130f;margin-top:3px;position:relative}
.grp .ava.online:after{content:"";position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--green);border:2px solid var(--panel)}
.grp .col{min-width:0}
.grp .head{display:flex;align-items:baseline;gap:9px;margin-bottom:4px}
.grp .nm{font-size:13.5px;font-weight:700}.grp .role{font-size:10px;color:var(--soft);border:1px solid var(--line-soft);border-radius:999px;padding:1px 7px}
.grp .tm{font-family:var(--mono);font-size:10.5px;color:var(--soft)}
.bub{background:var(--panel-2);border:1px solid var(--line-soft);border-radius:5px 13px 13px 13px;padding:9px 13px;font-size:13.5px;line-height:1.5;color:#d4dde7;margin-bottom:6px;max-width:82%;width:fit-content}
.grp.self .bub{background:rgba(58,214,182,.08);border-color:rgba(58,214,182,.18)}
.bub.ask{border-left:3px solid var(--amber)}.bub.reply{border-left:3px solid var(--accent)}
.bub .quote{border-left:2px solid var(--soft);padding:3px 0 3px 9px;margin-bottom:7px;font-size:12px;color:var(--muted)}.bub .quote b{color:var(--text)}
.kind-row{display:flex;gap:7px;margin-top:7px;align-items:center}
.kpill{font-size:9.5px;border-radius:999px;padding:2px 8px;border:1px solid var(--line);color:var(--muted);font-weight:600}
.kpill.ask{color:var(--amber);border-color:rgba(244,192,106,.4)}.kpill.reply{color:var(--accent);border-color:rgba(58,214,182,.4)}
.kpill.msg{color:var(--blue);border-color:rgba(110,168,254,.4)}
.kpill.task{color:var(--purple);border-color:rgba(199,155,255,.4)}
.kpill.await{color:var(--amber);background:rgba(244,192,106,.08)}.kpill.done{color:var(--green);border-color:rgba(98,217,138,.4)}
.bub.msg{border-left:3px solid rgba(110,168,254,.45)}
.bub.task{border-left:3px solid var(--purple)}
.bub .task-chip{font-family:var(--mono);font-size:10px;color:var(--purple);border:1px solid rgba(199,155,255,.4);border-radius:999px;padding:2px 8px;cursor:pointer;background:rgba(199,155,255,.08)}
.bub .task-chip:hover{color:var(--text);border-color:var(--purple)}
.bub .bub-text{overflow-wrap:anywhere;display:block}
.bub .bub-text .md-h{font-weight:700;color:var(--text);margin:9px 0 3px;font-size:13px}
.bub .bub-text .md-sp{height:6px}
.bub .bub-text ul{margin:5px 0;padding-left:18px}
.bub .bub-text li{margin:2px 0}
.bub .bub-text code{font-family:var(--mono);font-size:12px;background:rgba(255,255,255,.06);border:1px solid var(--line-soft);border-radius:5px;padding:1px 5px}
.bub .bub-text strong{color:var(--text);font-weight:700}
.bub .collapsed{color:var(--amber);font-size:11px;margin-top:7px;background:rgba(244,192,106,.06);border:1px solid rgba(244,192,106,.22);border-radius:8px;padding:6px 10px;cursor:pointer}
.bub .collapsed:hover{background:rgba(244,192,106,.12)}
.bub .id{font-family:var(--mono);font-size:9.5px;color:var(--soft);margin-top:6px}
.bub .replies-link{margin-top:8px;font-size:11.5px;color:var(--blue);cursor:pointer;display:inline-flex;gap:5px;border:1px solid rgba(110,168,254,.3);border-radius:8px;padding:4px 9px;background:rgba(110,168,254,.06)}
.bub .replies-link:hover{border-color:var(--blue);color:var(--text)}
.chat-foot{display:flex;align-items:center;justify-content:space-between;padding:10px 16px;border-top:1px solid var(--line-soft)}
.chat-foot .count{font-family:var(--mono);font-size:11px;color:var(--soft)}
.chat-foot .actions{display:flex;gap:6px;align-items:center}
.chat-foot button{font-family:var(--mono);background:var(--panel-2);border:1px solid var(--line-soft);color:var(--muted);border-radius:7px;padding:5px 11px;font-size:12px;cursor:pointer}
.chat-foot button:hover{color:var(--text);border-color:var(--line)}
.dangerbtn{font-family:var(--mono);background:rgba(255,111,111,.08);border:1px solid rgba(255,111,111,.26);color:var(--red);border-radius:7px;padding:5px 9px;font-size:11px;cursor:pointer}
.dangerbtn:hover{background:rgba(255,111,111,.14);border-color:rgba(255,111,111,.55);color:#ff9a9a}
.readonly{font-size:11px;color:var(--soft)}
.board{display:grid;grid-auto-flow:column;grid-auto-columns:minmax(190px,1fr);gap:12px;padding:14px 16px;height:100%;align-items:start;overflow-x:auto}
.bcol{background:var(--panel-2);border:1px solid var(--line-soft);border-radius:13px;padding:11px;height:100%;display:flex;flex-direction:column;min-width:0}
.bcol .bhead{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
.bcol .bname{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);display:flex;align-items:center;gap:7px}
.bcol .bdot{width:8px;height:8px;border-radius:50%}
.bcol.todo .bdot{background:var(--soft)}.bcol.accepted .bdot{background:var(--blue)}.bcol.doing .bdot{background:var(--accent)}
.bcol.backlog .bdot{background:var(--muted)}.bcol.testing .bdot{background:var(--amber)}.bcol.review .bdot{background:var(--purple)}.bcol.blocked .bdot{background:var(--red)}.bcol.done .bdot{background:var(--green)}
.bcol .bcount{font-family:var(--mono);font-size:11px;color:var(--soft)}
.bcol .bbody{display:flex;flex-direction:column;gap:9px;overflow-y:auto}
.tcard{background:linear-gradient(180deg,#0f161e,#0c1218);border:1px solid var(--line-soft);border-radius:11px;padding:12px;cursor:pointer;transition:border-color .12s,transform .12s}
.tcard:hover{border-color:var(--line);transform:translateY(-1px)}
.tcard .tid{font-family:var(--mono);font-size:10px;color:var(--accent)}
.tcard .ttitle{font-size:13px;font-weight:600;line-height:1.35;margin-top:4px}
.tcard .trow{display:flex;align-items:center;gap:7px;margin-top:10px;flex-wrap:wrap}
.tcard .owner{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.tcard .oava{width:18px;height:18px;border-radius:6px;display:grid;place-items:center;font-size:8px;font-weight:800;color:#04130f}
.tcard .mtag{font-size:9.5px;border:1px solid var(--line-soft);border-radius:999px;padding:2px 7px;color:var(--soft)}
.tcard .flag{font-size:9.5px;border-radius:999px;padding:2px 7px;font-weight:600}
.flag.blocked{color:var(--red);background:rgba(255,111,111,.1)}.flag.review{color:var(--purple);background:rgba(199,155,255,.1)}.flag.stale{color:var(--amber);background:rgba(244,192,106,.1)}
.bempty{font-size:11px;color:var(--soft);text-align:center;padding:14px;border:1px dashed var(--line-soft);border-radius:9px}
.tlfeed{padding:6px 18px}
.tlitem{display:grid;grid-template-columns:18px 1fr;gap:12px;padding-bottom:14px;position:relative}
.tlitem:before{content:"";position:absolute;left:8px;top:16px;bottom:0;width:1px;background:var(--line-soft)}
.tlitem:last-child:before{display:none}
.tlitem .td{width:12px;height:12px;border-radius:50%;border:3px solid var(--panel);margin-top:3px;background:var(--accent)}
.tlitem .td.message{background:var(--blue)}.tlitem .td.task_event{background:var(--accent)}.tlitem .td.decision{background:var(--purple)}.tlitem .td.test_result{background:var(--green)}.tlitem .td.memory{background:var(--amber)}
.tlitem .tx{font-size:13px;color:#d4dde7;line-height:1.45}.tlitem .tx .src{font-size:10px;color:var(--soft);text-transform:uppercase;letter-spacing:.06em;margin-right:8px}
.tlitem .tts{font-family:var(--mono);font-size:10px;color:var(--soft);margin-top:3px}
.people{padding:8px 18px}
.pgroup{margin-bottom:18px}
.pgroup h4{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);margin:0 0 8px;display:flex;gap:8px;align-items:center}
.person{display:grid;grid-template-columns:34px 1fr auto;gap:11px;align-items:center;padding:10px 0;border-bottom:1px solid var(--line-soft)}
.person .pava2{width:34px;height:34px;border-radius:11px;display:grid;place-items:center;font-size:12px;font-weight:800;color:#04130f;position:relative}
.person .pava2.online:after{content:"";position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--green);border:2px solid var(--panel)}
.person .pava2.stale:after{content:"";position:absolute;right:-2px;bottom:-2px;width:10px;height:10px;border-radius:50%;background:var(--amber);border:2px solid var(--panel)}
.person .pn{font-size:13.5px;font-weight:650}.person .pm{font-size:11px;color:var(--muted);margin-top:2px}
.person .pacts{display:flex;align-items:center;gap:7px;justify-content:flex-end}
.person .ps{font-size:11px;border:1px solid var(--line);border-radius:999px;padding:3px 9px;color:var(--muted)}
.ps.working{color:var(--accent);border-color:rgba(58,214,182,.4)}.ps.blocked{color:var(--red);border-color:rgba(255,111,111,.4)}.ps.waiting_review{color:var(--purple);border-color:rgba(199,155,255,.4)}.ps.sleeping{color:var(--soft)}
.ps.muted{color:var(--soft);border-color:var(--line-soft);opacity:.8}
.attnfull{padding:10px 18px;display:grid;gap:10px}
.afrow{display:grid;grid-template-columns:96px 1fr auto;gap:14px;align-items:center;background:var(--panel-2);border:1px solid var(--line-soft);border-left:3px solid var(--line);border-radius:12px;padding:14px 16px}
.afrow.stale{border-left-color:var(--amber)}.afrow.review{border-left-color:var(--purple)}.afrow.blocked{border-left-color:var(--red)}.afrow.ack{border-left-color:var(--blue)}.afrow.conflict{border-left-color:var(--red)}
.afrow .afsev{font-size:11px;font-weight:800;letter-spacing:.07em}
.afrow.stale .afsev{color:var(--amber)}.afrow.review .afsev{color:var(--purple)}.afrow.blocked .afsev{color:var(--red)}.afrow.ack .afsev{color:var(--blue)}.afrow.conflict .afsev{color:var(--red)}
.afrow strong{font-size:14px}.afrow p{font-size:12px;color:var(--muted);margin-top:3px}
.afrow .afat{font-family:var(--mono);font-size:11px;color:var(--soft)}
.right{border-left:1px solid var(--line-soft);overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:12px}
.card{background:linear-gradient(180deg,var(--panel),#0c1118);border:1px solid var(--line-soft);border-radius:14px;padding:14px}
.card h3{font-size:11px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:11px;display:flex;justify-content:space-between}
.attn{display:flex;flex-direction:column;gap:8px}
.attn-row{display:grid;grid-template-columns:64px 1fr;gap:9px;background:var(--panel-2);border:1px solid var(--line-soft);border-left:3px solid var(--line);border-radius:10px;padding:9px 11px}
.attn-row.stale{border-left-color:var(--amber)}.attn-row.review{border-left-color:var(--purple)}.attn-row.blocked{border-left-color:var(--red)}.attn-row.ack{border-left-color:var(--blue)}.attn-row.conflict{border-left-color:var(--red)}
.attn-row .sev{font-size:9px;font-weight:800;letter-spacing:.06em}
.attn-row.stale .sev{color:var(--amber)}.attn-row.review .sev{color:var(--purple)}.attn-row.blocked .sev{color:var(--red)}.attn-row.ack .sev{color:var(--blue)}.attn-row.conflict .sev{color:var(--red)}
.attn-row strong{font-size:12px}.attn-row p{font-size:10.5px;color:var(--muted);margin-top:2px}
.heat{display:grid;gap:5px}
.heat-row{display:grid;grid-template-columns:96px 1fr;gap:8px;align-items:center}
.heat-row .tname{font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cells{display:flex;gap:3px;flex-wrap:wrap}
.cell{width:14px;height:14px;border-radius:3px;background:#1b232d}
.cell.working{background:var(--accent)}.cell.idle{background:var(--blue)}.cell.waiting_review{background:var(--purple)}.cell.blocked{background:var(--red)}.cell.sleeping{background:#3a4654}.cell.stale{background:var(--amber)}
.legend{display:flex;gap:9px;margin-top:9px;font-size:9.5px;color:var(--muted);flex-wrap:wrap}
.legend i{display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:4px;vertical-align:-1px}
.kmini{display:grid;grid-template-columns:repeat(2,1fr);gap:8px}
.klane{background:var(--panel-2);border:1px solid var(--line-soft);border-radius:9px;padding:9px}
.klane .kt{font-size:9.5px;text-transform:uppercase;letter-spacing:.07em;color:var(--muted);display:flex;justify-content:space-between;margin-bottom:6px}
.kcard{background:#0e141b;border:1px solid var(--line-soft);border-radius:6px;padding:6px;font-size:10.5px;margin-bottom:5px}
.kcard .id{font-family:var(--mono);color:var(--accent);font-size:9.5px}
.bars{display:flex;align-items:flex-end;gap:6px;height:54px}
.bar{flex:1;background:linear-gradient(180deg,var(--blue),rgba(110,168,254,.22));border-radius:4px 4px 0 0;min-height:3px}
.dec{font-size:12px;color:#c9d2dc;padding:8px 0;border-top:1px solid var(--line-soft);line-height:1.4}
.dec:first-child{border-top:0}.dec small{color:var(--soft);display:block;margin-top:2px}
.empty{color:var(--soft);font-size:12px;padding:16px;text-align:center}
.afrow,.attn-row,.kcard{cursor:pointer}
.afrow:hover,.attn-row:hover,.kcard:hover{border-color:var(--line)}
.drawer-wrap{position:fixed;inset:0;z-index:60;display:none}
.drawer-wrap.open{display:block}
.drawer-bd{position:absolute;inset:0;background:rgba(4,6,9,.55);backdrop-filter:blur(2px)}
.drawer-panel{position:absolute;top:0;right:0;height:100%;width:480px;max-width:94vw;background:var(--panel);border-left:1px solid var(--line);overflow-y:auto;box-shadow:-24px 0 70px rgba(0,0,0,.55);animation:slidein .16s ease}
@keyframes slidein{from{transform:translateX(24px);opacity:.4}to{transform:translateX(0);opacity:1}}
.dk-head{position:relative;padding:20px 22px 16px;border-bottom:1px solid var(--line-soft)}
.dk-id{font-family:var(--mono);font-size:11px;color:var(--accent)}
.dk-title{font-size:18px;font-weight:740;margin-top:6px;line-height:1.25}
.dk-close{position:absolute;top:14px;right:16px;cursor:pointer;color:var(--muted);border:1px solid var(--line);border-radius:8px;padding:4px 10px;background:var(--panel-2);font-size:12px}
.dk-close:hover{color:var(--text);border-color:var(--accent)}
.dk-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:13px}
.dk-body{padding:18px 22px 30px;display:grid;gap:20px}
.dl{display:grid;grid-template-columns:108px 1fr;gap:7px 12px;font-size:12.5px;margin:0}
.dl dt{color:var(--soft)}.dl dd{margin:0;color:var(--text);overflow-wrap:anywhere}
.dsec{font-size:11px;text-transform:uppercase;letter-spacing:.09em;color:var(--soft);margin-bottom:10px}
.dmsg{background:var(--panel-2);border:1px solid var(--line-soft);border-radius:10px;padding:10px 12px;margin-bottom:8px}
.dmsg-h{font-size:11.5px;font-weight:600;color:var(--muted)}
.dmsg-b{font-size:12.5px;color:#c9d2dc;margin-top:5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere}
@media(max-width:1180px){.shell{grid-template-columns:220px 1fr}.right{display:none}.metrics-strip{grid-template-columns:repeat(2,1fr)}}
`;
}

// Task-notification classification — single source of truth shared by the
// client renderer (its regexes are injected into CLIENT_JS from these sources)
// and by tests. A message is a task notification when it opens with a task
// verb or "task #N <state>" AND carries a `task #N` id. Detection is
// content-based (NOT thread_id), because a task's thread can hold the whole
// team conversation.
const TASK_VERB_RE = /^\s*(assigned|pending assignment|acknowledged|claimed|released|reassigned|handed off|canceled|cancelled|reopened)\b/i;
const TASK_STATE_RE = /^\s*task #\d+\s+(working|completed|blocked|in review|review|testing|done)\b/i;

export function classifyTaskMessage(content: string): { isTask: boolean; taskId: number | null } {
  const c = content ?? "";
  const isNotify = TASK_VERB_RE.test(c) || TASK_STATE_RE.test(c);
  const idm = /task #(\d+)/i.exec(c);
  return { isTask: isNotify && idm !== null, taskId: idm ? Number(idm[1]) : null };
}

function js(): string {
  return CLIENT_JS;
}

// Client script served at /app.js. Plain ES5-ish JS using string concatenation
// (no template literals) so it lives safely inside this module's template.
const CLIENT_JS = [
  "var ui={scopes:null,state:null,metrics:null,sel:{project:'*',team:null,view:'chat'},inited:false,",
  "  chat:{msgs:[],cursor:null,hasMore:false,loading:false,scope:'',expanded:{},full:{},atBottom:true}};",
  // task-notification regexes injected from the server's single source of truth (classifyTaskMessage)
  `var TASK_VERB_RE=new RegExp(${JSON.stringify(TASK_VERB_RE.source)},"i"),TASK_STATE_RE=new RegExp(${JSON.stringify(TASK_STATE_RE.source)},"i");`,
  "function api(p){return fetch(p,{cache:'no-store'}).then(function(r){return r.json();});}",
  "function postApi(p,b){return fetch(p,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b||{}),cache:'no-store'}).then(function(r){return r.json();});}",
  "function esc(v){return String(v==null?'':v).replace(/[&<>\"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c];});}",
  "function mdInline(s){s=s.replace(/\\*\\*([^*]+)\\*\\*/g,'<strong>$1</strong>');s=s.replace(/`([^`]+)`/g,'<code>$1</code>');return s;}",
  "function md(raw){var e=esc(raw);var lines=e.split('\\n');var out=[];var inList=false;for(var i=0;i<lines.length;i++){var ln=lines[i];var b=ln.match(/^\\s*[-*]\\s+(.+)$/);var h2=ln.match(/^\\s*={2,}\\s*(.+?)\\s*=*\\s*$/);var h1=ln.match(/^(#{1,6})\\s+(.+)$/);if(b){if(!inList){out.push('<ul>');inList=true;}out.push('<li>'+mdInline(b[1])+'</li>');continue;}if(inList){out.push('</ul>');inList=false;}if(h1){out.push('<div class=\"md-h\">'+mdInline(h1[2])+'</div>');continue;}if(h2){out.push('<div class=\"md-h\">'+mdInline(h2[1])+'</div>');continue;}if(ln.trim()===''){out.push('<div class=\"md-sp\"></div>');continue;}out.push('<div>'+mdInline(ln)+'</div>');}if(inList)out.push('</ul>');return out.join('');}",
  "function fmtTime(ms){return new Date(ms).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});}",
  "function ago(ms){var s=Math.max(0,Math.round((Date.now()-ms)/1000));if(s<60)return s+'s';var m=Math.round(s/60);if(m<60)return m+'m';var h=Math.round(m/60);if(h<24)return h+'h';return Math.round(h/24)+'d';}",
  "function initials(n){n=n||'?';var parts=n.split(/[-_. ]/).filter(Boolean);var a=(parts[0]||n)[0]||'?';var b=parts[1]?parts[1][0]:'';return (a+b).toUpperCase();}",
  "function hue(s){var h=0;s=s||'?';for(var i=0;i<s.length;i++){h=(h*31+s.charCodeAt(i))%360;}return h;}",
  "function ava(name){var a=null;if(ui.state&&ui.state.agents){for(var i=0;i<ui.state.agents.length;i++){if(ui.state.agents[i].name===name){a=ui.state.agents[i];break;}}}var h=hue(name);return {ini:initials(name),grad:'linear-gradient(135deg,hsl('+h+' 68% 56%),hsl('+((h+48)%360)+' 68% 56%))',role:a?(a.role||'agent'):'',online:a?a.presence==='online':false};}",
  "function spark(vals,w,hh){if(!vals||!vals.length)return '';var max=Math.max.apply(null,vals.concat([1]));var min=Math.min.apply(null,vals.concat([0]));var span=(max-min)||1;var step=w/(vals.length-1||1);var d='';for(var i=0;i<vals.length;i++){var x=i*step;var y=hh-((vals[i]-min)/span)*hh;d+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';}return d;}",
  "function projKey(p){return p===null?'__null__':p;}",
  "function projDisplay(p){return p==='*'?'all projects':p==='__null__'?'unscoped':p;}",
  // scope query for state/metrics/messages
  "function qScope(){var p=new URLSearchParams();p.set('project',ui.sel.project==='__null__'?'*':(ui.sel.project||'*'));if(ui.sel.team&&ui.sel.team!=='__null__')p.set('team',ui.sel.team);return p;}",
  "function chatKey(){return (ui.sel.project||'*')+'|'+(ui.sel.team||'');}",
  // null-bucket client filter for state (bus has no IS-NULL-only query)
  "function applyNullFilters(st){var pn=ui.sel.project==='__null__',tn=ui.sel.team==='__null__';if(!pn&&!tn)return st;var keep=function(p,t){return (!pn||p==null)&&(!tn||t==null);};st.agents=st.agents.filter(function(a){return keep(a.project,a.team);});st.tasks=st.tasks.filter(function(t){return keep(t.project,t.team);});st.activity=st.activity.filter(function(it){var o=it.message||it.event||it.decision||it.memory||it.test_result||{};return keep(o.project,o.team);});var b=st.cockpit.board;var ft=function(arr){return (arr||[]).filter(function(t){return keep(t.project,t.team);});};b.active_tasks=ft(b.active_tasks);b.open_tasks=ft(b.open_tasks);b.blocked_tasks=ft(b.blocked_tasks);b.waiting_review=ft(b.waiting_review);b.waiting_acknowledgement=ft(b.waiting_acknowledgement);b.stale_tasks=ft(b.stale_tasks);b.overdue_tasks=ft(b.overdue_tasks);b.checkin_due_tasks=ft(b.checkin_due_tasks);st.stats.online=st.agents.filter(function(a){return a.presence==='online';}).length;st.stats.working=st.agents.filter(function(a){return a.status==='working';}).length;st.stats.active_tasks=b.active_tasks.length;st.stats.attention=b.blocked_tasks.length+b.stale_tasks.length+b.overdue_tasks.length+b.checkin_due_tasks.length+b.waiting_review.length+b.waiting_acknowledgement.length+b.scope_conflicts.length;return st;}",
  // hash routing
  "function readHash(){var h=location.hash.replace(/^#/,'');if(!h)return;var q=new URLSearchParams(h);if(q.has('p'))ui.sel.project=q.get('p');ui.sel.team=q.has('t')?q.get('t'):null;if(q.has('v'))ui.sel.view=q.get('v');}",
  "function writeHash(){var q=new URLSearchParams();q.set('p',ui.sel.project||'*');if(ui.sel.team)q.set('t',ui.sel.team);q.set('v',ui.sel.view);history.replaceState(null,'','#'+q.toString());}",
  // selection
  "function setView(v){ui.sel.view=v;document.querySelectorAll('.team-row').forEach(function(x){x.classList.remove('active');});afterSel();}",
  "function pickTeam(pk,tk){ui.sel.project=pk;ui.sel.team=tk;ui.sel.view='chat';afterSel();}",
  "function afterSel(){writeHash();render();tick();}",
  "window.setView=setView;window.pickTeam=pickTeam;",
  "function activeTasksForAgent(name){return (ui.state.tasks||[]).filter(function(t){return t.claimed_by===name&&['claimed','working','blocked'].indexOf(t.state)>=0;});}",
  "function deleteMember(name){var active=activeTasksForAgent(name);var msg='Remove '+name+' from the live roster?\\n\\nHistory is preserved.'+(active.length?'\\n\\nActive tasks: '+active.map(function(t){return '#'+t.id;}).join(', '):'');if(!confirm(msg))return;postApi('/api/remove-agent',{name:name}).then(function(r){if(r.error&&r.error.code==='AGENT_HAS_ACTIVE_TASKS'){if(confirm(r.error.message+'\\n\\nRelease these tasks back to open and remove the member?'))return postApi('/api/remove-agent',{name:name,release_tasks:true});return r;}return r;}).then(function(r){if(!r)return;if(r.error){alert(r.error.code+': '+r.error.message);return;}tick();});}",
  "function deleteCurrentTeam(){if(!ui.sel.team||ui.sel.team==='__null__')return;var team=ui.sel.team;var active=(ui.state.tasks||[]).filter(function(t){return t.team===team&&['claimed','working','blocked'].indexOf(t.state)>=0;});var msg='Delete team #'+team+' from live boards?\\n\\nMembers are removed and history is preserved without the team label.'+(active.length?'\\n\\nActive tasks: '+active.map(function(t){return '#'+t.id;}).join(', '):'');if(!confirm(msg))return;postApi('/api/delete-team',{team:team,project:ui.sel.project==='__null__'?undefined:ui.sel.project}).then(function(r){if(r.error&&r.error.code==='TEAM_HAS_ACTIVE_TASKS'){if(confirm(r.error.message+'\\n\\nRelease these tasks back to open and delete the team?'))return postApi('/api/delete-team',{team:team,project:ui.sel.project==='__null__'?undefined:ui.sel.project,release_tasks:true});return r;}return r;}).then(function(r){if(!r)return;if(r.error){alert(r.error.code+': '+r.error.message);return;}ui.sel.team=null;writeHash();ui.chat.scope='';tick();});}",
  "window.deleteMember=deleteMember;window.deleteCurrentTeam=deleteCurrentTeam;",
  // main fetch loop
  "function tick(){var qs=qScope().toString();return Promise.all([api('/api/scopes'),api('/api/state?'+qs),api('/api/metrics?'+qs)]).then(function(res){var sc=res[0],st=res[1],me=res[2];if(!sc.error)ui.scopes=sc;if(!st.error)ui.state=applyNullFilters(st);if(!me.error)ui.metrics=me;var next;if(ui.chat.scope!==chatKey()){next=loadChat(true);}else if(ui.sel.view==='chat'){next=refreshLatest();}else{next=Promise.resolve();}return next;}).then(function(){render();}).catch(function(e){var b=document.getElementById('mainBody');if(b)b.innerHTML='<div class=\"empty\">Unable to read bus: '+esc(e.message||e)+'</div>';});}",
  // chat paging
  "function loadChat(reset){if(reset){ui.chat={msgs:[],cursor:null,hasMore:false,loading:false,scope:chatKey(),expanded:{},full:{},atBottom:true};}var p=qScope();p.set('limit','30');return api('/api/messages?'+p.toString()).then(function(r){if(r.error)return;ui.chat.msgs=r.messages.slice();ui.chat.cursor=r.next_cursor;ui.chat.hasMore=r.has_more;});}",
  "function expandMsg(id){if(ui.chat.expanded[id]){delete ui.chat.expanded[id];renderChat();return;}if(ui.chat.full[id]!=null){ui.chat.expanded[id]=1;renderChat();return;}api('/api/messages/'+id+'?full=1').then(function(r){if(r.error)return;var mm=r.message||{};ui.chat.full[id]=(mm.content!=null?mm.content:mm.content_preview);ui.chat.expanded[id]=1;renderChat();});}",
  "window.expandMsg=expandMsg;",
  "function loadEarlier(){if(!ui.chat.hasMore||ui.chat.loading)return;ui.chat.loading=true;var p=qScope();p.set('limit','30');if(ui.chat.cursor!=null)p.set('before',ui.chat.cursor);api('/api/messages?'+p.toString()).then(function(r){ui.chat.loading=false;if(r.error)return;ui.chat.msgs=r.messages.concat(ui.chat.msgs);ui.chat.cursor=r.next_cursor;ui.chat.hasMore=r.has_more;renderChat('earlier');});}",
  "function refreshLatest(){var p=qScope();p.set('limit','30');return api('/api/messages?'+p.toString()).then(function(r){if(r.error||!r.messages)return;var newest=ui.chat.msgs.length?ui.chat.msgs[ui.chat.msgs.length-1].id:0;var added=r.messages.filter(function(m){return m.id>newest;});if(added.length)ui.chat.msgs=ui.chat.msgs.concat(added);});}",
  "window.loadEarlier=loadEarlier;",
  // top-level render
  "function render(){if(!ui.scopes||!ui.state){return;}if(!ui.inited){initSelection();ui.inited=true;}document.getElementById('scopeText').textContent=ui.sel.team?(projDisplay(ui.sel.project)+' / #'+(ui.sel.team==='__null__'?'unteamed':ui.sel.team)):projDisplay(ui.sel.project);document.getElementById('clock').textContent=new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit',second:'2-digit'});renderKpis();renderSidebar();renderMetrics();renderMain();renderRight();}",
  "function initSelection(){if(location.hash){return;}var ps=ui.scopes.projects;if(ps&&ps.length){ui.sel.project=projKey(ps[0].project);var t=ps[0].teams&&ps[0].teams[0];ui.sel.team=t?(t.team===null?'__null__':t.team):null;ui.sel.view='chat';writeHash();}}",
  // kpis
  "function renderKpis(){var t=ui.scopes.totals;var arr=[[t.projects,'projects'],[t.teams,'teams'],[t.agents_online,'online'],[t.active_tasks,'tasks'],[t.attention,'attn',true]];document.getElementById('kpis').innerHTML=arr.map(function(k){return '<div class=\"kchip '+(k[2]?'alert':'')+'\"><span class=\"v\">'+k[0]+'</span><span class=\"l\">'+k[1]+'</span></div>';}).join('');}",
  // sidebar
  "function renderSidebar(){var st=ui.state.stats;document.getElementById('vc-attention').textContent=st.attention||'';document.getElementById('vc-kanban').textContent=(ui.state.tasks||[]).length;document.getElementById('vc-activity').textContent=(ui.state.activity||[]).length;document.getElementById('vc-people').textContent=(ui.state.agents||[]).length;document.getElementById('projCount').textContent=ui.scopes.totals.projects;",
  "  document.querySelectorAll('.viewitem').forEach(function(it){it.classList.toggle('active',!ui.sel.team&&it.dataset.view===ui.sel.view);});",
  "  document.getElementById('projects').innerHTML=ui.scopes.projects.map(function(p){var pk=projKey(p.project);var lbl=projDisplay(p.project==='*'?'*':pk);var ini=p.project===null?'~':initials(p.project);var open=(ui.sel.project===pk);var teams=p.teams.map(function(t){var tk=t.team===null?'__null__':t.team;var tn=t.team===null?'(unteamed)':'# '+t.team;var active=ui.sel.team===tk&&ui.sel.project===pk;return '<div class=\"team-row '+(active?'active':'')+'\" onclick=\"event.stopPropagation();pickTeam(\\''+esc(pk)+'\\',\\''+esc(tk)+'\\')\"><span class=\"d '+(t.online?'on':'')+'\"></span><span class=\"tn\">'+esc(tn)+'</span>'+(t.attention?'<span class=\"badge\">'+t.attention+'</span>':'<span class=\"tc\">'+(t.active_tasks?t.active_tasks+'t':t.agents_total+'a')+'</span>')+'</div>';}).join('');return '<div class=\"proj '+(open?'active open':'')+'\"><div class=\"proj-row\" onclick=\"this.parentElement.classList.toggle(\\'open\\')\"><span class=\"chev\">&#9654;</span><span class=\"pava\">'+esc(ini)+'</span><span class=\"pname\">'+esc(projDisplay(pk))+'</span>'+(p.attention?'<span class=\"badge\">'+p.attention+'</span>':'<span class=\"pmeta\">'+p.agents_online+'/'+p.agents_total+'</span>')+'</div><div class=\"teams\">'+teams+'</div></div>';}).join('');}",
  // metrics strip (real)
  "function renderMetrics(){var m=ui.metrics||{messages:[],activity:[],totals:{messages:0},deltas:{messages_pct:0},daily:{tasks_created:[]}};var st=ui.state.stats;var d=m.deltas.messages_pct;var dcls=d>0?'up':d<0?'down':'';var dtxt=(d>0?'+':'')+d+'% vs prev';",
  "  var h='';",
  "  h+='<div class=\"mtile\"><h3>Messages (24h)</h3><div class=\"big\">'+m.totals.messages+'</div><svg class=\"spark\" viewBox=\"0 0 200 24\" preserveAspectRatio=\"none\"><path d=\"'+spark(m.messages,200,22)+'\" fill=\"none\" stroke=\"#3ad6b6\" stroke-width=\"2\"/></svg><div class=\"sub '+dcls+'\">'+dtxt+'</div></div>';",
  "  h+='<div class=\"mtile\"><h3>Active tasks</h3><div class=\"big\">'+st.active_tasks+'</div><div class=\"sub\">'+st.open_tasks+' open · '+st.blocked+' blocked</div></div>';",
  "  h+='<div class=\"mtile\"><h3>Agents online</h3><div class=\"big\">'+st.online+' <span style=\"font-size:13px;color:var(--soft)\">/'+ui.state.agents.length+'</span></div><svg class=\"spark\" viewBox=\"0 0 200 24\" preserveAspectRatio=\"none\"><path d=\"'+spark(m.activity,200,22)+'\" fill=\"none\" stroke=\"#6ea8fe\" stroke-width=\"2\"/></svg></div>';",
  "  h+='<div class=\"mtile\"><h3>Attention</h3><div class=\"big\" style=\"color:'+(st.attention?'var(--red)':'var(--text)')+'\">'+st.attention+'</div><div class=\"sub\">'+ui.state.cockpit.board.blocked_tasks.length+' blocked · '+ui.state.cockpit.board.overdue_tasks.length+' overdue · '+ui.state.cockpit.board.waiting_review.length+' review</div></div>';",
  "  document.getElementById('metrics').innerHTML=h;}",
  // main view dispatch
  "function renderMain(){var v=ui.sel.view;if(v==='chat')return renderChat();var BODY=document.getElementById('mainBody');var top=BODY.scrollTop;var bd=BODY.querySelector('.board');var left=bd?bd.scrollLeft:0;var cols={};BODY.querySelectorAll('.bcol .bbody').forEach(function(b){cols[b.parentElement.className.replace('bcol','').trim()]=b.scrollTop;});if(v==='kanban')renderKanban();else if(v==='activity')renderActivity();else if(v==='people')renderPeople();else renderAttention();BODY.scrollTop=top;var bd2=BODY.querySelector('.board');if(bd2)bd2.scrollLeft=left;BODY.querySelectorAll('.bcol .bbody').forEach(function(b){var k=b.parentElement.className.replace('bcol','').trim();if(cols[k]!=null)b.scrollTop=cols[k];});}",
  // chat (bubbles)
  "function dayLabel(ms){var d=new Date(ms),t=new Date();return d.toDateString()===t.toDateString()?'Today':d.toLocaleDateString([], {month:'short',day:'numeric'});}",
  "function renderChat(mode){var HEAD=document.getElementById('mainHead'),BODY=document.getElementById('mainBody'),FOOT=document.getElementById('mainFoot');var members={};var msgs=ui.chat.msgs;for(var i=0;i<msgs.length;i++){members[msgs[i].from_agent]=1;}var mh='';for(var k in members){mh+='<span class=\"mini-ava\" style=\"background:'+ava(k).grad+'\">'+esc(initials(k))+'</span>';}",
  "  var teamAction=(ui.sel.team&&ui.sel.team!=='__null__')?'<button class=\"dangerbtn\" onclick=\"deleteCurrentTeam()\">delete team</button>':'';",
  "  HEAD.innerHTML='<div class=\"ttl\">'+(ui.sel.team?'# '+esc(ui.sel.team==='__null__'?'unteamed':ui.sel.team):esc(projDisplay(ui.sel.project)))+' <span class=\"members\">'+mh+'</span></div><div class=\"meta\">'+teamAction+' <span>'+msgs.length+' loaded'+(ui.chat.hasMore?' · more available':'')+'</span></div>';",
  "  var prevH=BODY.scrollHeight,prevTop=BODY.scrollTop;",
  "  var answered={};for(var a=0;a<msgs.length;a++){if(msgs[a].reply_to!=null)answered[msgs[a].reply_to]=1;}",
  "  var byId={};for(var b=0;b<msgs.length;b++){byId[msgs[b].id]=msgs[b];}",
  "  var taskByThread={};(ui.state&&ui.state.tasks||[]).forEach(function(t){if(t.thread_id)taskByThread[t.thread_id]=t.id;});",
  "  var html='';if(ui.chat.hasMore)html+='<div class=\"loadmore\"><button onclick=\"loadEarlier()\">↑ Load earlier</button></div>';",
  "  if(!msgs.length)html+='<div class=\"empty\">No messages in this scope yet.</div>';",
  "  var lastDay=null,lastSender=null;",
  "  msgs.forEach(function(m){var day=dayLabel(m.created_at);if(day!==lastDay){html+='<div class=\"daydiv\">'+day+'</div>';lastDay=day;lastSender=null;}var av=ava(m.from_agent);var self=ui.state.scope&&false;var ng=m.from_agent!==lastSender;var q=(m.reply_to!=null&&byId[m.reply_to])?byId[m.reply_to]:null;",
  "    html+='<div class=\"grp\">'+(ng?'<div class=\"ava '+(av.online?'online':'')+'\" style=\"background:'+av.grad+'\">'+esc(av.ini)+'</div>':'<div></div>')+'<div class=\"col\">';",
  "    if(ng)html+='<div class=\"head\"><span class=\"nm\">'+esc(m.from_agent)+'</span><span class=\"role\">'+esc(av.role||'agent')+'</span><span class=\"tm\">'+fmtTime(m.created_at)+'</span></div>';",
  "    var tcontent=(m.content_preview||'');var tidm=/task #(\\d+)/i.exec(tcontent);var tnotify=TASK_VERB_RE.test(tcontent)||TASK_STATE_RE.test(tcontent);var isTask=(m.kind!=='ask'&&m.kind!=='reply')&&tnotify&&(tidm!=null||taskByThread[m.thread_id]!=null);var taskId=tidm?Number(tidm[1]):taskByThread[m.thread_id];var kc=m.kind==='ask'?'ask':m.kind==='reply'?'reply':(isTask?'task':'msg');html+='<div class=\"bub '+kc+'\">';",
  "    if(q)html+='<div class=\"quote\">↩ replying to <b>'+esc(q.from_agent)+'</b>: '+esc(q.content_preview.slice(0,64))+'…</div>';",
  "    var expanded=ui.chat.expanded[m.id];html+='<div class=\"bub-text\">'+md(expanded&&ui.chat.full[m.id]!=null?ui.chat.full[m.id]:m.content_preview)+'</div>';",
  "    if(m.truncated)html+='<div class=\"collapsed\" onclick=\"expandMsg('+m.id+')\">'+(expanded?'⤡ Show less':'⤢ Large message · '+m.content_length+' chars · click to expand')+'</div>';",
  "    html+='<div class=\"kind-row\"><span class=\"kpill '+kc+'\">'+(m.kind==='ask'?'ask':m.kind==='reply'?'reply':(isTask?'task':'message'))+'</span>';",
  "    if(m.kind==='ask')html+='<span class=\"kpill '+(answered[m.id]?'done':'await')+'\">'+(answered[m.id]?'✓ answered':'⏳ awaiting reply')+'</span>';",
  "    else if(m.kind==='reply'&&!q)html+='<span class=\"kpill reply\">↩ in reply</span>';",
  "    if(isTask)html+='<span class=\"task-chip\" onclick=\"openTask('+taskId+')\">📋 #'+taskId+'</span>';",
  "    html+='</div>';",
  "    if(m.has_replies)html+='<div class=\"replies-link\" onclick=\"openThread('+m.id+')\">💬 '+m.replies_count+' '+(m.replies_count===1?'reply':'replies')+' · view thread</div>';",
  "    html+='<div class=\"id\">#'+m.id+' · '+esc(m.kind)+' → '+esc(m.to_agent)+'</div></div></div></div>';lastSender=m.from_agent;});",
  "  BODY.innerHTML=html;if(mode==='earlier'){BODY.scrollTop=BODY.scrollHeight-prevH+prevTop;}else if(mode==='reset'||ui.chat.atBottom!==false){BODY.scrollTop=BODY.scrollHeight;ui.chat.atBottom=true;}else{BODY.scrollTop=prevTop;}",
  "  FOOT.innerHTML='<span class=\"count\">'+msgs.length+' messages loaded'+(ui.chat.hasMore?' (paged)':'')+'</span><div class=\"actions\">'+(ui.chat.hasMore?'<button onclick=\"loadEarlier()\">↑ earlier</button>':'')+'<span class=\"readonly\">read-only</span></div>';}",
  // kanban
  "function tcard(t){var o=ava(t.claimed_by||t.pending_assignee||t.requested_by);var stale=t.stale===true;var flags='';if(t.state==='blocked')flags+='<span class=\"flag blocked\">blocked</span>';if(t.phase==='review'||(t.review_required&&t.review_state==='pending'))flags+='<span class=\"flag review\">review</span>';if(stale)flags+='<span class=\"flag stale\">stale</span>';return '<div class=\"tcard\" onclick=\"openTask('+t.id+')\"><div class=\"tid\">#'+t.id+'</div><div class=\"ttitle\">'+esc(t.title)+'</div><div class=\"trow\"><span class=\"owner\"><span class=\"oava\" style=\"background:'+o.grad+'\">'+esc(initials(t.claimed_by||t.pending_assignee||t.requested_by))+'</span>'+esc(t.claimed_by||t.pending_assignee||t.requested_by||'-')+'</span></div><div class=\"trow\"><span class=\"mtag\">'+esc(t.mode||'task')+'</span><span class=\"mtag\">'+esc(t.phase||'—')+'</span>'+(t.milestone?'<span class=\"mtag\">'+esc(t.milestone)+'</span>':'')+flags+'</div></div>';}",
  "function renderKanban(){var HEAD=document.getElementById('mainHead'),BODY=document.getElementById('mainBody'),FOOT=document.getElementById('mainFoot');var tasks=ui.state.tasks||[];var sig=(ui.sel.project||'')+'|'+(ui.sel.team||'')+'|'+tasks.map(function(t){return t.id+':'+t.state+':'+(t.phase||'')+':'+(t.milestone||'')+':'+(t.claimed_by||t.pending_assignee||t.requested_by||'');}).join(',');if(sig===ui._kanbanSig&&BODY.querySelector('.board'))return;ui._kanbanSig=sig;var lanes=[['backlog','Backlog',function(t){return t.state==='backlog';}],['todo','Todo',function(t){return t.state==='open';}],['accepted','Accepted',function(t){return t.state==='claimed';}],['doing','Doing',function(t){return t.state==='working'&&t.phase!=='testing'&&t.phase!=='review';}],['testing','Testing',function(t){return t.phase==='testing';}],['review','Review',function(t){return t.state==='working'&&t.phase==='review';}],['blocked','Blocked',function(t){return t.state==='blocked';}],['done','Done',function(t){return t.state==='completed'||t.state==='failed'||t.state==='canceled';}]];",
  "  HEAD.innerHTML='<div class=\"view-head\"><div class=\"vt\">▤ Kanban <span class=\"vsub\">· '+esc(projDisplay(ui.sel.project))+(ui.sel.team?' / #'+esc(ui.sel.team):'')+'</span></div><div class=\"vsub\">'+tasks.length+' tasks</div></div>';",
  "  BODY.innerHTML='<div class=\"board\">'+lanes.map(function(l){var cards=tasks.filter(l[2]);return '<div class=\"bcol '+l[0]+'\"><div class=\"bhead\"><span class=\"bname\"><span class=\"bdot\"></span>'+l[1]+'</span><span class=\"bcount\">'+cards.length+'</span></div><div class=\"bbody\">'+(cards.length?cards.map(tcard).join(''):'<div class=\"bempty\">—</div>')+'</div></div>';}).join('')+'</div>';",
  "  FOOT.innerHTML='<span class=\"count\">'+tasks.length+' tasks</span><span class=\"readonly\">read-only</span>';}",
  // activity
  "function renderActivity(){var HEAD=document.getElementById('mainHead'),BODY=document.getElementById('mainBody'),FOOT=document.getElementById('mainFoot');var items=(ui.state.activity||[]).slice().reverse();HEAD.innerHTML='<div class=\"view-head\"><div class=\"vt\">◴ Activity</div><div class=\"vsub\">recent first</div></div>';BODY.innerHTML='<div class=\"tlfeed\">'+(items.length?items.map(function(it){return '<div class=\"tlitem\"><div class=\"td '+esc(it.source)+'\"></div><div><div class=\"tx\"><span class=\"src\">'+esc(it.source.replace('_',' '))+'</span>'+esc(it.summary)+'</div><div class=\"tts\">'+fmtTime(it.at)+' · '+ago(it.at)+' ago</div></div></div>';}).join(''):'<div class=\"empty\">No activity yet.</div>')+'</div>';FOOT.innerHTML='<span class=\"count\">'+items.length+' events</span><span class=\"readonly\">read-only</span>';}",
  // people
  "var PORDER=['Blocked','Waiting review','Working','Idle','Stale / away','Sleeping'];",
  "function pbucket(a){if(a.presence==='paused')return 'Sleeping';if(a.presence==='stale')return a.status==='sleeping'?'Sleeping':'Stale / away';if(a.status==='blocked')return 'Blocked';if(a.status==='waiting_review')return 'Waiting review';if(a.status==='sleeping')return 'Sleeping';if(a.status==='working')return 'Working';return 'Idle';}",
  "function renderPeople(){var HEAD=document.getElementById('mainHead'),BODY=document.getElementById('mainBody'),FOOT=document.getElementById('mainFoot');var agents=ui.state.agents||[];var teamAction=(ui.sel.team&&ui.sel.team!=='__null__')?'<button class=\"dangerbtn\" onclick=\"deleteCurrentTeam()\">delete team</button>':'';HEAD.innerHTML='<div class=\"view-head\"><div class=\"vt\">◉ People <span class=\"vsub\">· '+agents.length+' agents · '+ui.state.stats.online+' online</span></div><div>'+teamAction+'</div></div>';if(!agents.length){BODY.innerHTML='<div class=\"empty\">No agents in this scope.</div>';FOOT.innerHTML='';return;}var groups={};agents.forEach(function(a){var b=pbucket(a);(groups[b]=groups[b]||[]).push(a);});BODY.innerHTML='<div class=\"people\">'+PORDER.filter(function(g){return groups[g];}).map(function(g){return '<div class=\"pgroup\"><h4>'+g+' <span style=\"color:var(--soft);font-family:var(--mono)\">'+groups[g].length+'</span></h4>'+groups[g].map(function(a){var av=ava(a.name);var caps=(a.capabilities||[]).slice(0,3).join(', ');var ring=a.presence==='online'?'online':a.presence==='stale'?'stale':'';var seen=a.age_s<60?a.age_s+'s':a.age_s<3600?Math.round(a.age_s/60)+'m':Math.round(a.age_s/3600)+'h';var stale=(a.presence==='stale'||a.presence==='paused');var bus=a.bus_version||'pre-0.30';var listen=a.listening?' · listening':'';return '<div class=\"person\"><div class=\"pava2 '+ring+'\" style=\"background:'+av.grad+'\">'+esc(initials(a.name))+'</div><div><div class=\"pn\">'+esc(a.name)+'</div><div class=\"pm\">'+esc(a.role||'agent')+' · '+esc(caps)+' · #'+esc(a.team||'none')+' · bus '+esc(bus)+listen+' · seen '+seen+(a.active_task_id?' · task #'+a.active_task_id:'')+'</div></div><div class=\"pacts\"><span class=\"ps '+(stale?'muted':esc(a.status))+'\" title=\"last reported: '+esc(a.status)+'\">'+esc(a.status)+(stale?' · stale':'')+'</span><button class=\"dangerbtn\" onclick=\"deleteMember(\\''+esc(a.name)+'\\')\">remove</button></div></div>';}).join('')+'</div>';}).join('')+'</div>';FOOT.innerHTML='<span class=\"count\">'+agents.length+' agents</span><span class=\"readonly\">presence + cleanup</span>';}",
  // attention
  "function attnRows(b){var rows=[];b.blocked_tasks.forEach(function(t){rows.push({sev:'blocked',label:'BLOCKED',id:t.id,title:t.title,note:t.blocked_reason||'no reason recorded',at:t.updated_at});});(b.overdue_tasks||[]).forEach(function(t){rows.push({sev:'blocked',label:'OVERDUE',id:t.id,title:t.title,note:'deadline passed',at:t.deadline_at||t.updated_at});});(b.checkin_due_tasks||[]).forEach(function(t){rows.push({sev:'ack',label:'CHECK-IN',id:t.id,title:t.title,note:'check-in due from '+(t.claimed_by||t.pending_assignee||'?'),at:t.checkin_at||t.updated_at});});b.stale_tasks.forEach(function(t){rows.push({sev:'stale',label:'STALE',id:t.id,title:t.title,note:'holder '+(t.claimed_by||'?')+' went quiet',at:t.updated_at});});b.waiting_review.forEach(function(t){rows.push({sev:'review',label:'REVIEW',id:t.id,title:t.title,note:'needs a verifier to approve',at:t.updated_at});});b.waiting_acknowledgement.forEach(function(t){rows.push({sev:'ack',label:'ACK',id:t.id,title:t.title,note:'assigned to '+(t.pending_assignee||t.claimed_by||'?')+', not acknowledged',at:t.updated_at});});b.scope_conflicts.forEach(function(c){rows.push({sev:'conflict',label:'CONFLICT',id:c.task_id,title:c.title,note:'edit scope overlaps '+c.conflicts.map(function(x){return '#'+x.task_id;}).join(', '),at:0});});return rows;}",
  "function renderAttention(){var HEAD=document.getElementById('mainHead'),BODY=document.getElementById('mainBody'),FOOT=document.getElementById('mainFoot');var rows=attnRows(ui.state.cockpit.board);HEAD.innerHTML='<div class=\"view-head\"><div class=\"vt\">⚡ Attention <span class=\"vsub\">· what needs a human next</span></div><div class=\"vsub\" style=\"color:'+(rows.length?'var(--red)':'var(--soft)')+'\">'+rows.length+' items</div></div>';BODY.innerHTML='<div class=\"attnfull\">'+(rows.length?rows.map(function(r){return '<div class=\"afrow '+r.sev+'\" onclick=\"openTask('+r.id+')\"><div class=\"afsev\">'+r.label+'</div><div><strong>#'+r.id+' '+esc(r.title)+'</strong><p>'+esc(r.note)+'</p></div><div class=\"afat\">'+(r.at?ago(r.at):'')+'</div></div>';}).join(''):'<div class=\"empty\">Nothing needs attention in this scope. ✨</div>')+'</div>';FOOT.innerHTML='<span class=\"count\">'+rows.length+' attention items</span><span class=\"readonly\">read-only</span>';}",
  // right rail
  "function renderRight(){var m=ui.metrics||{daily:{tasks_created:[]},messages:[]};var b=ui.state.cockpit.board;var st=ui.state.stats;var h='';",
  "  var rows=attnRows(b).slice(0,4);h+='<div class=\"card\"><h3>Attention <span style=\"color:'+(st.attention?'var(--red)':'var(--soft)')+'\">'+st.attention+'</span></h3><div class=\"attn\">'+(rows.length?rows.map(function(r){return '<div class=\"attn-row '+r.sev+'\" onclick=\"openTask('+r.id+')\"><div class=\"sev\">'+r.label+'</div><div><strong>#'+r.id+'</strong><p>'+esc(r.note.slice(0,42))+'</p></div></div>';}).join(''):'<div class=\"empty\">clear ✨</div>')+'</div></div>';",
  // roster heatmap
  "  var teams={};(ui.state.agents||[]).forEach(function(a){var k='#'+(a.team||'none');(teams[k]=teams[k]||[]).push(a);});var hk='';for(var tn in teams){hk+='<div class=\"heat-row\"><div class=\"tname\">'+esc(tn)+'</div><div class=\"cells\">'+teams[tn].map(function(a){return '<div class=\"cell '+(a.presence==='stale'?'stale':a.status)+'\" title=\"'+esc(a.name)+'\"></div>';}).join('')+'</div></div>';}h+='<div class=\"card\"><h3>Roster · agent × status</h3><div class=\"heat\">'+(hk||'<div class=\"empty\">no agents</div>')+'</div><div class=\"legend\"><span><i style=\"background:var(--accent)\"></i>work</span><span><i style=\"background:var(--blue)\"></i>idle</span><span><i style=\"background:var(--purple)\"></i>review</span><span><i style=\"background:var(--red)\"></i>blocked</span><span><i style=\"background:var(--amber)\"></i>stale</span></div></div>';",
  // mini kanban
  "  var tasks=ui.state.tasks||[];var ml=[['Backlog',['backlog']],['Todo',['open']],['Doing',['claimed','working']],['Blocked',['blocked']],['Done',['completed','failed','canceled']]];h+='<div class=\"card\"><h3>Kanban</h3><div class=\"kmini\">'+ml.map(function(l){var cs=tasks.filter(function(t){return l[1].indexOf(t.state)>=0;});return '<div class=\"klane\"><div class=\"kt\"><span>'+l[0]+'</span><span>'+cs.length+'</span></div>'+(cs.length?cs.slice(0,4).map(function(c){return '<div class=\"kcard\" onclick=\"openTask('+c.id+')\"><span class=\"id\">#'+c.id+'</span> '+esc(c.title.slice(0,22))+'</div>';}).join(''):'<div style=\"font-size:9.5px;color:var(--soft)\">—</div>')+'</div>';}).join('')+'</div></div>';",
  // throughput
  "  var daily=(m.daily&&m.daily.tasks_created)||[];var mx=Math.max.apply(null,daily.concat([1]));h+='<div class=\"card\"><h3>Throughput · tasks/day ('+(m.daily?m.daily.days:0)+'d)</h3><div class=\"bars\">'+(daily.length?daily.map(function(v){return '<div class=\"bar\" style=\"height:'+(v/mx*100).toFixed(0)+'%\"></div>';}).join(''):'<div class=\"empty\">no tasks</div>')+'</div></div>';",
  // decisions + memory
  "  var decs=ui.state.decisions||[];var mems=ui.state.memories||[];h+='<div class=\"card\"><h3>Decisions</h3>'+(decs.length?decs.slice(0,4).map(function(d){return '<div class=\"dec\">'+esc(d.decision)+'<small>'+esc(d.by_agent||'')+(d.implemented?' · implemented':'')+'</small></div>';}).join(''):'<div class=\"empty\">none</div>')+'</div>';",
  "  if(mems.length)h+='<div class=\"card\"><h3>Pinned memory</h3>'+mems.slice(0,4).map(function(mm){return '<div class=\"dec\">['+esc(mm.kind)+'] '+esc(mm.content.slice(0,80))+'</div>';}).join('')+'</div>';",
  "  document.getElementById('right').innerHTML=h;}",
  // view item clicks + boot
  "function closeDrawer(){document.getElementById('drawer').classList.remove('open');}window.closeDrawer=closeDrawer;",
  "function openTask(id){var d=document.getElementById('drawer');d.classList.add('open');d.innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\"><div class=\"empty\">Loading task #'+id+'…</div></div>';api('/api/tasks/'+id).then(function(r){if(r.error){d.innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\"><div class=\"empty\">'+esc(r.error.message||'not found')+'</div></div>';return;}renderTaskDetail(r);});}window.openTask=openTask;",
  "function renderTaskDetail(d){var t=d.task;var owner=t.claimed_by||t.pending_assignee||t.requested_by;var ev=(d.events||[]).slice().reverse();var tr=d.test_results||[];var th=(d.messages||[]).slice(-12);var H='';",
  "  H+='<div class=\"dk-head\"><span class=\"dk-close\" onclick=\"closeDrawer()\">✕ close</span><span class=\"dk-id\">#'+t.id+' · '+esc(t.state)+'</span><div class=\"dk-title\">'+esc(t.title)+'</div><div class=\"dk-meta\"><span class=\"mtag\">'+esc(t.mode||'task')+'</span><span class=\"mtag\">phase: '+esc(t.phase||'—')+'</span>'+(t.milestone?'<span class=\"mtag\">milestone: '+esc(t.milestone)+'</span>':'')+(t.review_required?'<span class=\"kpill review\">review: '+esc(t.review_state)+'</span>':'')+(t.stale?'<span class=\"kpill\" style=\"color:var(--amber);border-color:rgba(244,192,106,.4)\">stale</span>':'')+'</div></div><div class=\"dk-body\">';",
  "  H+='<dl class=\"dl\"><dt>owner</dt><dd>'+esc(owner||'-')+'</dd><dt>requested by</dt><dd>'+esc(t.requested_by)+'</dd><dt>project</dt><dd>'+esc(t.project||'—')+'</dd><dt>team</dt><dd>#'+esc(t.team||'none')+'</dd><dt>ack</dt><dd>'+(t.ack_required?(t.acknowledged_at?'acknowledged'+(t.acknowledged_by?' by '+esc(t.acknowledged_by):''):'pending'):'not required')+'</dd><dt>review</dt><dd>'+(t.review_required?esc(t.review_state)+(t.reviewed_by?' by '+esc(t.reviewed_by):''):'not required')+'</dd><dt>edit scope</dt><dd>'+esc((t.edit_scope||[]).join(', ')||'—')+'</dd><dt>updated</dt><dd>'+ago(t.updated_at)+' ago</dd></dl>';",
  "  if(t.description)H+='<div><div class=\"dsec\">Description</div><div class=\"dec\">'+esc(t.description)+'</div></div>';",
  "  if(t.result)H+='<div><div class=\"dsec\">Result</div><div class=\"dec\">'+esc(t.result)+'</div></div>';",
  "  H+='<div><div class=\"dsec\">Events ('+ev.length+')</div>'+(ev.length?'<div class=\"tlfeed\" style=\"padding:0\">'+ev.map(function(e){return '<div class=\"tlitem\"><div class=\"td task_event\"></div><div><div class=\"tx\">'+esc(e.by_agent)+' · '+esc(e.event_type)+(e.phase?' → '+esc(e.phase):'')+'</div><div class=\"tx\" style=\"color:var(--muted)\">'+esc(e.message)+'</div><div class=\"tts\">'+fmtTime(e.created_at)+'</div></div></div>';}).join('')+'</div>':'<div class=\"empty\">no events</div>')+'</div>';",
  "  if(tr.length)H+='<div><div class=\"dsec\">Test results</div>'+tr.map(function(r){return '<div class=\"dec\"><span style=\"color:'+(r.status==='passed'?'var(--green)':r.status==='failed'?'var(--red)':'var(--soft)')+'\">['+esc(r.status)+']</span> '+esc(r.command)+(r.output_summary?' — '+esc(r.output_summary):'')+'</div>';}).join('')+'</div>';",
  "  H+='<div><div class=\"dsec\">Thread ('+(d.messages||[]).length+')</div>'+(th.length?th.map(function(m){return '<div class=\"dmsg\"><div class=\"dmsg-h\">'+esc(m.from_agent)+' → '+esc(m.to_agent)+' · '+esc(m.kind)+'</div><div class=\"dmsg-b\">'+esc((m.content||'').slice(0,800))+'</div></div>';}).join(''):'<div class=\"empty\">no thread</div>')+'</div>';",
  "  H+='</div>';document.getElementById('drawer').innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\">'+H+'</div>';}",
  "function openThread(rootId){var d=document.getElementById('drawer');d.classList.add('open');d.innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\"><div class=\"empty\">Loading thread…</div></div>';api('/api/thread?root='+rootId).then(function(r){if(r.error){d.innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\"><div class=\"empty\">'+esc(r.error.message||'not found')+'</div></div>';return;}renderThreadDrawer(r);});}window.openThread=openThread;",
  "function threadMsgHtml(m,isRoot){var av=ava(m.from_agent);return '<div class=\"grp\"><div class=\"ava '+(av.online?'online':'')+'\" style=\"background:'+av.grad+'\">'+esc(av.ini)+'</div><div class=\"col\"><div class=\"head\"><span class=\"nm\">'+esc(m.from_agent)+'</span><span class=\"role\">'+esc(m.kind)+'</span><span class=\"tm\">'+fmtTime(m.created_at)+'</span></div><div class=\"bub '+(isRoot?'msg':'reply')+'\"><div class=\"bub-text\">'+md(m.content||'')+'</div><div class=\"id\">#'+m.id+' → '+esc(m.to_agent)+'</div></div></div></div>';}",
  "function renderThreadDrawer(r){var root=r.root;var H='';H+='<div class=\"dk-head\"><span class=\"dk-close\" onclick=\"closeDrawer()\">✕ close</span><span class=\"dk-id\">thread · rooted at #'+root.id+'</span><div class=\"dk-title\">'+r.count+' '+(r.count===1?'reply':'replies')+'</div></div><div class=\"dk-body\">';H+='<div class=\"dsec\">Root message</div>'+threadMsgHtml(root,true);H+='<div class=\"dsec\">Replies</div>'+(r.replies.length?r.replies.map(function(m){return threadMsgHtml(m,false);}).join(''):'<div class=\"empty\">no replies yet</div>');H+='</div>';document.getElementById('drawer').innerHTML='<div class=\"drawer-bd\" onclick=\"closeDrawer()\"></div><div class=\"drawer-panel\">'+H+'</div>';}",
  "document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer();});",
  "document.querySelectorAll('.viewitem').forEach(function(it){it.onclick=function(){setView(it.dataset.view);};});",
  "window.addEventListener('hashchange',function(){readHash();render();tick();});",
  "(function(){var mb=document.getElementById('mainBody');if(mb)mb.addEventListener('scroll',function(){ui.chat.atBottom=(mb.scrollHeight-mb.scrollTop-mb.clientHeight)<80;});})();",
  "readHash();tick();setInterval(tick,3000);",
].join("\n");
