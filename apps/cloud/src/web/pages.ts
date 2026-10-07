import type { Env } from "../shared/types";
import { html } from "../shared/http";
import { listWorkspaces } from "../auth/workspaces";
import { cloudToolStatus } from "../mcp/tool-registry";

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
    @media (max-width: 820px) { .grid { grid-template-columns: 1fr; } }
  </style>
</head>
<body>${body}</body>
</html>`);
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

export async function dashboardPage(env: Env): Promise<Response> {
  const workspaces = await listWorkspaces(env);
  const tools = cloudToolStatus();
  const implemented = tools.filter((tool) => tool.implemented).length;
  return shell("Agent Bus Cloud Dashboard", `<main class="wrap">
    <nav class="nav"><div class="brand"><div class="logo">AB</div>Agent Bus Cloud</div><a href="/">Landing</a></nav>
    <section>
      <h1>Workspaces</h1>
      <p>Create a workspace through <span class="mono">POST /api/workspaces</span>, create an agent token, then connect agents to <span class="mono">/mcp/&lt;workspace&gt;</span>.</p>
      <div class="grid">
        <div class="card"><h2>${workspaces.length}</h2><p>workspaces</p></div>
        <div class="card"><h2>${implemented} / ${tools.length}</h2><p>cloud tools wired</p></div>
        <div class="card"><h2>Cloudflare</h2><p>Workers + Durable Objects SQLite + D1</p></div>
      </div>
      <div class="card" style="margin-top:24px">
        ${workspaces.length === 0 ? "<p>No workspaces yet. Use the API to create one while the full UI form is being built.</p>" : workspaces.map((workspace) => `
          <div class="workspace">
            <div><strong>${workspace.name}</strong><br><span class="mono">/mcp/${workspace.slug}</span></div>
            <span class="pill">${workspace.role ?? "owner"}</span>
          </div>`).join("")}
      </div>
      <h2 style="margin-top:32px">Setup</h2>
      <pre class="mono">curl -X POST /api/workspaces \\
  -H 'content-type: application/json' \\
  -d '{"slug":"my-team","name":"My Team"}'

curl -X POST /api/workspaces/my-team/tokens \\
  -H 'content-type: application/json' \\
  -d '{"name":"claude-ui","role":"agent"}'</pre>
    </section>
  </main>`);
}
