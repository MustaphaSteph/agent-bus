// Team conversation: header, message log, composer, and the client script that drives them.
import { icon } from "./icons";

export const humanChatStyles = `
  .chat-view { min-width: 0; }
  .chat-body { position: relative; flex: 1 1 auto; min-height: 0; display: flex; }
  .chat-log { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-anchor: none; padding: 12px 0 8px; overscroll-behavior: contain; }
  .chat-log:focus-visible { outline-offset: -2px; }
  .chat-state { display: grid; justify-items: start; gap: 8px; max-width: 460px; margin: 12vh auto 0; padding: 0 24px; color: var(--text-2); }
  .chat-state h2 { font-size: 17px; color: var(--text); }
  .chat-state p { margin: 0; color: var(--muted); font-size: 14px; line-height: 1.55; }
  .skeleton-row { display: grid; grid-template-columns: 36px 1fr; gap: 10px; padding: 10px 20px; }
  .skeleton-row span { display: block; background: var(--surface-2); border-radius: 6px; height: 12px; animation: pulse 1.4s ease-in-out infinite; }
  .skeleton-row span:first-child { width: 36px; height: 36px; border-radius: 50%; }
  .skeleton-row div { display: grid; gap: 8px; align-content: start; padding-top: 3px; }
  @keyframes pulse { 50% { opacity: .45; } }
  @media (prefers-reduced-motion: reduce) { .skeleton-row span { animation: none; } }

  .day-divider { display: flex; align-items: center; gap: 12px; margin: 14px 20px 6px; color: var(--muted); font-size: 12px; font-weight: 600; }
  .day-divider::before, .day-divider::after { content: ""; flex: 1; height: 1px; background: var(--line); }

  .msg { position: relative; display: grid; grid-template-columns: 36px minmax(0, 1fr); column-gap: 10px; padding: 6px 20px; scroll-margin: 24px; }
  .msg.continued { padding-top: 2px; }
  .msg:hover, .msg:focus-within { background: var(--row-hover); }
  .msg.flash { animation: flash 1.6s ease-out; }
  @keyframes flash { from { background: var(--cyan-soft); } }
  .msg-gutter { padding-top: 2px; }
  .msg-gutter time { display: block; opacity: 0; font-size: 11px; color: var(--muted); text-align: right; padding-top: 3px; white-space: nowrap; }
  .msg.continued:hover .msg-gutter time, .msg.continued:focus-within .msg-gutter time { opacity: 1; }
  .msg-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 8px; min-width: 0; }
  .msg-author { color: var(--text); font-weight: 700; font-size: 14.5px; overflow-wrap: anywhere; }
  .msg-head time { color: var(--muted); font-size: 12px; }
  .msg-replyref { display: inline-flex; gap: 6px; align-items: center; max-width: 100%; margin: 2px 0 2px; padding: 2px 8px 2px 6px; border-left: 2px solid var(--line-strong); color: var(--muted); font-size: 12.5px; text-decoration: none; border-radius: 0 6px 6px 0; }
  .msg-replyref:hover { color: var(--text-2); background: var(--surface-2); border-left-color: var(--cyan); }
  .msg-replyref span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .msg-body { color: var(--text-2); font-size: 14.5px; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .msg-body.clamped { max-height: calc(1.55em * 12); overflow: hidden; -webkit-mask-image: linear-gradient(#000 70%, transparent); mask-image: linear-gradient(#000 70%, transparent); }
  .mention { color: var(--cyan); background: var(--cyan-soft); border-radius: 4px; padding: 0 2px; font-weight: 600; }
  .mention.you { color: var(--on-accent); background: var(--accent-fill); }
  .msg-more { margin-top: 4px; padding: 2px 0; border: 0; background: none; color: var(--cyan); font-size: 13px; font-weight: 600; cursor: pointer; }
  .msg-more:hover { text-decoration: underline; }
  .msg-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 10px; margin-top: 3px; color: var(--muted); font-size: 12px; }
  .delivery { display: inline-flex; align-items: center; gap: 5px; }
  .delivery::before { content: ""; width: 7px; height: 7px; border-radius: 50%; border: 1.5px solid currentColor; }
  .delivery.queued { color: var(--amber); }
  .delivery.partial::before { background: linear-gradient(90deg, currentColor 50%, transparent 50%); }
  .delivery.delivered::before, .delivery.replied::before { background: currentColor; }
  .delivery.replied { color: var(--green); }
  .msg-actions { position: absolute; top: 2px; right: 14px; display: flex; gap: 2px; padding: 2px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); box-shadow: 0 6px 16px var(--shadow); opacity: 0; transition: opacity .12s; }
  .msg:hover .msg-actions, .msg:focus-within .msg-actions { opacity: 1; }
  .msg-actions button { display: inline-flex; align-items: center; gap: 6px; height: 28px; padding: 0 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); font-size: 12.5px; font-weight: 600; cursor: pointer; }
  .msg-actions button:hover { background: var(--hover); color: var(--text); }
  @media (hover: none) {
    .msg-actions { position: static; grid-column: 2; justify-self: start; margin: 0 0 -4px -8px; padding: 0; border: 0; opacity: 1; pointer-events: auto; box-shadow: none; background: transparent; }
    .msg-actions button { height: 32px; color: var(--muted); font-weight: 600; }
  }
  .jump { position: absolute; left: 50%; bottom: 10px; transform: translateX(-50%); display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border: 1px solid var(--focus-line); border-radius: 999px; background: var(--jump-bg); color: var(--cyan); font-size: 13px; font-weight: 700; cursor: pointer; box-shadow: 0 8px 20px var(--shadow); }

  .composer { position: relative; flex: 0 0 auto; padding: 4px 20px calc(14px + env(safe-area-inset-bottom)); }
  .composer-box { border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface); transition: border-color .12s, box-shadow .12s; }
  .composer-box:focus-within { border-color: var(--focus-line); box-shadow: 0 0 0 3px var(--focus-glow); }
  .composer textarea { display: block; width: 100%; min-height: 46px; max-height: 40vh; max-height: 40dvh; padding: 12px 14px 4px; border: 0; border-radius: 10px 10px 0 0; background: transparent; color: var(--text); font: inherit; font-size: 15px; line-height: 1.45; resize: none; box-sizing: border-box; }
  .composer textarea:focus { outline: none; }
  .composer textarea:disabled { cursor: not-allowed; }
  .composer-tools { display: flex; align-items: center; gap: 8px; padding: 4px 6px 6px; min-width: 0; }
  .audience { flex: 1 1 auto; min-width: 0; color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .send-hint { color: var(--muted); font-size: 12px; white-space: nowrap; }
  @media (hover: none), (pointer: coarse), (max-width: 860px) { .send-hint { display: none; } }
  .composer-box:has(textarea:disabled) .send-hint { display: none; }
  .send-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 14px; border: 0; border-radius: 7px; background: var(--accent-fill); color: var(--on-accent); font-weight: 750; font-size: 13.5px; cursor: pointer; }
  .send-btn:disabled { background: var(--surface-2); color: var(--muted); cursor: not-allowed; }
  .composer-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; min-height: 18px; padding: 6px 2px 0; font-size: 12.5px; color: var(--muted); }
  .composer-meta .access { color: var(--amber); font-weight: 700; }
  .composer-meta .access:empty { display: none; }
  .chat-feedback { margin: 0; flex: 1 1 240px; overflow-wrap: anywhere; line-height: 1.45; }
  .chat-feedback.error { color: var(--red); }
  .readonly-note { margin: 0 0 8px; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text-2); font-size: 13.5px; line-height: 1.5; }
  .reply-context { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 6px; padding: 6px 6px 6px 12px; border-left: 2px solid var(--cyan); border-radius: 0 8px 8px 0; background: var(--surface); font-size: 13px; color: var(--text-2); }
  .reply-context[hidden] { display: none; }
  .reply-context span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mention-options { position: absolute; left: 20px; right: 20px; bottom: calc(100% - 2px); max-width: 360px; max-height: 240px; overflow-y: auto; display: grid; gap: 2px; padding: 6px; border: 1px solid var(--line-strong); border-radius: 10px; background: var(--surface); box-shadow: 0 12px 32px var(--shadow); z-index: 5; }
  .mention-options[hidden] { display: none; }
  .mention-options button { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 40px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); text-align: left; cursor: pointer; }
  .mention-options button[aria-selected="true"], .mention-options button:hover { background: var(--hover); }
  .mention-options button[aria-selected="true"] { box-shadow: inset 2px 0 0 var(--cyan); }
  .mention-options .opt-name { flex: 1; min-width: 0; font-weight: 600; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 860px) {
    .msg { padding-left: 14px; padding-right: 14px; }
    .day-divider { margin-left: 14px; margin-right: 14px; }
    .composer { padding-left: 10px; padding-right: 10px; }
    .composer textarea { font-size: 16px; }
    .mention-options { left: 10px; right: 10px; max-width: none; }
  }
`;

