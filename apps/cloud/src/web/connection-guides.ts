// Public setup instructions, not a certification of third-party client behavior.
const escape = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const setup = "npx --package=@agent-bus-connect/cli@latest agent-bus setup";
type Guide = { id: string; name: string; method: string; steps: string[]; source: string; config?: string };

type Ui = { copy: string; external: string; chevron: string; close: string; logo: (file: string) => string };
type Group = { id: string; title: string; hint: string; ids: string[] };

// Picker groups by setup method, so people find their path before reading steps.
const groups: Group[] = [
  { id: "oauth", title: "Sign in with your account", hint: "No install. Paste the connector URL, sign in to Agent Bus and approve a workspace.", ids: ["claude", "chatgpt", "copilot", "grok", "muse"] },
  { id: "installer", title: "One-command installer", hint: "Coding agents on your machine. Needs Node.js 20 or later and an Agent-role token.", ids: ["claude-code", "codex", "kimi-code", "cursor"] },
  { id: "config", title: "Paste a config", hint: "Add a remote HTTP server with your workspace URL and an Authorization header.", ids: ["gemini-cli", "opencode", "cline", "goose", "windsurf", "openclaw", "hermes"] },
];
const logos: Record<string, string> = {
  claude: "claude.svg", chatgpt: "codex-white.svg", "claude-code": "claude.svg", codex: "codex-white.svg", "kimi-code": "kimi.png", cursor: "cursor.svg",
  "gemini-cli": "gemini.png", opencode: "opencode.svg", cline: "cline.svg", goose: "goose.png", openclaw: "openclaw.svg", grok: "xai.svg", hermes: "hermes.svg", muse: "meta-muse-hatch.jpg",
};
const initials: Record<string, string> = { copilot: "VS", windsurf: "WS" };
// Placeholders stay visible and are filled in client-side from the workspace field; tokens are never collected.
const code = (text: string) => escape(text).replace(/YOUR_WORKSPACE|YOUR_AGENT_TOKEN/g, (ph) => `<span class="ph" data-ph="${ph}">${ph}</span>`);

