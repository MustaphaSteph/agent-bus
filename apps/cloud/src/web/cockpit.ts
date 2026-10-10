// Tasks, activity, and the conversation details panel for the authenticated app.
import { icon } from "./icons";
import { humanChatMarkup } from "./human-chat";

const navOpen = `<button class="icon-btn nav-open" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon("menu", 20)}</button>`;

export const cockpitStyles = `
  .segmented { display: inline-flex; padding: 2px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); }
  .segmented button { height: 28px; padding: 0 10px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 13px; font-weight: 650; cursor: pointer; white-space: nowrap; }
  .segmented button[aria-pressed="true"] { background: var(--hover); color: var(--text); }
  .kanban { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(196px, 1fr); gap: 12px; overflow-x: auto; padding-bottom: 8px; scroll-snap-type: x proximity; }
  .column { display: flex; flex-direction: column; min-height: 140px; padding: 10px; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); scroll-snap-align: start; }
  .column-head { display: flex; align-items: center; justify-content: space-between; padding: 2px 4px 8px; }
  .column-head h2 { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; font-family: inherit; color: var(--text); }
  .column-head h2::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: var(--state, var(--muted)); }
  .column-count { color: var(--muted); font-size: 12px; font-weight: 700; }
  .task-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .task-card { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); }
  .task-card p { margin: 4px 0 8px; color: var(--text); font-size: 14px; line-height: 1.4; overflow-wrap: anywhere; }
  .task-top, .task-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--muted); font-size: 12px; }
  .task-id { font-variant-numeric: tabular-nums; font-weight: 700; }
  .tag { display: inline-flex; align-items: center; height: 20px; padding: 0 7px; border-radius: 999px; background: var(--surface-2); box-shadow: inset 0 0 0 1px var(--line); color: var(--text-2); font-size: 11.5px; font-weight: 600; white-space: nowrap; }
  .tag.warn { background: rgba(242,196,107,.14); color: var(--amber); }
  .column-empty { margin: 4px; color: var(--muted); font-size: 13px; }
  .state-backlog { --state: #6b7280; } .state-open { --state: var(--blue); } .state-claimed { --state: var(--violet); }
  .state-working { --state: var(--cyan); } .state-blocked { --state: var(--red); }

  .timeline { list-style: none; margin: 0; padding: 0; }
  .timeline li { display: grid; grid-template-columns: 32px minmax(0,1fr); gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
  .timeline li.empty-row { display: block; }
  .timeline .tl-icon { width: 32px; height: 32px; display: grid; place-items: center; border-radius: 8px; background: var(--surface-2); color: var(--muted); }
  .timeline .tl-head { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 13.5px; color: var(--text); }
  .timeline .tl-head span { color: var(--muted); font-size: 12px; }
  .timeline .tl-text { margin: 3px 0 0; color: var(--text-2); font-size: 13.5px; line-height: 1.5; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
  .note-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
  .note-list li { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); font-size: 13.5px; line-height: 1.5; color: var(--text-2); overflow-wrap: anywhere; }
  .note-list strong { color: var(--text); }
  .note-list .note-meta { display: block; margin-top: 4px; color: var(--muted); font-size: 12px; }

  .details-section { padding: 16px; border-bottom: 1px solid var(--line); }
  .details-section:last-child { border-bottom: 0; }
  .details-section h3 { margin: 0 0 10px; font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); font-family: inherit; }
  .section-head { display: flex; justify-content: space-between; align-items: baseline; }
  .section-head a { font-size: 12.5px; color: var(--cyan); text-decoration: none; font-weight: 600; }
  .section-head a:hover { text-decoration: underline; }
  .about { display: grid; grid-template-columns: auto 1fr; gap: 6px 14px; margin: 0; font-size: 13.5px; }
  .about dt { color: var(--muted); }
  .about dd { margin: 0; color: var(--text); overflow-wrap: anywhere; }
  .roster { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
  .roster li { display: grid; grid-template-columns: 32px minmax(0,1fr) auto; gap: 10px; align-items: center; padding: 6px 4px; border-radius: 8px; }
  .roster li:hover { background: var(--row-hover); }
  .roster .avatar { width: 32px; height: 32px; font-size: 11px; }
  .roster-name { display: block; color: var(--text); font-weight: 650; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .roster-sub { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: center; margin-top: 2px; color: var(--muted); font-size: 12px; }
  .roster .mini-btn { height: 28px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 6px; background: transparent; color: var(--text-2); font-size: 12px; font-weight: 650; cursor: pointer; }
  .roster .mini-btn:hover { background: var(--hover); color: var(--text); }
  .presence { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); font-size: 12px; white-space: nowrap; }
  .presence .dot { width: 8px; height: 8px; border-radius: 50%; border: 1.5px solid #6b7280; box-sizing: border-box; }
  .presence.p-listening { color: var(--green); } .presence.p-listening .dot { background: var(--green); border-color: var(--green); }
  .presence.p-online .dot { border-color: var(--green); }
  .presence.p-idle .dot { border-color: var(--amber); }
  .presence.p-paused .dot { border-style: dashed; }
  .legend { margin: 10px 0 0; color: var(--muted); font-size: 12px; line-height: 1.5; }
  .mini-tasks { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
  .mini-tasks li { display: grid; grid-template-columns: auto minmax(0,1fr); gap: 4px 8px; align-items: baseline; font-size: 13px; color: var(--text-2); }
  .mini-tasks .task-id { color: var(--muted); font-size: 12px; }
  .mini-tasks .mini-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mini-tasks .mini-meta { grid-column: 2; color: var(--muted); font-size: 12px; }
`;