export const humanChatMarkup = `
  <section class="view chat-view human-chat" data-view-panel="chat" aria-labelledby="chat-title">
    <header class="view-head">
      <button class="icon-btn nav-open" id="nav-toggle" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon("menu", 20)}</button>
      <div class="view-title">
        <h1 id="chat-title" tabindex="-1"><span class="hash" aria-hidden="true">#</span><span id="chat-title-text">Conversation</span></h1>
        <p id="chat-scope-label" class="view-sub"></p>
      </div>
      <div class="head-actions">
        <button id="refresh-chat" class="icon-btn" type="button" aria-label="Refresh conversation" title="Refresh">${icon("refresh")}</button>
        <button id="details-toggle" class="chip-btn" type="button" aria-controls="details" aria-expanded="false" title="Conversation details">${icon("users", 16)}<span id="member-count">0</span><span class="sr-only"> agents · show details</span></button>
      </div>
    </header>
    <div class="chat-body">
      <div id="team-chat" class="chat-log" role="log" aria-label="Team messages" aria-live="off" tabindex="0"></div>
      <button id="jump-latest" class="jump" type="button" hidden>${icon("arrowDown", 14)} New messages</button>
    </div>
    <form id="human-chat-form" class="composer" novalidate>
      <p id="chat-readonly" class="readonly-note" hidden>You have view-only access to this workspace. Ask a workspace owner for a member role to send messages.</p>
      <div id="chat-reply-context" class="reply-context" hidden><span id="chat-reply-label"></span><button id="chat-cancel-reply" class="icon-btn small" type="button" aria-label="Cancel reply">${icon("x", 16)}</button></div>
      <div id="chat-mentions" class="mention-options" role="listbox" aria-label="Agents to mention" hidden></div>
      <div class="composer-box">
        <label for="chat-content" class="sr-only" id="chat-content-label">Message</label>
        <textarea id="chat-content" rows="1" placeholder="Message your team, or @mention an agent" maxlength="12000" aria-controls="chat-mentions" aria-expanded="false" aria-autocomplete="list" aria-describedby="chat-audience"></textarea>
        <div class="composer-tools">
          <button id="chat-mention-button" class="icon-btn" type="button" title="Mention an agent" aria-label="Mention an agent">${icon("at")}</button>
          <span id="chat-audience" class="audience"></span>
          <span class="send-hint" aria-hidden="true">Enter to send · Shift+Enter for a new line</span>
          <button id="chat-send" class="send-btn" type="submit">Send</button>
        </div>
      </div>
      <div class="composer-meta"><span id="chat-access" class="access"></span><span id="chat-identity"></span><p id="chat-feedback" class="chat-feedback" role="status" aria-live="polite"></p></div>
    </form>
  </section>`;