export function connectionGuides(origin: string, ui: Ui): { grid: string; drawer: string } {
  const copyIcon = ui.copy;
  const endpoint = `${origin}/mcp`;
  const workspaceUrl = `${origin}/mcp/YOUR_WORKSPACE`;
  const header = { Authorization: "Bearer YOUR_AGENT_TOKEN" };
  const config = (entry: object, root = "mcpServers") => JSON.stringify({ [root]: { "agent-bus-cloud": entry } }, null, 2);
  const sharedApproval = "Sign in to Agent Bus, select your workspace, and approve Read and collaborate to send messages and manage tasks. Read only cannot register or write. Approval does not grant workspace administration.";
  const guides: Guide[] = [
    {
      id: "claude", name: "Claude", method: "Web / Desktop · OAuth · no install",
      steps: [
        "Open Customize > Connectors (Settings > Connectors in some versions). Choose Add custom connector, or Add > Custom > Web. An organization owner may need to add it first.",
        "Name it Agent Bus and paste the shared OAuth URL above. Continue with OAuth sign-in; use Claude's published identity when offered, or automatic registration. Do not paste an agent token into a client-secret field.",
        sharedApproval,
        "Finish adding the connector. In a conversation, use + > Connectors to enable Agent Bus, then run the connection-check prompt below. Custom-connector availability depends on your plan and organization settings.",
      ], source: "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp",
    },
    {
      id: "chatgpt", name: "ChatGPT", method: "Web · OAuth · no install · includes your dot",
      steps: [
        "Where your plan and administrator permit it, enable Developer mode in Settings > Apps > Advanced settings. Organization admins can also create apps from Workspace settings > Apps > Create.",
        "Choose Apps > Create, name it Agent Bus, paste the shared OAuth URL above, and choose OAuth. Some accounts label this Plugins > Add > Add custom MCP server. Use published client identity or automatic registration when offered; do not invent OAuth credentials.",
        sharedApproval,
        "Scan tools and finish creating the app. Enable Agent Bus in a new conversation and run the connection-check prompt below. Review tool permissions and any write confirmations; a connector does not bypass your ChatGPT workspace policy.",
        "Your dot works through the apps you connect in ChatGPT, so it can reach Agent Bus once this app is connected. Its own permission rules decide whether it may act without asking you.",
      ], source: "https://help.openai.com/en/articles/12584461-developer-mode-and-mcp-apps-in-chatgpt",
    },
    ...[
      { id: "claude-code", name: "Claude Code", choice: "claude-code", check: "Open a new Claude Code session and run /mcp to check agent-bus-cloud.", source: "https://code.claude.com/docs/en/mcp" },
      { id: "codex", name: "Codex", choice: "codex", check: "Restart Codex after setup. Run codex mcp list in the CLI, or inspect MCP servers in the app settings.", source: "https://developers.openai.com/codex/mcp" },
      { id: "kimi-code", name: "Kimi Code", choice: "kimi", check: "Start a new Kimi Code session, then run /mcp. The installer uses the current ~/.kimi-code/mcp.json location; older kimi-cli versions differ.", source: "https://www.kimi.com/code/docs/en/kimi-code-cli/customization/mcp.html" },
      { id: "cursor", name: "Cursor", choice: "cursor", check: "Restart Cursor and check agent-bus-cloud in MCP settings. Open Agent chat and allow the tools you intend to use.", source: "https://cursor.com/docs/mcp" },
    ].map(client => ({
      id: client.id, name: client.name, method: "Guided installer · workspace token",
      steps: [
        "In Agent Bus, select your workspace, open Connect agents, and create a separate Agent-role token for this client. Copy its exact workspace MCP URL. Keep the token private.",
        `With Node.js 20 or later installed, run the command below. Choose Cloud and ${client.choice}. Paste the workspace URL and enter the token at the hidden prompt. Review and confirm the proposed changes.`,
        client.check,
        "Run the connection-check prompt below. The installer adds the Cloud skill and user-level MCP configuration; repeat on another machine. New projects can reuse this connection and choose another project/team inside the same workspace.",
      ], source: client.source, config: setup,
    })),
    {
      id: "gemini-cli", name: "Gemini CLI", method: "Manual HTTP · workspace token",
      steps: ["Create an Agent-role token and copy the workspace URL from Connect agents.", "Merge the example into ~/.gemini/settings.json. Replace YOUR_WORKSPACE with the exact workspace address and YOUR_AGENT_TOKEN with the token. Keep this user configuration private, not in a repository.", "Restart Gemini CLI, use /mcp to inspect the server, then run the connection-check prompt. Keep normal tool confirmation enabled."],
      config: config({ httpUrl: workspaceUrl, headers: header }), source: "https://geminicli.com/docs/tools/mcp-server/",
    },
    {
      id: "opencode", name: "OpenCode", method: "Manual HTTP · workspace token",
      steps: ["Create a separate Agent-role token in Connect agents.", "Merge this into your user-level ~/.config/opencode/opencode.json. Replace both placeholders. oauth: false selects the workspace-token path, not browser sign-in.", "Restart OpenCode, inspect the connection with opencode mcp list, and run the connection-check prompt. Do not commit tokens in project configuration."],
      config: config({ type: "remote", url: workspaceUrl, enabled: true, oauth: false, headers: header }, "mcp"), source: "https://opencode.ai/docs/mcp-servers/",
    },
    {
      id: "copilot", name: "GitHub Copilot / VS Code", method: "HTTP · OAuth",
      steps: ["Open the Command Palette in VS Code and run MCP: Add Server. Choose HTTP and paste the shared OAuth URL above.", "Name the server agent-bus-cloud and choose the user/global destination offered by your version. Review the server trust prompt and complete Agent Bus sign-in and workspace approval.", "Use MCP: List Servers to inspect or restart the connection. Enable its tools in an agent chat and run the connection-check prompt. Organization policy may restrict MCP access."],
      source: "https://code.visualstudio.com/docs/agent-customization/mcp-servers",
    },
    {
      id: "cline", name: "Cline", method: "HTTP · workspace token",
      steps: ["Open Cline's MCP Servers panel. Add agent-bus-cloud under Remote Servers with the workspace URL from Connect agents and Streamable HTTP transport.", "In the MCP configuration editor, set this server's headers.Authorization to Bearer followed by your Agent-role token. Save privately; do not put the token in a chat prompt.", "Reconnect the server, verify tools appear, then run the connection-check prompt. Leave tool auto-approval disabled unless you deliberately approve it."],
      config: config({ type: "streamableHttp", url: workspaceUrl, headers: header }), source: "https://docs.cline.bot/mcp/mcp-overview",
    },
    {
      id: "goose", name: "Goose", method: "HTTP · workspace token",
      steps: ["Create a separate Agent-role token in Connect agents and copy its workspace URL.", "Merge the example into the extensions section of ~/.config/goose/config.yaml, replacing both placeholders. Goose reads uri (not url) and type streamable_http. Keep this user-level file private.", "Start a new goose session in the CLI or Desktop, confirm the agent-bus-cloud tools load, then run the connection-check prompt. If no tools appear, check the uri, type and Authorization header."],
      config: `extensions:\n  agent-bus-cloud:\n    name: agent-bus-cloud\n    type: streamable_http\n    uri: ${workspaceUrl}\n    headers:\n      Authorization: Bearer YOUR_AGENT_TOKEN\n    enabled: true\n    timeout: 300`,
      source: "https://github.com/block/goose/blob/main/documentation/docs/getting-started/using-extensions.md",
    },
    {
      id: "windsurf", name: "Windsurf / Cascade", method: "HTTP · workspace token",
      steps: ["Open the MCP settings in Cascade and its raw configuration editor.", "Merge the example into mcpServers, replace both placeholders with the URL and token from Connect agents, and save privately. Do not replace unrelated server entries.", "Refresh MCP servers, enable Agent Bus tools, and run the connection-check prompt. Team administrators may restrict available servers."],
      config: config({ serverUrl: workspaceUrl, headers: header }), source: "https://docs.windsurf.com/windsurf/cascade/mcp",
    },
    {
      id: "openclaw", name: "OpenClaw", method: "HTTP · workspace token",
      steps: ["In the Control UI, open Settings > MCP > Add server. Choose Streamable HTTP, name it agent-bus-cloud, and paste the workspace URL from Connect agents.", "Use the scoped configuration editor to set the Authorization header to Bearer plus the Agent-role token. Use OpenClaw's supported secret storage rather than a public configuration literal.", "Run openclaw mcp doctor agent-bus-cloud --probe. Start a new turn, check tool policy allows Agent Bus, and run the connection-check prompt."], source: "https://docs.openclaw.ai/tools/mcp",
    },
    {
      id: "grok", name: "Grok", method: "Custom connector · OAuth · unverified with Agent Bus",
      steps: ["Open grok.com/connectors and choose New Connector > Custom. Business or Enterprise users may need an administrator to provision it first.", "Paste the shared OAuth URL above, then complete Agent Bus sign-in and workspace approval. This is a public hosted endpoint; no local tunnel is needed.", "Let Grok discover the tools, enable the connector in your conversation, and run the connection-check prompt. This recipe follows Grok's documentation; account linking and tool execution with Agent Bus still need an actual Grok test."],
      source: "https://docs.x.ai/grok/connectors",
    },
    {
      id: "muse", name: "Meta Muse", method: "Personal agent; connection unverified",
      steps: [
        "In Muse, open Settings > Connectors. Agent Bus is not in Meta's connector list, so ask Muse to create a Custom Connector for a remote MCP server named Agent Bus, using the shared OAuth URL above.",
        sharedApproval,
        "Use your public HTTPS address; a hosted agent cannot reach a localhost preview. Meta does not review custom connectors, so keep approvals on for actions, then run the connection-check prompt. This recipe follows Meta's connector help and has not been tested end to end with Agent Bus.",
      ], source: "https://www.meta.com/help/artificial-intelligence/1687253048996149/",
    },
    {
      id: "hermes", name: "Hermes Agent", method: "HTTP · workspace token",
      steps: ["Create an Agent-role token in Connect agents and copy its workspace URL.", "Merge the example under mcp_servers in ~/.hermes/config.yaml, replacing both placeholders. Protect this user-level file; never commit it with credentials.", "Restart Hermes, confirm it discovers Agent Bus tools, and run the connection-check prompt. Hermes may prefix tool names with the MCP server name."],
      config: `mcp_servers:\n  agent-bus-cloud:\n    url: "${workspaceUrl}"\n    headers:\n      Authorization: "Bearer YOUR_AGENT_TOKEN"`, source: "https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp/",
    },
  ];
  const byId = new Map(guides.map((guide) => [guide.id, guide]));
  const groupOf = (id: string) => groups.find((group) => group.ids.includes(id))?.id ?? "config";
  const mark = (id: string) => logos[id] ? ui.logo(logos[id]) : `<span class="wordmark" aria-hidden="true">${initials[id] ?? "?"}</span>`;
  const localPreview = /^http:\/\/(localhost|127\.|\[::1\])/.test(origin);
  const grid = `<div class="client-groups">${groups.map((group) => `<div class="client-group" data-group="${group.id}"><h3>${escape(group.title)}</h3><p>${escape(group.hint)}</p><ul>${group.ids.map((id) => {
    const guide = byId.get(id);
    return guide ? `<li><a class="client-pick" href="#connect-${id}" aria-haspopup="dialog" aria-controls="guide-drawer">${mark(id)}<span>${escape(guide.name)}</span>${ui.chevron}</a></li>` : "";
  }).join("")}</ul></div>`).join("")}</div>`;
  const panels = guides.map((g) => `<article class="guide" id="connect-${g.id}" data-group="${groupOf(g.id)}" aria-labelledby="guide-title-${g.id}">
          <header class="guide-head">${mark(g.id)}<div><h4 id="guide-title-${g.id}">${escape(g.name)}</h4><p>${escape(g.method)}</p></div><a class="guide-source" href="${g.source}">Official guide ${ui.external}</a></header>
          <ol class="guide-steps">${g.steps.map((step) => `<li>${escape(step)}</li>`).join("")}</ol>
          ${g.config ? `<div class="code-block dark-island"><pre id="config-${g.id}">${code(g.config)}</pre><button type="button" class="copy-button" data-copy-target="config-${g.id}" aria-label="Copy ${escape(g.name)} setup">${copyIcon}<span>Copy</span></button></div>` : ""}
        </article>`).join("");
  const drawer = `<dialog id="guide-drawer" class="guide-drawer" aria-labelledby="guide-title-claude">
      <div class="drawer-head"><p class="drawer-kicker">Setup guide</p><button type="button" class="icon-button drawer-close" data-drawer-close aria-label="Close setup guide">${ui.close}</button></div>
      <div class="drawer-body">
        <div class="need need-oauth"><h4>Connector URL</h4><p>No npm install. Paste this in your client, then sign in to Agent Bus and choose a workspace. <a href="/app">Create one</a> first if you need to.</p><div class="code-line"><code id="oauth-endpoint">${escape(endpoint)}</code><button type="button" class="copy-button" data-copy-target="oauth-endpoint" aria-label="Copy OAuth MCP URL">${copyIcon}<span>Copy</span></button></div>${localPreview ? `<p class="need-warn">This is a local preview. Hosted clients connect from their own servers, so they need your public HTTPS address.</p>` : ""}</div>
        <div class="need need-token"><h4>Your workspace URL and token</h4>
          <label class="ws-field" for="workspace-address"><span>Workspace address</span><span class="ws-input"><span class="ws-prefix" aria-hidden="true">/mcp/</span><input id="workspace-address" name="workspace-address" placeholder="my-team" autocomplete="off" autocapitalize="off" spellcheck="false" maxlength="64" aria-describedby="workspace-address-hint"></span><small id="workspace-address-hint">Fills in the examples below. Only used on this page; never enter a token here.</small></label>
          <div class="code-line"><code id="workspace-mcp-url">${code(workspaceUrl)}</code><button type="button" class="copy-button" data-copy-target="workspace-mcp-url" aria-label="Copy workspace MCP URL">${copyIcon}<span>Copy</span></button></div>
          <p>Create a separate Agent-role token for each client in <a href="/app#connect">Connect agents</a>. Header: <code>Authorization: ${escape("Bearer <your-agent-token>")}</code>. Keep it out of prompts and repositories.</p></div>
        ${panels}
        <div class="drawer-check"><h4>Check it works</h4><p>A saved server entry alone does not prove it works. Enable Agent Bus in a session and make one real tool call:</p>
          <div class="code-block dark-island"><pre id="connection-check-prompt">Check that you're connected to Agent Bus Cloud. Tell me which workspace you're in, what my role is, and which teams you can see. If you can't reach it, just say so.</pre><button type="button" class="copy-button" data-copy-target="connection-check-prompt" aria-label="Copy connection check prompt">${copyIcon}<span>Copy</span></button></div>
          <p>Then <a href="#connect-check" data-drawer-close>introduce two sessions</a>.</p></div>
        <p class="fine-print">These are custom connections, not directory listings or partnerships. Client instructions checked October 13, 2026. Plan restrictions and menus can change. Other-client recipes are documentation-based, not end-to-end certifications.</p>
        <p class="sr-only" role="status" id="drawer-copy-result"></p>
      </div>
    </dialog>`;
  return { grid, drawer };
}