export const cockpitMarkup = `
  ${humanChatMarkup}
  <section class="view" data-view-panel="tasks" aria-labelledby="tasks-title" hidden>
    <header class="view-head">
      ${navOpen}
      <div class="view-title"><h1 id="tasks-title" tabindex="-1">Tasks</h1><p id="tasks-scope-label" class="view-sub"></p></div>
      <div class="head-actions">
        <div class="segmented" role="group" aria-label="Which tasks to show"><button type="button" data-board-scope="team" aria-pressed="true">This team</button><button type="button" data-board-scope="all" aria-pressed="false">All teams</button></div>
        <button id="refresh-cockpit" class="icon-btn" type="button" aria-label="Refresh tasks and activity" title="Refresh">${icon("refresh")}</button>
      </div>
    </header>
    <div class="view-scroll">
      <div class="view-inner wide">
        <details id="task-form-panel" class="panel disclosure">
          <summary><span>${icon("plus", 16)} Assign work</span><span class="summary-hint">Create a tracked task for an agent</span></summary>
          <div class="form-grid">
            <label class="field">Requesting agent<input id="action-from" list="agent-names" placeholder="codex-pm" autocomplete="off"></label>
            <label class="field">Team<input id="action-team" placeholder="ios-ui" autocomplete="off"></label>
            <label class="field span-2">Task title<input id="task-title" placeholder="Design the empty state"></label>
            <label class="field span-2">Task description<textarea id="task-description" placeholder="Expected output, scope, and constraints."></textarea></label>
            <label class="field">Assign to <span class="optional">optional</span><input id="task-assignee" list="agent-names" placeholder="claude-designer" autocomplete="off"></label>
            <label class="field">State<select id="task-state"><option value="open">Open</option><option value="backlog">Backlog</option></select></label>
            <div class="form-actions span-2"><button id="create-task-action" class="btn primary" type="button">Create tracked task</button><p id="action-result" class="form-note" role="status"></p></div>
          </div>
          <datalist id="agent-names"></datalist>
        </details>
        <div id="kanban" class="kanban" aria-live="off"></div>
      </div>
    </div>
  </section>
  <section class="view" data-view-panel="activity" aria-labelledby="activity-title" hidden>
    <header class="view-head">
      ${navOpen}
      <div class="view-title"><h1 id="activity-title" tabindex="-1">Activity</h1><p id="activity-scope-label" class="view-sub"></p></div>
      <div class="head-actions"><div class="segmented" role="group" aria-label="Which activity to show"><button type="button" data-board-scope="team" aria-pressed="true">This team</button><button type="button" data-board-scope="all" aria-pressed="false">All teams</button></div></div>
    </header>
    <div class="view-scroll">
      <div class="view-inner split">
        <section aria-labelledby="recent-title"><h2 id="recent-title" class="section-title">Recent</h2><ul id="activity" class="timeline"></ul></section>
        <aside class="stack">
          <section aria-labelledby="decisions-title"><h2 id="decisions-title" class="section-title">Decisions</h2><ul id="decisions" class="note-list"></ul></section>
          <section aria-labelledby="memories-title"><h2 id="memories-title" class="section-title">Shared memory</h2><ul id="memories" class="note-list"></ul></section>
        </aside>
      </div>
    </div>
  </section>`;

