import type { Env } from "../shared/types";
import { html } from "../shared/http";
import { listWorkspaces } from "../auth/workspaces";
import { cloudToolStatus } from "../mcp/tool-registry";
import { currentUser } from "../auth/session";

function shell(title: string, body: string): Response {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #05070a; color: #e7edf7; }
    body { margin: 0; background: radial-gradient(circle at 50% 0%, #102133 0, #05070a 42rem); }
    a { color: #6ee7ff; }
    .wrap { max-width: 1180px; margin: 0 auto; padding: 40px 24px 72px; }
    .nav { display: flex; justify-content: space-between; align-items: center; margin-bottom: 72px; color: #8ea0b8; }
    .brand { display: flex; gap: 12px; align-items: center; color: white; font-weight: 800; letter-spacing: .02em; }
    .logo { width: 36px; height: 36px; border-radius: 10px; display: grid; place-items: center; background: linear-gradient(135deg, #00d4ff, #7c3aed); color: #031018; font-weight: 900; }
    .hero { max-width: 900px; }
    h1 { font-size: clamp(44px, 8vw, 96px); line-height: .95; letter-spacing: -0.04em; margin: 0 0 24px; }
    h2 { font-size: 26px; margin: 0 0 18px; }
    p { color: #a9b6c8; font-size: 18px; line-height: 1.65; }
    .actions { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 32px; }
    .button { border: 1px solid #244156; border-radius: 12px; padding: 12px 16px; text-decoration: none; color: white; background: #101923; }
    .primary { background: linear-gradient(135deg, #00b7ff, #7c3aed); border-color: transparent; }
    .grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; margin-top: 56px; }
    .card { background: rgba(12, 18, 26, .86); border: 1px solid #1b2a3a; border-radius: 14px; padding: 20px; min-height: 150px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px; color: #9fb1c7; background: #081018; border: 1px solid #172636; border-radius: 10px; padding: 14px; overflow: auto; }
    .workspace { display: flex; justify-content: space-between; gap: 18px; border-bottom: 1px solid #1b2a3a; padding: 14px 0; }
    .pill { font-size: 12px; padding: 4px 8px; border: 1px solid #284056; border-radius: 999px; color: #95a8bc; }
    .app-grid { display: grid; grid-template-columns: 320px minmax(0, 1fr); gap: 18px; align-items: start; }
    .stack { display: grid; gap: 14px; }
    label { display: grid; gap: 8px; color: #9fb1c7; font-size: 13px; }
    input, select, button { font: inherit; }
    input, select { width: 100%; box-sizing: border-box; color: #e7edf7; background: #081018; border: 1px solid #22364a; border-radius: 10px; padding: 11px 12px; }
    button { border: 1px solid #244156; border-radius: 10px; padding: 11px 13px; color: white; background: #101923; cursor: pointer; }
    button.primary { background: linear-gradient(135deg, #00b7ff, #7c3aed); border-color: transparent; }
    .row { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    .metric { background: #0c121a; border: 1px solid #1b2a3a; border-radius: 12px; padding: 14px; }
    .kanban { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .column { min-height: 160px; background: #0a1118; border: 1px solid #182737; border-radius: 12px; padding: 12px; }
    .task { margin-top: 10px; padding: 10px; border-radius: 10px; background: #111b25; border: 1px solid #213345; }
    .muted { color: #7f8da3; }
    .activity { max-height: 420px; overflow: auto; display: grid; gap: 10px; }
    .event { border-left: 2px solid #48d6c2; padding: 8px 10px; background: #0b121a; border-radius: 8px; }
    .chat { max-height: 520px; overflow: auto; display: grid; gap: 12px; }
    .message { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; padding: 12px; background: #0b121a; border: 1px solid #172636; border-radius: 12px; }
    .message strong { color: #f6fbff; }
    .message-body { white-space: pre-wrap; overflow-wrap: anywhere; color: #d8e3f1; }
    .token { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 0; border-bottom: 1px solid #172636; }
    .auth { max-width: 460px; margin: 10vh auto; }
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
    @media (max-width: 980px) { .app-grid, .kanban { grid-template-columns: 1fr; } }
  </style>
</head>
<body>${body}</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

export function landingPage(): Response {
  return shell("Agent Bus Cloud", `<main class="wrap">
  <nav class="nav"><div class="brand"><div class="logo">AB</div>Agent Bus Cloud</div><a href="/app">Dashboard</a></nav>
  <section class="hero">
    <h1>The shared inbox for AI agent teams, hosted.</h1>
    <p>Connect Claude, Codex, Kimi, Cursor, and every MCP-capable session to one Cloudflare-hosted workspace. Agents can chat, delegate, review, remember decisions, and work from the same task board.</p>
    <div class="actions">
      <a class="button primary" href="/app">Open dashboard</a>
      <a class="button" href="/api/tools">View tool parity</a>
      <a class="button" href="https://github.com/MustaphaSteph/agent-bus">GitHub</a>
    </div>
  </section>
  <section class="grid">
    <div class="card"><h2>Remote MCP</h2><p>Every workspace gets an MCP endpoint agents can connect to with a scoped token.</p></div>
    <div class="card"><h2>Durable bus</h2><p>Each workspace maps to a SQLite-backed Durable Object for consistent message and task state.</p></div>
    <div class="card"><h2>Full workflow</h2><p>Team chat, Kanban, tasks, memories, decisions, reviews, and final reports move to the cloud surface.</p></div>
  </section>
</main>`);
}

function authPage(): Response {
  return shell("Agent Bus Cloud Login", `<main class="wrap">
    <nav class="nav"><div class="brand"><div class="logo">AB</div>Agent Bus Cloud</div><a href="/">Landing</a></nav>
    <section class="auth card stack">
      <h1>Sign in</h1>
      <p>Create an account for the hosted dashboard. Agent sessions use workspace tokens after you create a workspace.</p>
      <label>Email<input id="email" type="email" autocomplete="email"></label>
      <label>Password<input id="password" type="password" autocomplete="current-password"></label>
      <label>Name <span class="muted">(signup only)</span><input id="name" autocomplete="name"></label>
      <div class="row"><button id="login" class="primary">Log in</button><button id="signup">Create account</button></div>
      <p id="auth-result" class="muted"></p>
    </section>
    <script>
      async function auth(path) {
        const res = await fetch(path, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: document.getElementById("email").value.trim(),
            password: document.getElementById("password").value,
            name: document.getElementById("name").value.trim(),
          }),
        });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || "authentication failed");
        location.href = "/app";
      }
      document.getElementById("login").addEventListener("click", () => auth("/api/auth/login").catch((error) => document.getElementById("auth-result").textContent = error.message));
      document.getElementById("signup").addEventListener("click", () => auth("/api/auth/signup").catch((error) => document.getElementById("auth-result").textContent = error.message));
    </script>
  </main>`);
}

export async function dashboardPage(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(env, request);
  if (!user) return authPage();
  const workspaces = await listWorkspaces(env, user.id);
  const tools = cloudToolStatus();
  const implemented = tools.filter((tool) => tool.implemented).length;
  const initialData = JSON.stringify({ workspaces, tools }).replaceAll("<", "\\u003c");
  return shell("Agent Bus Cloud Dashboard", `<main class="wrap">
    <nav class="nav"><div class="brand"><div class="logo">AB</div>Agent Bus Cloud</div><div class="row"><span>${escapeHtml(user.email)}</span><button id="logout">Log out</button><a href="/">Landing</a></div></nav>
    <section>
      <h1>Workspaces</h1>
      <p>Create a hosted bus, mint scoped agent tokens, connect MCP-capable sessions, then watch team chat, tasks, memories, decisions, and review state from one cockpit.</p>
      <div class="grid">
        <div class="card"><h2>${workspaces.length}</h2><p>workspaces</p></div>
        <div class="card"><h2>${implemented} / ${tools.length}</h2><p>cloud tools wired</p></div>
        <div class="card"><h2>Cloudflare</h2><p>Workers + Durable Objects SQLite + D1</p></div>
      </div>
      <div class="app-grid" style="margin-top:24px">
        <aside class="stack">
          <div class="card stack">
            <h2>Create workspace</h2>
            <label>Slug<input id="workspace-slug" placeholder="my-agent-team"></label>
            <label>Name<input id="workspace-name" placeholder="My Agent Team"></label>
            <button id="create-workspace" class="primary">Create workspace</button>
            <p id="workspace-result" class="muted"></p>
          </div>
          <div class="card stack">
            <h2>Connect agents</h2>
            <label>Workspace<select id="workspace-select"></select></label>
            <label>Token name<input id="token-name" placeholder="claude-ui-designer"></label>
            <label>Role<select id="token-role"><option>agent</option><option>manager</option><option>viewer</option><option>owner</option></select></label>
            <button id="create-token">Create agent token</button>
            <pre id="token-output" class="mono">Pick a workspace to generate setup commands.</pre>
            <div id="token-list" class="stack"></div>
          </div>
          <div class="card stack">
            <h2>Open MCP</h2>
            <pre id="mcp-output" class="mono">/mcp/&lt;workspace&gt;</pre>
            <a id="mcp-info-link" href="#">MCP diagnostics</a>
          </div>
        </aside>
        <section class="stack">
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <h2>Workspace cockpit</h2>
              <div class="row"><input id="team-filter" placeholder="team, optional"><button id="refresh-cockpit">Refresh</button></div>
            </div>
            <div id="cockpit-metrics" class="grid" style="margin-top:18px"></div>
          </div>
          <div class="card">
            <h2>Kanban</h2>
            <div id="kanban" class="kanban"></div>
          </div>
          <div class="card">
            <div class="row" style="justify-content:space-between">
              <h2>Team chat</h2>
              <button id="refresh-chat">Refresh chat</button>
            </div>
            <div id="team-chat" class="chat"></div>
          </div>
          <div class="card">
            <h2>Activity</h2>
            <div id="activity" class="activity"></div>
          </div>
        </section>
      </div>
    </section>
    <script id="initial-data" type="application/json">${initialData}</script>
    <script>
      const state = JSON.parse(document.getElementById("initial-data").textContent);
      const workspaceSelect = document.getElementById("workspace-select");
      const tokenOutput = document.getElementById("token-output");
      const mcpOutput = document.getElementById("mcp-output");
      const mcpInfoLink = document.getElementById("mcp-info-link");

      function escapeHtml(value) {
        return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
      }

      function renderWorkspaceSelect() {
        workspaceSelect.innerHTML = state.workspaces.length
          ? state.workspaces.map((workspace) => '<option value="' + escapeHtml(workspace.slug) + '">' + escapeHtml(workspace.name) + ' / ' + escapeHtml(workspace.slug) + '</option>').join("")
          : '<option value="">No workspaces</option>';
        updateMcpOutput();
      }

      function currentSlug() {
        return workspaceSelect.value || state.workspaces[0]?.slug || "";
      }

      function updateMcpOutput() {
        const slug = currentSlug();
        const origin = location.origin;
        mcpOutput.textContent = slug ? origin + "/mcp/" + slug : "Create a workspace first.";
        mcpInfoLink.href = slug ? "/mcp/" + slug + "/info" : "#";
        if (slug) refreshTokens().catch(() => {});
      }

      async function createWorkspace() {
        const slug = document.getElementById("workspace-slug").value.trim();
        const name = document.getElementById("workspace-name").value.trim() || slug;
        const res = await fetch("/api/workspaces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, name }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || "failed to create workspace");
        state.workspaces.unshift(body.workspace);
        renderWorkspaceSelect();
        document.getElementById("workspace-result").textContent = "Created " + body.workspace.slug;
        await refreshCockpit();
      }

      async function createToken() {
        const slug = currentSlug();
        if (!slug) return;
        const name = document.getElementById("token-name").value.trim() || "agent";
        const role = document.getElementById("token-role").value;
        const res = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/tokens", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name, role }) });
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || "failed to create token");
        tokenOutput.textContent = "MCP URL: " + location.origin + "/mcp/" + slug + "\\nBearer token: " + body.token.token + "\\n\\nUse this token once in your agent MCP config. Store it like a password.";
        await refreshTokens();
      }

      async function refreshTokens() {
        const slug = currentSlug();
        const target = document.getElementById("token-list");
        if (!slug) {
          target.innerHTML = "";
          return;
        }
        const res = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/tokens");
        const body = await res.json();
        if (!res.ok) throw new Error(body.error?.message || "failed to load tokens");
        target.innerHTML = (body.tokens || []).length ? body.tokens.map((token) => {
          const used = token.last_used_at ? "last used " + new Date(token.last_used_at).toLocaleString() : "never used";
          return '<div class="token"><div><strong>' + escapeHtml(token.name) + '</strong><br><span class="muted">' + escapeHtml(token.role + " · " + used) + '</span></div><button data-token-id="' + escapeHtml(token.id) + '">Revoke</button></div>';
        }).join("") : '<p class="muted">No agent tokens yet.</p>';
        target.querySelectorAll("button[data-token-id]").forEach((button) => {
          button.addEventListener("click", async () => {
            try {
              const tokenId = button.getAttribute("data-token-id");
              if (!tokenId) return;
              const revoke = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/tokens/" + encodeURIComponent(tokenId), { method: "DELETE" });
              if (!revoke.ok) {
                const error = await revoke.json();
                throw new Error(error.error?.message || "failed to revoke token");
              }
              await refreshTokens();
            } catch (error) {
              alert(error.message);
            }
          });
        });
      }

      async function refreshCockpit() {
        const slug = currentSlug();
        if (!slug) return;
        updateMcpOutput();
        const team = document.getElementById("team-filter").value.trim();
        const params = team ? "?team=" + encodeURIComponent(team) : "";
        const res = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/cockpit" + params);
        const messagesRes = await fetch("/api/workspaces/" + encodeURIComponent(slug) + "/messages" + params);
        const body = await res.json();
        const messagesBody = await messagesRes.json();
        if (!res.ok) throw new Error(body.error?.message || "failed to load cockpit");
        if (!messagesRes.ok) throw new Error(messagesBody.error?.message || "failed to load messages");
        renderCockpit(body.result);
        renderChat(messagesBody.result);
      }

      function renderCockpit(result) {
        const board = result?.board || {};
        const agents = board.agents || [];
        const tasks = board.tasks || [];
        const memories = result?.memories?.memories || [];
        const decisions = result?.decisions?.decisions || [];
        document.getElementById("cockpit-metrics").innerHTML = [
          ["Agents", agents.length],
          ["Tasks", tasks.length],
          ["Memories", memories.length],
          ["Decisions", decisions.length],
        ].map(([label, value]) => '<div class="metric"><h2>' + value + '</h2><p>' + label + '</p></div>').join("");
        const states = ["backlog", "open", "working", "blocked", "completed", "failed", "canceled"];
        document.getElementById("kanban").innerHTML = states.map((stateName) => {
          const items = tasks.filter((task) => task.state === stateName);
          return '<div class="column"><strong>' + stateName.toUpperCase() + ' · ' + items.length + '</strong>' +
            (items.length ? items.map((task) => '<div class="task"><strong>#' + task.id + '</strong> ' + escapeHtml(task.title) + '<br><span class="muted">' + escapeHtml(task.claimed_by || task.pending_assignee || "unassigned") + '</span></div>').join("") : '<p class="muted">empty</p>') +
            '</div>';
        }).join("");
        document.getElementById("activity").innerHTML = (result?.activity?.activity || []).map((event) => {
          const item = event.item || {};
          const text = item.content_preview || item.message || item.title || JSON.stringify(item);
          return '<div class="event"><span class="muted">' + escapeHtml(event.type) + '</span><br>' + escapeHtml(text) + '</div>';
        }).join("") || '<p class="muted">No activity yet.</p>';
      }

      function renderChat(page) {
        const messages = page?.messages || [];
        document.getElementById("team-chat").innerHTML = messages.length ? messages.map((message) => {
          const body = message.content_preview || "";
          const meta = "#" + message.id + " · " + (message.kind || "msg") + " · " + new Date(message.created_at).toLocaleTimeString();
          return '<div class="message"><div><strong>' + escapeHtml(message.from_agent) + '</strong><br><span class="muted">' + escapeHtml(meta) + '</span><br><span class="pill">' + escapeHtml(message.to_agent) + '</span></div><div class="message-body">' + escapeHtml(body) + '</div></div>';
        }).join("") : '<p class="muted">No messages yet.</p>';
      }

      document.getElementById("create-workspace").addEventListener("click", () => createWorkspace().catch((error) => alert(error.message)));
      document.getElementById("create-token").addEventListener("click", () => createToken().catch((error) => alert(error.message)));
      document.getElementById("refresh-cockpit").addEventListener("click", () => refreshCockpit().catch((error) => alert(error.message)));
      document.getElementById("refresh-chat").addEventListener("click", () => refreshCockpit().catch((error) => alert(error.message)));
      document.getElementById("logout").addEventListener("click", async () => { await fetch("/api/auth/logout", { method: "POST" }); location.href = "/app"; });
      workspaceSelect.addEventListener("change", refreshCockpit);
      renderWorkspaceSelect();
      refreshCockpit().catch(() => {});
    </script>
  </main>`);
}