export const humanChatScript = String.raw`
  const chat = { workspace: "", scope: null, groups: [], members: [], messages: [], human: null, canPost: false, loaded: false, failed: false,
    reply: null, sending: false, refreshing: false, request: null, refreshId: 0, controller: null, fullMessages: new Map(), expanded: new Set(),
    mentionStart: -1, mentionEnd: -1, options: [], selected: 0, renderedCount: 0, renderedScope: "" };
  const chatContent = document.getElementById("chat-content");
  const chatLog = document.getElementById("team-chat");
  const mentionList = document.getElementById("chat-mentions");
  const jumpLatest = document.getElementById("jump-latest");
  const MENTION_RE = /(?:^|[\s(])@([a-zA-Z0-9_.-]+)(?=$|[\s,!?;:)])/g;
  function scopeKey(scope) { return scope ? JSON.stringify([scope.project, scope.area, scope.team]) : ""; }
  function scopeLabel(scope) { return scope ? [scope.project, scope.area].filter(Boolean).join(" · ") : ""; }
  function chatFeedback(message, error = false) {
    const el = document.getElementById("chat-feedback");
    el.textContent = message; el.classList.toggle("error", error);
  }
  function autosizeComposer() {
    chatContent.style.height = "auto";
    chatContent.style.height = Math.min(chatContent.scrollHeight + 2, Math.round(innerHeight * 0.4)) + "px";
  }
  function updateComposer() {
    const disabled = !chat.canPost || !chat.scope || chat.sending;
    chatContent.disabled = disabled;
    workspaceSelect.disabled = chat.sending;
    document.getElementById("chat-send").disabled = disabled || !chatContent.value.trim();
    document.getElementById("chat-mention-button").disabled = disabled || !chat.members.length;
    document.getElementById("chat-send").textContent = chat.sending ? "Sending..." : "Send";
    const readOnly = chat.loaded && !chat.canPost;
    document.getElementById("chat-access").textContent = readOnly ? "Read-only" : "";
    document.getElementById("chat-readonly").hidden = !readOnly;
    document.getElementById("chat-identity").textContent = chat.human && chat.canPost ? "Posting as " + chat.human.name : "";
    chatContent.placeholder = !chat.scope ? "Choose a conversation" : chat.reply ? "Reply to " + (chat.reply.sender_name || chat.reply.from_agent) : "Message #" + chat.scope.team;
    document.getElementById("chat-content-label").textContent = chat.scope ? "Message #" + chat.scope.team : "Message";
    const tags = [...chatContent.value.matchAll(MENTION_RE)].map(match => match[1]);
    document.getElementById("chat-audience").textContent = tags.length ? "To " + [...new Set(tags)].map(name => "@" + name).join(", ")
      : chat.reply ? "Reply to " + (chat.reply.sender_name || chat.reply.from_agent) : chat.scope ? "To all agents in #" + chat.scope.team : "";
    autosizeComposer();
  }
  function cancelChatReply() {
    chat.reply = null; chat.request = null;
    document.getElementById("chat-reply-context").hidden = true; updateComposer();
  }
  function resetHumanChat() {
    chat.refreshId++; chat.controller?.abort(); chat.refreshing = false; chat.workspace = currentSlug(); chat.scope = null; chat.loaded = false; chat.failed = false;
    chat.groups = []; chat.messages = []; chat.members = []; chat.fullMessages.clear(); chat.expanded.clear(); chat.canPost = false; chatContent.value = "";
    chat.request = null; cancelChatReply(); hideMentions(); chatFeedback(""); chat.renderedCount = 0; chat.renderedScope = "";
    renderChatChrome(); renderHumanMessages();
  }
  async function refreshHumanChat(force = false) {
    const slug = currentSlug();
    if (chat.workspace !== slug) resetHumanChat();
    if (!slug) { renderChatChrome(); renderHumanMessages(); return; }
    if (chat.refreshing && !force) return;
    chat.refreshing = true;
    const requestId = ++chat.refreshId;
    chat.controller?.abort(); chat.controller = new AbortController();
    const params = new URLSearchParams();
    if (chat.scope) for (const key of ["team", "project", "area"]) params.set(key, chat.scope[key] || "");
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/chat?" + params, { signal: chat.controller.signal });
      const body = await response.json();
      if (requestId !== chat.refreshId || slug !== currentSlug()) return;
      if (!response.ok) { chat.canPost = false; updateComposer(); throw new Error(body.error?.message || "Unable to refresh chat."); }
      const result = body.result;
      const scopeChanged = scopeKey(chat.scope) !== scopeKey(result.scope);
      chat.scope = result.scope; chat.groups = result.groups; chat.members = result.members;
      chat.messages = result.messages; chat.human = result.human; chat.canPost = result.can_post; chat.loaded = true;
      if (chat.failed) { chat.failed = false; if (document.getElementById("chat-feedback").classList.contains("error")) chatFeedback(""); }
      renderChatChrome(); renderHumanMessages(); updateComposer();
      if (scopeChanged) onChatScopeChange();
    } catch (error) {
      if (error.name !== "AbortError" && requestId === chat.refreshId) {
        chat.failed = true; chatFeedback(error.message === "Failed to fetch" ? "Connection lost. Retrying automatically." : error.message, true);
        if (!chat.loaded) renderHumanMessages();
      }
    } finally {
      if (requestId === chat.refreshId) chat.refreshing = false;
    }
  }
  function renderChatChrome() {
    document.getElementById("chat-title-text").textContent = chat.scope ? chat.scope.team : chat.loaded ? "No conversations" : "Conversation";
    document.querySelector("#chat-title .hash").hidden = !chat.scope;
    document.getElementById("chat-scope-label").textContent = scopeLabel(chat.scope);
    document.getElementById("member-count").textContent = String(chat.members.length);
    document.getElementById("details-toggle").hidden = !chat.scope;
    app.classList.toggle("no-scope", !chat.scope);
    document.getElementById("human-chat-form").hidden = !chat.scope && (chat.loaded || !currentSlug());
    renderConversationList();
    renderDetails();
  }
  function renderConversationList() {
    const list = document.getElementById("conversation-list");
    const active = scopeKey(chat.scope);
    const markup = chat.groups.length ? chat.groups.map(group => {
      const key = scopeKey(group);
      const sub = scopeLabel(group);
      return '<li><button type="button" class="nav-item conv" data-chat-scope="' + escapeHtml(key) + '"' + (key === active && app.dataset.view === "chat" ? ' aria-current="true"' : '') + '>' +
        '<span class="nav-hash" aria-hidden="true">#</span><span class="nav-label">' + escapeHtml(group.team) + '</span>' +
        (sub ? '<span class="nav-sub">' + escapeHtml(sub) + '</span>' : '') + '</button></li>';
    }).join("") : '<li class="nav-empty">' + (chat.loaded ? "No teams yet. Conversations appear when agents join a team." : currentSlug() ? "Loading..." : "No workspace selected") + '</li>';
    if (list.innerHTML !== markup) list.innerHTML = markup;
  }
  function initials(name) {
    const parts = String(name || "?").replace(/^human\./, "").split(/[\s._-]+/).filter(Boolean);
    return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase();
  }
  function avatar(name, kind) {
    return '<span class="avatar ' + (kind === "human" ? "person" : "agent") + '" aria-hidden="true">' + escapeHtml(initials(name)) + '</span>';
  }
  function formatBody(text) {
    const me = chat.human?.name;
    return escapeHtml(text).replace(/(^|[\s(])@([a-zA-Z0-9_.-]+)/g, (all, pre, name) => pre + '<span class="mention' + (name === me ? ' you' : '') + '">@' + name + '</span>');
  }
  function dayLabel(ts) {
    const date = new Date(ts); const today = new Date();
    const start = d => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const diff = Math.round((start(today) - start(date)) / 86400000);
    if (diff === 0) return "Today";
    if (diff === 1) return "Yesterday";
    return date.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" });
  }
  function clock(ts) { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function deliveryState(statuses) {
    const total = statuses.length;
    const picked = statuses.filter(value => value !== "pending").length;
    if (statuses.every(value => value === "answered")) return ["replied", "Replied", "Every recipient replied"];
    if (!picked) return ["queued", "Queued", "Waiting in agent inboxes until they check in"];
    if (picked < total) return ["partial", "Received " + picked + "/" + total, picked + " of " + total + " agents have picked this up"];
    return ["delivered", "Received", "Every recipient has picked this up"];
  }
  function audienceLabel(targets) {
    const names = [...new Set(targets)].map(name => name === chat.human?.id ? "you" : name.startsWith("human.") ? "a person" : "@" + name);
    return "To " + (names.length > 3 ? names.slice(0, 3).join(", ") + " +" + (names.length - 3) : names.join(", "));
  }
  function groupedMessages() {
    // Team fan-out stores one delivery per agent. Display those deliveries as one post.
    const grouped = []; const byPost = new Map(); const byId = new Map();
    for (const message of chat.messages) {
      const key = message.sender_kind === "human" && message.human_post_id ? "h" + JSON.stringify([message.from_agent, message.human_post_id])
        : "a" + JSON.stringify([message.from_agent, message.thread_id, message.created_at, message.content_preview]);
      const old = byPost.get(key);
      if (old) { old.targets.push(message.to_agent); old.statuses.push(message.status); byId.set(message.id, old); }
      else { const item = { ...message, targets: [message.to_agent], statuses: [message.status] }; byPost.set(key, item); grouped.push(item); byId.set(message.id, item); }
    }
    return { grouped, byId };
  }
  function chatStateMarkup() {
    if (!currentSlug()) return '<div class="chat-state"><h2>No workspace yet</h2><p>Create a workspace to start a conversation with your agents.</p><a class="btn primary" href="#new-workspace">Create workspace</a></div>';
    if (chat.failed && !chat.loaded) return '<div class="chat-state"><h2>Couldn’t load this conversation</h2><p>Check your connection, then try again.</p><button type="button" class="btn" data-chat-retry>Try again</button></div>';
    if (!chat.loaded) return '<div aria-label="Loading conversation">' + [72, 54, 86].map(width => '<div class="skeleton-row"><span></span><div><span style="width:120px"></span><span style="width:' + width + '%"></span></div></div>').join("") + '</div>';
    if (!chat.scope) return '<div class="chat-state"><h2>No conversations yet</h2><p>A conversation appears for each team once an agent joins it. Connect an agent and register it with a team to get started.</p><a class="btn primary" href="#connect">Connect agents</a></div>';
    return '<div class="chat-state"><h2>This is the start of #' + escapeHtml(chat.scope.team) + '</h2><p>Messages without an @mention go to every agent in this team. Agents pick them up the next time they check their inbox.</p></div>';
  }
  function renderHumanMessages() {
    const nearBottom = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80;
    const oldScroll = chatLog.scrollTop;
    const scope = scopeKey(chat.scope);
    const { grouped, byId } = groupedMessages();
    let lastDay = ""; let prev = null;
    const markup = grouped.map(message => {
      const human = message.sender_kind === "human";
      const mine = message.from_agent === chat.human?.id;
      const who = mine ? "You" : message.sender_name || message.from_agent;
      const day = dayLabel(message.created_at);
      const divider = day !== lastDay ? '<div class="day-divider" role="separator"><span>' + escapeHtml(day) + '</span></div>' : "";
      const continued = !divider && prev && prev.from_agent === message.from_agent && !message.reply_to && message.created_at - prev.created_at < 300000;
      lastDay = day; prev = message;
      const full = chat.fullMessages.get(message.id);
      const text = full ?? message.content_preview ?? "";
      const long = text.length > 900 || text.split("\n").length > 12;
      const clamped = long && !chat.expanded.has(message.id);
      const parent = message.reply_to ? byId.get(message.reply_to) : null;
      const parentName = parent ? (parent.from_agent === chat.human?.id ? "You" : parent.sender_name || parent.from_agent) : "";
      const replyRef = message.reply_to ? (parent
        ? '<a class="msg-replyref" href="#msg-' + parent.id + '" data-chat-jump="' + parent.id + '">' + ICONS.reply + '<span>Replying to <strong>' + escapeHtml(parentName) + '</strong>: ' + escapeHtml(String(chat.fullMessages.get(parent.id) ?? parent.content_preview ?? "").replace(/\s+/g, " ").slice(0, 120)) + '</span></a>'
        : '<span class="msg-replyref"><span>Reply to an earlier message</span></span>') : "";
      const [stateKey, stateLabel, stateTitle] = human ? deliveryState(message.statuses) : ["", "", ""];
      const authorLabel = escapeHtml(who) + (human ? "" : ", agent");
      return divider + '<article class="msg' + (continued ? " continued" : "") + (human ? " is-human" : " is-agent") + '" id="msg-' + message.id + '" aria-label="' + authorLabel + ', ' + escapeHtml(clock(message.created_at)) + '">' +
        '<div class="msg-gutter">' + (continued ? '<time datetime="' + new Date(message.created_at).toISOString() + '">' + escapeHtml(clock(message.created_at)) + '</time>' : avatar(message.sender_name || message.from_agent, message.sender_kind)) + '</div>' +
        '<div class="msg-main">' +
          (continued ? "" : '<div class="msg-head"><strong class="msg-author">' + escapeHtml(who) + '</strong>' + (human ? "" : '<span class="badge agent">Agent</span>') +
            '<time datetime="' + new Date(message.created_at).toISOString() + '" title="' + escapeHtml(new Date(message.created_at).toLocaleString()) + '">' + escapeHtml(clock(message.created_at)) + '</time></div>') +
          replyRef +
          '<div class="msg-body' + (clamped ? " clamped" : "") + '">' + formatBody(text) + '</div>' +
          (message.truncated && full === undefined ? '<button type="button" class="msg-more" data-chat-full="' + message.id + '">Read full message</button>'
            : long ? '<button type="button" class="msg-more" data-chat-expand="' + message.id + '" aria-expanded="' + !clamped + '">' + (clamped ? "Show more" : "Show less") + '</button>' : "") +
          '<div class="msg-meta"><span>' + escapeHtml(audienceLabel(message.targets)) + '</span>' +
            (stateKey ? '<span class="delivery ' + stateKey + '" title="' + escapeHtml(stateTitle) + '">' + escapeHtml(stateLabel) + '</span>' : "") + '</div>' +
        '</div>' +
        '<div class="msg-actions"><button type="button" data-chat-reply="' + message.id + '" aria-label="Reply to ' + escapeHtml(who) + '"' + (!chat.canPost ? ' disabled' : '') + '>' + ICONS.reply + 'Reply</button></div>' +
      '</article>';
    }).join("") || chatStateMarkup();
    if (chatLog.innerHTML !== markup) {
      const active = document.activeElement;
      const restore = active && chatLog.contains(active) ? ["data-chat-reply", "data-chat-full", "data-chat-expand"].filter(name => active.hasAttribute(name)).map(name => "[" + name + '="' + active.getAttribute(name) + '"]')[0] : null;
      chatLog.innerHTML = markup;
      if (restore) chatLog.querySelector(restore)?.focus({ preventScroll: true });
    }
    const newScope = chat.renderedScope !== scope;
    if (newScope || nearBottom) { chatLog.scrollTop = chatLog.scrollHeight; jumpLatest.hidden = true; }
    else { chatLog.scrollTop = oldScroll; if (grouped.length > chat.renderedCount) jumpLatest.hidden = false; }
    chat.renderedCount = grouped.length; chat.renderedScope = scope;
  }
  function hideMentions() {
    mentionList.hidden = true; chatContent.setAttribute("aria-expanded", "false");
    chatContent.removeAttribute("aria-activedescendant"); chat.options = [];
  }
  function showMentions(force = false) {
    const before = chatContent.value.slice(0, chatContent.selectionStart);
    const match = before.match(/(?:^|\s)@([a-zA-Z0-9_.-]*)$/);
    if (!match && !force) { hideMentions(); return; }
    chat.mentionStart = match ? before.lastIndexOf("@") : chatContent.selectionStart;
    chat.mentionEnd = chatContent.selectionStart;
    const query = match ? match[1].toLowerCase() : "";
    chat.options = chat.members.filter(member => member.name.toLowerCase().includes(query));
    chat.selected = 0;
    if (!chat.options.length) { hideMentions(); return; }
    mentionList.hidden = false; chatContent.setAttribute("aria-expanded", "true"); renderMentions();
  }
  function renderMentions() {
    mentionList.innerHTML = chat.options.map((member, index) => '<button type="button" role="option" tabindex="-1" id="chat-option-' + index + '" aria-selected="' + (index === chat.selected) + '" data-mention-index="' + index + '">' +
      avatar(member.name, "agent") + '<span class="opt-name">@' + escapeHtml(member.name) + '</span>' + presenceBadge(member.presence) + '</button>').join("");
    chatContent.setAttribute("aria-activedescendant", "chat-option-" + chat.selected);
    document.getElementById("chat-option-" + chat.selected)?.scrollIntoView({ block: "nearest" });
  }
  function insertMention(index) {
    const member = chat.options[index]; if (!member) return;
    chatContent.setRangeText("@" + member.name + " ", chat.mentionStart, chat.mentionEnd, "end");
    hideMentions(); chatContent.focus(); chat.request = null; updateComposer();
  }
  function mentionAgent(name) {
    if (!chat.canPost || chat.sending) return;
    const start = chatContent.selectionStart ?? chatContent.value.length;
    const before = chatContent.value.slice(0, start);
    chatContent.setRangeText((before && !/\s$/.test(before) ? " " : "") + "@" + name + " ", start, chatContent.selectionEnd ?? start, "end");
    chat.request = null; updateComposer(); chatContent.focus();
  }
  function startReply(id) {
    if (!chat.canPost || chat.sending) return;
    chat.reply = chat.messages.find(message => message.id === id);
    if (!chat.reply) return;
    document.getElementById("chat-reply-label").textContent = "Replying to " + (chat.reply.from_agent === chat.human?.id ? "yourself" : chat.reply.sender_name || chat.reply.from_agent) + " · " + String(chat.reply.content_preview || "").replace(/\s+/g, " ").slice(0, 90);
    document.getElementById("chat-reply-context").hidden = false; chat.request = null; updateComposer(); chatContent.focus();
  }
  function sendsOnEnter() { return matchMedia("(hover: hover) and (pointer: fine)").matches; }
  document.getElementById("chat-mention-button").addEventListener("click", () => { chatContent.focus(); showMentions(true); });
  mentionList.addEventListener("mousedown", event => event.preventDefault());
  mentionList.addEventListener("click", event => {
    const button = event.target.closest("button[data-mention-index]"); if (button) insertMention(Number(button.dataset.mentionIndex));
  });
  chatContent.addEventListener("input", () => {
    chat.request = null;
    if (document.getElementById("chat-feedback").classList.contains("error")) chatFeedback("");
    updateComposer(); showMentions();
  });
  chatContent.addEventListener("blur", () => setTimeout(() => { if (document.activeElement !== chatContent) hideMentions(); }, 120));
  chatContent.addEventListener("keydown", event => {
    if (!mentionList.hidden) {
      if (event.key === "Escape") { event.preventDefault(); hideMentions(); }
      else if (["ArrowDown", "ArrowUp"].includes(event.key)) { event.preventDefault(); chat.selected = (chat.selected + (event.key === "ArrowDown" ? 1 : -1) + chat.options.length) % chat.options.length; renderMentions(); }
      else if (event.key === "Enter" || event.key === "Tab") { event.preventDefault(); insertMention(chat.selected); }
      return;
    }
    if (event.key === "Escape" && chat.reply) { event.preventDefault(); cancelChatReply(); return; }
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing && sendsOnEnter()) {
      event.preventDefault(); document.getElementById("human-chat-form").requestSubmit();
    }
  });
  document.getElementById("chat-cancel-reply").addEventListener("click", () => { cancelChatReply(); chatContent.focus(); });
  chatLog.addEventListener("scroll", () => { if (chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80) jumpLatest.hidden = true; });
  jumpLatest.addEventListener("click", () => { chatLog.scrollTop = chatLog.scrollHeight; jumpLatest.hidden = true; chatLog.focus({ preventScroll: true }); });
  chatLog.addEventListener("click", async event => {
    const reply = event.target.closest("button[data-chat-reply]");
    if (reply) startReply(Number(reply.dataset.chatReply));
    const jump = event.target.closest("[data-chat-jump]");
    if (jump) {
      event.preventDefault();
      const target = document.getElementById("msg-" + jump.dataset.chatJump);
      if (target) { target.scrollIntoView({ block: "center", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); target.classList.remove("flash"); void target.offsetWidth; target.classList.add("flash"); }
    }
    const expand = event.target.closest("button[data-chat-expand]");
    if (expand) {
      const id = Number(expand.dataset.chatExpand);
      if (chat.expanded.has(id)) chat.expanded.delete(id); else chat.expanded.add(id);
      renderHumanMessages();
    }
    if (event.target.closest("[data-chat-retry]")) refreshHumanChat(true);
    const full = event.target.closest("button[data-chat-full]");
    if (full) {
      const slug = currentSlug(); full.disabled = true; full.textContent = "Loading...";
      try {
        const result = await workspaceRpc("get_message", { message_id: Number(full.dataset.chatFull), include_content: true });
        if (slug !== currentSlug()) return;
        chat.fullMessages.set(result.message.id, result.message.content); chat.expanded.add(result.message.id); renderHumanMessages();
      } catch (error) { chatFeedback(error.message, true); if (full.isConnected) { full.disabled = false; full.textContent = "Read full message"; } }
    }
  });
  function selectConversation(key) {
    if (key === scopeKey(chat.scope)) { showView("chat"); return; }
    if (chatContent.value.trim() && !confirm("Discard this draft and switch conversations?")) return;
    chat.scope = chat.groups.find(group => scopeKey(group) === key) || null;
    chat.canPost = false; chat.loaded = false; chatContent.value = ""; chat.request = null; cancelChatReply(); hideMentions(); chatFeedback("");
    chat.renderedScope = ""; renderChatChrome(); renderHumanMessages(); showView("chat"); onChatScopeChange(); refreshHumanChat(true);
  }
  document.getElementById("conversation-list").addEventListener("click", event => {
    const item = event.target.closest("[data-chat-scope]"); if (item) selectConversation(item.dataset.chatScope);
  });
  document.getElementById("human-chat-form").addEventListener("submit", async event => {
    event.preventDefault(); if (chat.sending || !chat.canPost || !chat.scope || !chatContent.value.trim()) return;
    const slug = currentSlug();
    const payload = { ...chat.scope, content: chatContent.value.trim(), reply_to: chat.reply?.id || null };
    const fingerprint = JSON.stringify([slug, payload]);
    if (!chat.request || chat.request.fingerprint !== fingerprint) chat.request = { fingerprint, id: crypto.randomUUID() };
    chat.sending = true; hideMentions(); updateComposer(); chatFeedback("Sending...");
    try {
      const response = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/chat", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, request_id: chat.request.id }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error?.message || "Message not sent.");
      chatContent.value = ""; chat.request = null; cancelChatReply();
      const recipients = body.result.recipients;
      const waiting = recipients.filter(member => member.presence !== "listening");
      chatFeedback("Queued for " + recipients.map(member => "@" + member.name).join(", ") + (waiting.length ? ". " + waiting.length + " not currently listening." : "."));
      await refreshHumanChat(true);
      chatLog.scrollTop = chatLog.scrollHeight; jumpLatest.hidden = true;
    } catch (error) { chatFeedback((error.message === "Failed to fetch" ? "Message not sent: connection lost." : error.message) + " Your draft is preserved.", true); }
    finally { chat.sending = false; updateComposer(); if (!chatContent.disabled) chatContent.focus(); }
  });
  document.getElementById("refresh-chat").addEventListener("click", () => { refreshHumanChat(true); refreshCockpit().catch(() => {}); });
  setInterval(() => { if (!document.hidden && !chat.sending) refreshHumanChat(); }, 5000);
  addEventListener("resize", autosizeComposer);
  updateComposer();
`;