export const detailsMarkup = `
  <aside id="details" class="details" aria-labelledby="details-title" tabindex="-1">
    <header class="details-head">
      <span class="sheet-grip" aria-hidden="true"></span>
      <h2 id="details-title">Details</h2>
      <button id="details-close" class="icon-btn" type="button" aria-label="Close details">${icon("x")}</button>
    </header>
    <div class="details-body">
      <section class="details-section" aria-labelledby="about-title"><h3 id="about-title">About</h3><dl id="details-about" class="about"></dl></section>
      <section class="details-section" aria-labelledby="people-title"><h3 id="people-title">People</h3><ul id="details-people" class="roster"></ul></section>
      <section class="details-section" aria-labelledby="agents-title"><h3 id="agents-title">Agents</h3><ul id="details-agents" class="roster"></ul>
        <p class="legend">Listening agents see new messages right away. Others pick them up the next time they check their inbox.</p></section>
      <section class="details-section" aria-labelledby="open-tasks-title"><div class="section-head"><h3 id="open-tasks-title">Open tasks</h3><a href="#tasks">View board</a></div><ul id="details-tasks" class="mini-tasks"></ul></section>
    </div>
  </aside>`;

export const cockpitRenderScript = String.raw`
  const board = { scope: "team", all: null, team: null, error: "", loading: false };
  const TASK_STATES = ["backlog", "open", "claimed", "working", "blocked"];
  const PRESENCE = {
    listening: ["Listening", "Sees new messages right away"],
    online: ["Online", "Active recently; reads messages on its next inbox check"],
    idle: ["Idle", "Not active for a few minutes; messages wait in its inbox"],
    offline: ["Offline", "Messages wait in its inbox until it checks in"],
    stale: ["Offline", "Messages wait in its inbox until it checks in"],
    paused: ["Paused", "Paused by a manager; messages wait in its inbox"],
  };
  function presenceBadge(presence) {
    const [label, title] = PRESENCE[presence] || [presence || "Unknown", ""];
    const key = presence === "stale" ? "offline" : presence;
    return '<span class="presence p-' + escapeHtml(key) + '" title="' + escapeHtml(title) + '"><span class="dot" aria-hidden="true"></span>' + escapeHtml(label) + '</span>';
  }
  function ago(ts) {
    const seconds = Math.round((Date.now() - Number(ts)) / 1000);
    if (seconds < 60) return "just now";
    if (seconds < 3600) return Math.floor(seconds / 60) + " min ago";
    if (seconds < 86400) return Math.floor(seconds / 3600) + " h ago";
    return new Date(Number(ts)).toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function scopeParams(scope) {
    const params = new URLSearchParams();
    if (scope) for (const key of ["team", "project", "area"]) if (scope[key]) params.set(key, scope[key]);
    return params;
  }
  async function fetchCockpit(slug, scope) {
    const res = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/cockpit?" + scopeParams(scope));
    const body = await res.json();
    if (!res.ok) throw new Error(body.error?.message || "Unable to load tasks.");
    return body.result;
  }
  async function refreshCockpit() {
    const slug = currentSlug();
    if (!slug) { board.all = board.team = null; renderCockpit(); return; }
    const scope = chat.scope;
    board.loading = true;
    try {
      const [all, team] = await Promise.all([fetchCockpit(slug, null), scope ? fetchCockpit(slug, scope) : Promise.resolve(null)]);
      if (slug !== currentSlug() || scopeKey(scope) !== scopeKey(chat.scope)) return;
      board.all = all; board.team = team; board.error = "";
    } catch (error) {
      if (slug === currentSlug()) board.error = error.message === "Failed to fetch" ? "Connection lost. Retrying automatically." : error.message;
    } finally { board.loading = false; }
    renderCockpit();
  }
  function onChatScopeChange() {
    board.team = null;
    const teamInput = document.getElementById("action-team");
    if (chat.scope && (!teamInput.value || teamInput.dataset.auto === "1")) { teamInput.value = chat.scope.team; teamInput.dataset.auto = "1"; }
    renderCockpit(); refreshCockpit();
  }
  function shownBoard() { return board.scope === "all" || !chat.scope ? board.all : board.team; }
  function taskCard(task, showTeam) {
    const holder = task.claimed_by || (task.pending_assignee ? task.pending_assignee + " (pending)" : "Unassigned");
    return '<li class="task-card"><div class="task-top"><span class="task-id">#' + task.id + '</span>' +
      (showTeam && task.team ? '<span class="tag">#' + escapeHtml(task.team) + '</span>' : '') +
      (task.review_required && task.review_state === "pending" && (task.state === "working" || task.state === "blocked") ? '<span class="tag warn">Needs review</span>' : '') + '</div>' +
      '<p>' + escapeHtml(task.title) + '</p><div class="task-meta">' + escapeHtml(holder) + (task.blocked_reason ? ' · ' + escapeHtml(task.blocked_reason) : '') + '</div></li>';
  }
  function renderCockpit() {
    const scopeText = board.scope === "all" || !chat.scope ? "All teams" : "#" + chat.scope.team + (scopeLabel(chat.scope) ? " · " + scopeLabel(chat.scope) : "");
    document.getElementById("tasks-scope-label").textContent = scopeText;
    document.getElementById("activity-scope-label").textContent = scopeText;
    document.querySelectorAll("[data-board-scope]").forEach(button => {
      button.setAttribute("aria-pressed", String(button.dataset.boardScope === (chat.scope ? board.scope : "all")));
      if (button.dataset.boardScope === "team") button.disabled = !chat.scope;
    });
    const allTasks = board.all?.board?.tasks || [];
    const count = document.getElementById("nav-task-count");
    count.textContent = allTasks.length ? String(allTasks.length) : "";
    count.setAttribute("aria-label", allTasks.length + " active tasks");
    const result = shownBoard();
    const kanban = document.getElementById("kanban");
    const activity = document.getElementById("activity");
    if (!result) {
      const message = board.error ? '<p class="inline-error" role="alert">' + escapeHtml(board.error) + '</p>' : currentSlug() ? '<p class="muted">Loading...</p>' : '<p class="muted">Create a workspace to track tasks.</p>';
      kanban.innerHTML = message; activity.innerHTML = '<li class="empty-row">' + message + '</li>';
      document.getElementById("decisions").innerHTML = ""; document.getElementById("memories").innerHTML = "";
      renderDetails(); return;
    }
    const tasks = result.board?.tasks || [];
    const showTeam = board.scope === "all" || !chat.scope;
    const states = [...TASK_STATES, ...new Set(tasks.map(task => task.state).filter(state => !TASK_STATES.includes(state)))];
    kanban.innerHTML = (board.error ? '<p class="inline-error" role="alert">' + escapeHtml(board.error) + '</p>' : '') + states.map(state => {
      const items = tasks.filter(task => task.state === state);
      const label = state.charAt(0).toUpperCase() + state.slice(1);
      return '<section class="column state-' + escapeHtml(state) + '" aria-label="' + escapeHtml(label) + ', ' + items.length + ' tasks"><div class="column-head"><h2>' + escapeHtml(label) + '</h2><span class="column-count">' + items.length + '</span></div>' +
        (items.length ? '<ul class="task-list">' + items.map(task => taskCard(task, showTeam)).join("") + '</ul>' : '<p class="column-empty">No tasks</p>') + '</section>';
    }).join("");
    activity.innerHTML = (result.activity?.activity || []).map(event => {
      const item = event.item || {};
      if (event.type === "message") {
        const from = item.sender_name || item.from_agent || "Someone";
        const to = String(item.to_agent || "");
        return '<li><span class="tl-icon">' + ICONS.message + '</span><div><div class="tl-head"><strong>' + escapeHtml(from) + '</strong><span>to ' + escapeHtml(to.startsWith("human.") ? "a person" : "@" + to) + (showTeam && item.team ? ' in #' + escapeHtml(item.team) : '') + ' · ' + escapeHtml(ago(event.at)) + '</span></div><p class="tl-text">' + escapeHtml(item.content_preview || item.content || "") + '</p></div></li>';
      }
      const what = item.event_type === "phase" ? "updated" : item.event_type || "updated";
      return '<li><span class="tl-icon">' + ICONS.tasks + '</span><div><div class="tl-head"><strong>' + escapeHtml(item.by_agent || "Workspace") + '</strong><span>' + escapeHtml(what) + (item.task_id ? ' task #' + item.task_id : '') + ' · ' + escapeHtml(ago(event.at)) + '</span></div><p class="tl-text">' + escapeHtml(item.message || item.title || "Task activity") + '</p></div></li>';
    }).join("") || '<li class="empty-row"><p class="muted">No activity yet. Messages and task updates will appear here.</p></li>';
    const decisions = result.decisions?.decisions || [];
    document.getElementById("decisions").innerHTML = decisions.slice(0, 20).map(item => '<li><strong>' + escapeHtml(item.decision) + '</strong>' + (item.rationale ? '<br>' + escapeHtml(item.rationale) : '') + '<span class="note-meta">' + escapeHtml(item.by_agent) + ' · ' + escapeHtml(ago(item.updated_at || item.created_at)) + '</span></li>').join("") || '<li class="muted">No decisions recorded.</li>';
    const memories = result.memories?.memories || [];
    document.getElementById("memories").innerHTML = memories.slice(0, 20).map(item => '<li>' + (item.pinned ? '<span class="tag">Pinned</span> ' : '') + escapeHtml(item.content) + '<span class="note-meta">' + escapeHtml(item.kind || "note") + ' · ' + escapeHtml(item.by_agent) + ' · ' + escapeHtml(ago(item.updated_at || item.created_at)) + '</span></li>').join("") || '<li class="muted">Nothing remembered yet.</li>';
    const names = [...new Set((board.all?.board?.agents || []).map(agent => agent.name))];
    document.getElementById("agent-names").innerHTML = names.map(name => '<option value="' + escapeHtml(name) + '">').join("");
    renderDetails();
  }
  function renderDetails() {
    const about = document.getElementById("details-about");
    if (!chat.scope) {
      about.innerHTML = '<dt>Team</dt><dd>None selected</dd>';
      ["details-people", "details-agents", "details-tasks"].forEach(id => { document.getElementById(id).innerHTML = ""; });
      return;
    }
    about.innerHTML = '<dt>Team</dt><dd>#' + escapeHtml(chat.scope.team) + '</dd>' + (chat.scope.project ? '<dt>Project</dt><dd>' + escapeHtml(chat.scope.project) + '</dd>' : '') + (chat.scope.area ? '<dt>Area</dt><dd>' + escapeHtml(chat.scope.area) + '</dd>' : '');
    const people = new Map();
    if (chat.human) people.set(chat.human.id, chat.human.name);
    for (const message of chat.messages) if (message.sender_kind === "human" && !people.has(message.from_agent)) people.set(message.from_agent, message.sender_name || "Workspace member");
    document.getElementById("details-people").innerHTML = [...people].map(([id, name]) => '<li>' + avatar(name, "human") + '<div><span class="roster-name">' + escapeHtml(name) + (id === chat.human?.id ? ' <span class="muted">(you)</span>' : '') + '</span><span class="roster-sub">Person' + (id === chat.human?.id && !chat.canPost && chat.loaded ? ' · Read-only' : '') + '</span></div><span></span></li>').join("");
    const rank = { listening: 0, online: 1, offline: 2, paused: 3 };
    const info = new Map((board.team?.board?.agents || []).map(agent => [agent.name, agent]));
    const members = [...chat.members].sort((a, b) => (rank[a.presence] ?? 9) - (rank[b.presence] ?? 9) || a.name.localeCompare(b.name));
    document.getElementById("details-agents").innerHTML = members.map(member => {
      const extra = info.get(member.name);
      const caps = (extra?.capabilities || []).slice(0, 2).map(cap => '<span class="tag">' + escapeHtml(cap) + '</span>').join("");
      const work = extra && ["working", "blocked", "waiting_review"].includes(extra.status) ? '<span>' + escapeHtml(extra.status.replace("_", " ")) + '</span>' : "";
      return '<li>' + avatar(member.name, "agent") + '<div><span class="roster-name">' + escapeHtml(member.name) + '</span><span class="roster-sub">' + presenceBadge(member.presence) + work + caps + '</span></div>' +
        (chat.canPost ? '<button type="button" class="mini-btn" data-mention-agent="' + escapeHtml(member.name) + '" aria-label="Mention ' + escapeHtml(member.name) + '">@</button>' : '<span></span>') + '</li>';
    }).join("") || '<li class="muted">No agents in this team yet.</li>';
    const teamTasks = board.team?.board?.tasks;
    document.getElementById("details-tasks").innerHTML = !teamTasks ? '<li class="muted">Loading...</li>' : teamTasks.slice(0, 6).map(task =>
      '<li><span class="task-id">#' + task.id + '</span><span class="mini-title">' + escapeHtml(task.title) + '</span><span class="mini-meta">' + escapeHtml(task.state) + ' · ' + escapeHtml(task.claimed_by || task.pending_assignee || "unassigned") + '</span></li>').join("") || '<li class="muted">No open tasks for this team.</li>';
  }
  document.getElementById("details-agents").addEventListener("click", event => {
    const button = event.target.closest("[data-mention-agent]"); if (!button) return;
    closeOverlays(); showView("chat"); mentionAgent(button.dataset.mentionAgent);
  });
  document.querySelectorAll("[data-board-scope]").forEach(button => button.addEventListener("click", () => {
    board.scope = button.dataset.boardScope; renderCockpit();
  }));
  setInterval(() => { if (!document.hidden && currentSlug()) refreshCockpit(); }, 20000);
`;
