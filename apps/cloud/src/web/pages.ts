import type { Env } from "../shared/types";
import { html } from "../shared/http";
import { listWorkspaces } from "../auth/workspaces";
import { currentUser } from "../auth/session";
import { cockpitMarkup, cockpitRenderScript, cockpitStyles, detailsMarkup } from "./cockpit";
import { humanChatScript, humanChatStyles } from "./human-chat";
import { icon } from "./icons";
export { landingPage } from "./landing";

// Theme tokens. System preference by default; data-theme on <html> forces light or dark.
const darkTokens = `color-scheme: dark;
    --bg: #08090b; --sidebar: #0c0d10; --surface: #111317; --surface-2: #1a1d23; --hover: #1d2128; --row-hover: rgba(255,255,255,.028);
    --line: #22262d; --line-strong: #30353e; --text: #f2f4f7; --text-2: #c9ced6; --muted: #8f96a1;
    --cyan: #00d4ff; --cyan-soft: rgba(0,212,255,.12); --blue: #8eb0ff; --blue-soft: rgba(114,158,255,.16); --violet: #b49aff;
    --green: #7fe0aa; --amber: #f2c46b; --red: #ff9393;
    --accent-fill: #00d4ff; --accent-hover: #47e1ff; --on-accent: #001a22; --focus-line: rgba(0,212,255,.6); --focus-glow: rgba(0,212,255,.12);
    --person-bg: #0b3a45; --person-fg: #8eeeff; --agent-bg: #182139; --agent-fg: #b4c9ff; --agent-ring: rgba(114,158,255,.35);
    --scrim: rgba(0,0,0,.55); --shadow: rgba(0,0,0,.45); --jump-bg: #062a33;`;
const lightTokens = `color-scheme: light;
    --bg: #f7f8fa; --sidebar: #eef0f3; --surface: #ffffff; --surface-2: #eef0f4; --hover: #e5e8ed; --row-hover: rgba(15,20,30,.035);
    --line: #e0e3e8; --line-strong: #cdd2da; --text: #0d1117; --text-2: #343b45; --muted: #5b636e;
    --cyan: #00789a; --cyan-soft: rgba(0,170,210,.12); --blue: #2f5fd0; --blue-soft: rgba(47,95,208,.1); --violet: #6a4bd1;
    --green: #1b7a48; --amber: #9a6100; --red: #c23b32;
    --accent-fill: #00d4ff; --accent-hover: #47e1ff; --on-accent: #001a22; --focus-line: rgba(0,140,180,.55); --focus-glow: rgba(0,170,210,.14);
    --person-bg: #d4f3fa; --person-fg: #005a70; --agent-bg: #e3eaff; --agent-fg: #2a4fb3; --agent-ring: rgba(47,95,208,.28);
    --scrim: rgba(15,20,30,.32); --shadow: rgba(16,24,40,.14); --jump-bg: #e2f7fc;`;

const baseStyles = `
  @font-face { font-family: Manrope; src: url("/fonts/manrope-latin.woff2") format("woff2"); font-weight: 400 800; font-display: swap; }
  @font-face { font-family: "Space Grotesk"; src: url("/fonts/space-grotesk-latin.woff2") format("woff2"); font-weight: 500 700; font-display: swap; }
  :root { ${darkTokens} }
  :root[data-theme="light"] { ${lightTokens} }
  @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { ${lightTokens} } }
  * { box-sizing: border-box; }
  html, body { height: 100%; margin: 0; }
  body { background: var(--bg); color: var(--text); font: 14.5px/1.5 Manrope, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; font-synthesis: none; -webkit-tap-highlight-color: transparent; }
  h1, h2, h3 { margin: 0; font-family: "Space Grotesk", Manrope, sans-serif; font-weight: 600; letter-spacing: 0; }
  p { margin: 0; }
  a { color: var(--cyan); }
  button, input, select, textarea { font: inherit; color: inherit; }
  :focus-visible { outline: 2px solid var(--cyan); outline-offset: 2px; }
  [hidden] { display: none !important; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }
  .muted { color: var(--muted); }
  .brand { display: inline-flex; align-items: center; gap: 10px; color: var(--text); font-family: "Space Grotesk", Manrope, sans-serif; font-weight: 600; font-size: 15px; text-decoration: none; }
  .brand img { width: 26px; height: 26px; border-radius: 7px; }
  .btn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; height: 36px; padding: 0 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--text); font-weight: 650; font-size: 13.5px; text-decoration: none; cursor: pointer; white-space: nowrap; }
  .btn:hover { background: var(--hover); }
  .btn.primary { background: var(--accent-fill); border-color: var(--accent-fill); color: var(--on-accent); }
  .btn.primary:hover { background: var(--accent-hover); }
  .btn.danger { color: var(--red); }
  .btn:disabled { opacity: .5; cursor: not-allowed; }
  .icon-btn { display: inline-grid; place-items: center; flex-shrink: 0; width: 34px; height: 34px; padding: 0; border: 0; border-radius: 7px; background: transparent; color: var(--text-2); cursor: pointer; }
  .icon-btn:hover { background: var(--hover); color: var(--text); }
  .icon-btn.small { width: 28px; height: 28px; }
  .icon-btn:disabled { opacity: .4; cursor: not-allowed; background: transparent; }
  .field { display: grid; gap: 6px; min-width: 0; color: var(--text-2); font-size: 13px; font-weight: 650; }
  .field input, .field select, .field textarea { width: 100%; height: 38px; padding: 0 11px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--bg); color: var(--text); font-size: 14px; font-weight: 500; }
  .field textarea { height: auto; min-height: 96px; padding: 10px 11px; line-height: 1.5; resize: vertical; }
  .field input:focus, .field select:focus, .field textarea:focus { outline: none; border-color: var(--focus-line); box-shadow: 0 0 0 3px var(--focus-glow); }
  .optional, .field-hint { color: var(--muted); font-weight: 500; font-size: 12px; }
  .form-note { margin: 0; color: var(--muted); font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
  .form-note.error, .inline-error { color: var(--red); }
  .form-note.success { color: var(--green); }
  @media (max-width: 860px) { .field input, .field select, .field textarea { font-size: 16px; height: 42px; } .field textarea { height: auto; } .btn { height: 40px; } }
`;

const authStyles = `
  .auth-wrap { min-height: 100%; display: grid; place-items: center; padding: 32px 16px; }
  .auth-card { width: min(400px, 100%); display: grid; gap: 20px; }
  .auth-card h1 { font-size: 24px; }
  .auth-sub { color: var(--muted); margin-top: 6px; line-height: 1.5; }
  .auth-form { display: grid; gap: 14px; padding: 22px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .auth-actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 4px; }
  .auth-actions .btn { flex: 1 1 140px; }
  #auth-result:empty { display: none; }
  .auth-foot { color: var(--muted); font-size: 13px; text-align: center; }
  .auth-foot a { color: var(--text-2); }
`;

const appStyles = `
  body.app-body { overflow: hidden; }
  .skip-link { position: absolute; left: 8px; top: -48px; z-index: 100; padding: 8px 12px; border-radius: 8px; background: var(--accent-fill); color: var(--on-accent); font-weight: 700; text-decoration: none; }
  .skip-link:focus { top: 8px; }
  .app { display: grid; grid-template-columns: 260px minmax(0, 1fr); height: 100vh; height: 100dvh; overflow: hidden; }

  .sidebar { display: flex; flex-direction: column; min-height: 0; background: var(--sidebar); border-right: 1px solid var(--line); }
  .sidebar-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 56px; padding: 0 10px 0 16px; }
  .workspace-switch { padding: 4px 10px 12px; border-bottom: 1px solid var(--line); }
  .eyebrow { display: block; padding: 0 4px 6px; color: var(--muted); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .select-wrap { position: relative; }
  .select-wrap select { appearance: none; width: 100%; height: 38px; padding: 0 32px 0 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--text); font-weight: 700; font-size: 14px; cursor: pointer; text-overflow: ellipsis; }
  .select-wrap select:disabled { cursor: not-allowed; opacity: .7; }
  .select-wrap::after { content: ""; position: absolute; right: 13px; top: 15px; width: 6px; height: 6px; border-right: 1.5px solid var(--muted); border-bottom: 1.5px solid var(--muted); transform: rotate(45deg); pointer-events: none; }
  .role-note { margin: 6px 4px 0; color: var(--muted); font-size: 12px; }
  .sidebar-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 8px 8px 16px; }
  .nav-section + .nav-section { margin-top: 16px; }
  .nav-section h2 { padding: 4px 8px 6px; color: var(--muted); font-family: inherit; font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
  .nav-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 1px; }
  .nav-item { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 34px; padding: 4px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text-2); text-align: left; text-decoration: none; font-size: 14px; font-weight: 600; cursor: pointer; }
  .nav-item:hover { background: var(--hover); color: var(--text); }
  .nav-item[aria-current] { background: var(--cyan-soft); color: var(--text); }
  .nav-item .icon, .nav-hash { flex-shrink: 0; color: var(--muted); }
  .nav-item[aria-current] .icon, .nav-item[aria-current] .nav-hash { color: var(--cyan); }
  .nav-hash { width: 18px; text-align: center; font-weight: 500; font-size: 16px; }
  .nav-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .nav-sub { margin-left: auto; min-width: 0; max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--muted); font-size: 11.5px; font-weight: 500; }
  .count { margin-left: auto; display: inline-grid; place-items: center; min-width: 20px; height: 18px; padding: 0 6px; border-radius: 9px; background: var(--surface-2); color: var(--text-2); font-size: 11.5px; font-weight: 700; }
  .count:empty { display: none; }
  .nav-empty { padding: 4px 8px; color: var(--muted); font-size: 13px; line-height: 1.45; }
  .sidebar-foot { display: flex; align-items: center; gap: 8px; padding: 10px 8px calc(10px + env(safe-area-inset-bottom)) 12px; border-top: 1px solid var(--line); }
  .theme-toggle svg { display: none; }
  .theme-toggle[data-mode="system"] .t-system, .theme-toggle[data-mode="light"] .t-light, .theme-toggle[data-mode="dark"] .t-dark { display: block; }
  .me { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 10px; }
  .me .avatar { width: 32px; height: 32px; font-size: 11px; }
  .me div { min-width: 0; }
  .me div strong, .me div span { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .me div strong { font-size: 13.5px; }
  .me div span { color: var(--muted); font-size: 12px; }

  .main { position: relative; display: flex; flex-direction: column; min-width: 0; min-height: 0; background: var(--bg); }
  .view { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; }
  .view-head { flex: 0 0 auto; display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; min-height: 56px; padding: 8px 12px 8px 20px; border-bottom: 1px solid var(--line); }
  .view-title { flex: 1 1 140px; min-width: 0; }
  .view-title h1 { display: flex; align-items: baseline; min-width: 0; font-size: 17px; line-height: 1.3; }
  .view-title h1:focus { outline: none; }
  .view-title h1 > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .hash { margin-right: 3px; color: var(--muted); font-weight: 500; }
  .view-sub { margin-top: 1px; color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .view-sub:empty { display: none; }
  .head-actions { display: flex; align-items: center; gap: 6px; margin-left: auto; }
  .chip-btn { display: inline-flex; align-items: center; gap: 6px; height: 32px; padding: 0 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: transparent; color: var(--text-2); font-size: 13px; font-weight: 700; cursor: pointer; }
  .chip-btn:hover, .chip-btn[aria-expanded="true"] { background: var(--hover); color: var(--text); }
  .nav-open, .nav-open-only { display: none; }
  .view-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .view-inner { display: grid; gap: 16px; max-width: 760px; padding: 24px 20px 48px; }
  .view-inner.wide { max-width: none; }
  .view-inner.split { max-width: 1100px; grid-template-columns: minmax(0, 1.6fr) minmax(260px, 1fr); gap: 32px; align-items: start; }
  .stack { display: grid; gap: 24px; }
  .section-title { margin-bottom: 8px; font-size: 14px; }
  .panel { padding: 18px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .panel-title { font-size: 15px; }
  .panel-sub { margin: 4px 0 14px; color: var(--muted); font-size: 13.5px; line-height: 1.5; }
  .form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; padding-top: 16px; }
  .span-2 { grid-column: 1 / -1; }
  .inline-form { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
  .inline-form .grow { flex: 1 1 220px; }
  .inline-form + .form-note { margin-top: 10px; }
  .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
  .note { padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--text-2); font-size: 13.5px; line-height: 1.5; }
  .disclosure { padding: 12px 16px; }
  .disclosure summary { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; list-style: none; cursor: pointer; font-weight: 700; border-radius: 6px; }
  .disclosure summary::-webkit-details-marker { display: none; }
  .disclosure summary > span:first-child { display: inline-flex; align-items: center; gap: 8px; color: var(--text); }
  .summary-hint { color: var(--muted); font-size: 13px; font-weight: 500; }
  .code { margin: 0; padding: 12px 14px; border: 1px solid var(--line); border-radius: 8px; background: var(--bg); color: var(--text-2); font: 12.5px/1.6 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; overflow-wrap: anywhere; max-height: 360px; overflow: auto; }
  .copy-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; align-items: start; }
  .warn-note { margin: 16px 0 8px; color: var(--amber); font-size: 13px; font-weight: 650; }
  .list-panel { list-style: none; margin: 0; padding: 0; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
  .list-panel > li { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 14px; padding: 12px 16px; border-bottom: 1px solid var(--line); }
  .list-panel > li:last-child { border-bottom: 0; }
  .list-panel .avatar { width: 32px; height: 32px; font-size: 11px; }
  .row-main { flex: 1 1 180px; min-width: 0; }
  .row-main strong { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; }
  .row-main span { color: var(--muted); font-size: 12.5px; overflow-wrap: anywhere; }
  .row-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
  .row-actions select { height: 32px; padding: 0 8px; border: 1px solid var(--line-strong); border-radius: 7px; background: var(--bg); color: var(--text); }
  .row-actions .btn { height: 32px; }
  .role-list { display: grid; gap: 4px; margin: 0; padding: 0; list-style: none; color: var(--muted); font-size: 13px; }
  .role-list strong { color: var(--text-2); }

  .avatar { display: grid; place-items: center; flex-shrink: 0; width: 36px; height: 36px; font-size: 12.5px; font-weight: 800; letter-spacing: .02em; }
  .avatar.person { border-radius: 50%; background: var(--person-bg); color: var(--person-fg); }
  .avatar.agent { border-radius: 9px; background: var(--agent-bg); color: var(--agent-fg); box-shadow: inset 0 0 0 1px var(--agent-ring); }
  .badge.agent { display: inline-flex; align-items: center; height: 17px; padding: 0 5px; border-radius: 4px; background: var(--blue-soft); color: var(--blue); font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }

  .details { display: none; flex-direction: column; min-height: 0; background: var(--sidebar); border-left: 1px solid var(--line); }
  .details-head { position: relative; display: flex; align-items: center; gap: 8px; min-height: 56px; padding: 0 10px 0 16px; border-bottom: 1px solid var(--line); }
  .details-head h2 { flex: 1; font-size: 15px; }
  .sheet-grip { display: none; }
  .details-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
  .scrim { position: fixed; inset: 0; z-index: 40; background: var(--scrim); }
  .toast { position: fixed; left: 50%; bottom: 24px; z-index: 70; transform: translateX(-50%); max-width: min(480px, calc(100vw - 32px)); padding: 10px 14px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface-2); color: var(--text); font-size: 13.5px; box-shadow: 0 10px 30px var(--shadow); }
  .toast.error { border-color: var(--red); color: var(--red); }
  .empty-row { list-style: none; padding: 12px 0; }

  @media (min-width: 1181px) {
    .app[data-view="chat"]:not(.details-collapsed):not(.no-scope) { grid-template-columns: 260px minmax(0, 1fr) 300px; }
    .app[data-view="chat"]:not(.details-collapsed):not(.no-scope) .details { display: flex; }
  }
  @media (max-width: 1180px) {
    .details { display: flex; position: fixed; top: 0; right: 0; bottom: 0; z-index: 50; width: min(360px, 92vw); border-left-color: var(--line-strong); box-shadow: -16px 0 40px var(--shadow); transform: translateX(100%); visibility: hidden; transition: transform .22s ease, visibility 0s linear .22s; }
    .app.details-open .details { transform: none; visibility: visible; transition: transform .22s ease; }
  }
  @media (max-width: 860px) {
    .app { grid-template-columns: minmax(0, 1fr); }
    .sidebar { position: fixed; top: 0; bottom: 0; left: 0; z-index: 50; width: min(300px, 86vw); border-right-color: var(--line-strong); box-shadow: 16px 0 40px var(--shadow); transform: translateX(-100%); visibility: hidden; transition: transform .22s ease, visibility 0s linear .22s; }
    .app.nav-open .sidebar { transform: none; visibility: visible; transition: transform .22s ease; }
    .nav-open, .nav-open-only { display: inline-grid; }
    .view-head { padding: 8px 8px 8px 6px; }
    .icon-btn { width: 40px; height: 40px; }
    .nav-item { min-height: 42px; }
    .details { top: auto; left: 0; width: auto; max-height: 82vh; max-height: 82dvh; border-left: 0; border-top: 1px solid var(--line-strong); border-radius: 16px 16px 0 0; padding-bottom: env(safe-area-inset-bottom); transform: translateY(100%); }
    .sheet-grip { display: block; position: absolute; top: 6px; left: 50%; width: 36px; height: 4px; margin-left: -18px; border-radius: 2px; background: var(--line-strong); }
    .view-inner { padding: 16px 14px 40px; }
    .view-inner.split, .form-grid { grid-template-columns: minmax(0, 1fr); }
    .panel { padding: 16px; }
  }
  @media (prefers-reduced-motion: reduce) { .sidebar, .details { transition: none !important; } }
`;

function shell(title: string, bodyClass: string, styles: string, body: string): Response {
  return html(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content" />
  <meta name="theme-color" content="#08090b" id="theme-color" />
  <script>try{var t=localStorage.getItem("agent-bus.theme");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}</script>
  <title>${title}</title>
  <link rel="icon" type="image/webp" href="/images/agent-bus-mark.webp">
  <link rel="preload" href="/fonts/manrope-latin.woff2" as="font" type="font/woff2" crossorigin>
  <style>${baseStyles}${styles}</style>
</head>
<body class="${bodyClass}">${body}</body>
</html>`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" })[char] ?? char);
}

function initials(name: string): string {
  const parts = name.split(/[\s._@-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts[1]?.[0] ?? "")).toUpperCase();
}

function authPage(): Response {
  return shell("Sign in · Agent Bus", "auth-body", authStyles, `<main class="auth-wrap">
    <div class="auth-card">
      <a class="brand" href="/"><img src="/images/agent-bus-mark.webp" alt="" width="26" height="26">Agent Bus</a>
      <div><h1>Sign in</h1><p class="auth-sub">Sign in or create an account to bring your agents together.</p></div>
      <form id="auth-form" class="auth-form" novalidate>
        <label class="field">Email<input id="email" type="email" autocomplete="email" required></label>
        <label class="field">Password<input id="password" type="password" autocomplete="current-password" required></label>
        <label class="field">Name <span class="optional">for new accounts</span><input id="name" autocomplete="name"></label>
        <div class="auth-actions"><button id="login" class="btn primary" type="submit">Log in</button><button id="signup" class="btn" type="button">Create account</button></div>
        <p id="auth-result" class="form-note error" role="alert"></p>
      </form>
      <p class="auth-foot"><a href="/">Back to Agent Bus</a></p>
    </div>
    <script>
      const result = document.getElementById("auth-result");
      async function auth(path, button) {
        result.textContent = "";
        document.querySelectorAll(".auth-actions button").forEach((item) => item.disabled = true);
        try {
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
          if (!res.ok) throw new Error(body.error?.message || "Authentication failed.");
          location.href = "/app";
        } catch (error) {
          result.textContent = error.message === "Failed to fetch" ? "Can't reach the server. Check your connection." : error.message;
          document.querySelectorAll(".auth-actions button").forEach((item) => item.disabled = false);
          button.focus();
        }
      }
      document.getElementById("auth-form").addEventListener("submit", (event) => { event.preventDefault(); auth("/api/auth/login", document.getElementById("login")); });
      document.getElementById("signup").addEventListener("click", (event) => auth("/api/auth/signup", event.currentTarget));
    </script>
  </main>`);
}

const navOpen = `<button class="icon-btn nav-open" type="button" aria-label="Open navigation" aria-controls="sidebar" aria-expanded="false">${icon("menu", 20)}</button>`;

const adminMarkup = `
  <section class="view" data-view-panel="members" aria-labelledby="members-title" hidden>
    <header class="view-head">${navOpen}<div class="view-title"><h1 id="members-title" tabindex="-1">Members</h1><p class="view-sub">People who can open this workspace</p></div></header>
    <div class="view-scroll"><div class="view-inner">
      <section id="member-panel" class="panel" aria-labelledby="add-member-title">
        <h2 id="add-member-title" class="panel-title">Add a member</h2>
        <p class="panel-sub">They need an Agent Bus account first. You can change roles at any time.</p>
        <div class="inline-form">
          <label class="field grow">Email<input id="member-email" type="email" placeholder="teammate@example.com" autocomplete="off"></label>
          <label class="field">Role<select id="member-role"><option value="viewer">Viewer</option><option value="agent">Agent</option><option value="manager">Manager</option><option value="owner">Owner</option></select></label>
          <button id="add-member" class="btn primary" type="button">Add member</button>
        </div>
        <p id="member-result" class="form-note" role="status"></p>
      </section>
      <p id="members-note" class="note" hidden></p>
      <ul id="member-list" class="list-panel" aria-label="Workspace members"></ul>
      <ul class="role-list" aria-label="Roles">
        <li><strong>Owner</strong> manages members, agent tokens, and all work.</li>
        <li><strong>Manager</strong> manages agent tokens and work.</li>
        <li><strong>Agent</strong> sends messages and updates work.</li>
        <li><strong>Viewer</strong> can read everything but change nothing.</li>
      </ul>
    </div></div>
  </section>
  <section class="view" data-view-panel="connect" aria-labelledby="connect-title" hidden>
    <header class="view-head">${navOpen}<div class="view-title"><h1 id="connect-title" tabindex="-1">Connect agents</h1><p class="view-sub">Give each agent session its own token</p></div></header>
    <div class="view-scroll"><div class="view-inner">
      <section class="panel" aria-labelledby="mcp-url-label">
        <h2 id="mcp-url-label" class="panel-title">MCP URL</h2>
        <p class="panel-sub">Agents connect to this address with a bearer token. Any MCP client that supports HTTP servers with headers can join.</p>
        <div class="copy-row"><pre id="mcp-output" class="code" aria-labelledby="mcp-url-label">/mcp/&lt;workspace&gt;</pre><button class="btn" type="button" data-copy-target="mcp-output" aria-label="Copy MCP URL">${icon("copy", 16)}<span>Copy</span></button></div>
      </section>
      <section id="token-panel" class="panel" aria-labelledby="token-title">
        <h2 id="token-title" class="panel-title">Create an agent token</h2>
        <p class="panel-sub">Name the token after the agent that will use it, so you can recognise and revoke it later.</p>
        <div class="inline-form">
          <label class="field grow">Token name<input id="token-name" placeholder="claude-ui-designer" autocomplete="off"></label>
          <label class="field">Role<select id="token-role"><option value="agent">Agent</option><option value="manager">Manager</option><option value="viewer">Viewer</option><option value="owner">Owner</option></select></label>
          <button id="create-token" class="btn primary" type="button">Create token</button>
        </div>
        <p id="token-result" class="form-note" role="status"></p>
        <div id="token-reveal" hidden>
          <p class="warn-note">Copy this now. The token is shown only once; store it like a password.</p>
          <div class="copy-row"><pre id="token-output" class="code" tabindex="0" aria-label="Agent setup details"></pre><button class="btn" type="button" data-copy-target="token-output" aria-label="Copy setup details">${icon("copy", 16)}<span>Copy</span></button></div>
        </div>
      </section>
      <p id="token-note" class="note" hidden></p>
      <section aria-labelledby="tokens-title"><h2 id="tokens-title" class="section-title">Agent tokens</h2><ul id="token-list" class="list-panel"></ul></section>
    </div></div>
  </section>
  <section class="view" data-view-panel="new-workspace" aria-labelledby="new-workspace-title" hidden>
    <header class="view-head">${navOpen}<div class="view-title"><h1 id="new-workspace-title" tabindex="-1">New workspace</h1><p class="view-sub">A separate space for a group of people and agents</p></div></header>
    <div class="view-scroll"><div class="view-inner">
      <form id="workspace-form" class="panel" novalidate>
        <div class="form-grid" style="padding-top:0">
          <label class="field span-2">Name<input id="workspace-name" placeholder="My Agent Team" autocomplete="off"></label>
          <label class="field span-2">Workspace address<input id="workspace-slug" placeholder="my-agent-team" autocomplete="off" spellcheck="false" aria-describedby="workspace-slug-hint"><span id="workspace-slug-hint" class="field-hint">Letters, numbers, dots, dashes and underscores. Agents use it in their connection URL.</span></label>
          <div class="form-actions span-2"><button id="create-workspace" class="btn primary" type="submit">Create workspace</button><p id="workspace-result" class="form-note" role="status"></p></div>
        </div>
      </form>
    </div></div>
  </section>`;

const appScript = String.raw`
  const state = JSON.parse(document.getElementById("initial-data").textContent);
  const app = document.getElementById("app");
  const sidebar = document.getElementById("sidebar");
  const mainEl = document.getElementById("main");
  const detailsEl = document.getElementById("details");
  const scrim = document.getElementById("scrim");
  const workspaceSelect = document.getElementById("workspace-select");
  const tokenOutput = document.getElementById("token-output");
  const mcpOutput = document.getElementById("mcp-output");
  const VIEWS = ["chat", "tasks", "activity", "members", "connect", "new-workspace"];
  const narrowNav = matchMedia("(max-width: 860px)");
  const overlayDetails = matchMedia("(max-width: 1180px)");
  let lastFocus = null; let appliedView = ""; let toastTimer = 0;

  // Theme: system by default; an explicit choice is shared with the landing page via localStorage.
  const themeKey = "agent-bus.theme";
  const themeButton = document.getElementById("theme-toggle");
  const prefersLight = matchMedia("(prefers-color-scheme: light)");
  const themeLabels = { system: "match system", light: "light", dark: "dark" };
  const nextTheme = { system: "light", light: "dark", dark: "system" };
  function readTheme() {
    try { const value = localStorage.getItem(themeKey); return value === "light" || value === "dark" ? value : "system"; } catch { return "system"; }
  }
  function applyTheme(mode) {
    if (mode === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = mode;
    const effective = mode === "system" ? (prefersLight.matches ? "light" : "dark") : mode;
    document.getElementById("theme-color")?.setAttribute("content", effective === "light" ? "#f7f8fa" : "#08090b");
    themeButton.dataset.mode = mode;
    themeButton.setAttribute("aria-label", "Theme: " + themeLabels[mode] + ". Switch to " + themeLabels[nextTheme[mode]]);
    themeButton.title = "Theme: " + themeLabels[mode];
  }
  themeButton.addEventListener("click", () => {
    const mode = nextTheme[themeButton.dataset.mode] || "system";
    try { if (mode === "system") localStorage.removeItem(themeKey); else localStorage.setItem(themeKey, mode); } catch {}
    applyTheme(mode);
  });
  prefersLight.addEventListener("change", () => applyTheme(themeButton.dataset.mode));
  addEventListener("storage", (event) => { if (event.key === themeKey) applyTheme(readTheme()); });
  applyTheme(readTheme());

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]));
  }
  function notify(message, error = false) {
    const toast = document.getElementById("toast");
    toast.textContent = message; toast.classList.toggle("error", error); toast.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, error ? 7000 : 3500);
  }
  function setNote(id, message, kind = "") {
    const el = document.getElementById(id);
    el.textContent = message; el.classList.toggle("error", kind === "error"); el.classList.toggle("success", kind === "success");
  }
  function friendly(error) { return error?.message === "Failed to fetch" ? "Can't reach the server. Check your connection and try again." : error?.message || "Something went wrong."; }
  async function api(path, init) {
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { const error = new Error(body.error?.message || "Request failed."); error.status = res.status; throw error; }
    return body;
  }
  function jsonInit(method, body) { return { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }; }

  function currentSlug() { return workspaceSelect.value || state.workspaces[0]?.slug || ""; }
  function currentWorkspace() { return state.workspaces.find((workspace) => workspace.slug === currentSlug()) || null; }
  function currentRole() { return currentWorkspace()?.role || ""; }
  function renderWorkspaceSelect(selected) {
    workspaceSelect.innerHTML = state.workspaces.length
      ? state.workspaces.map((workspace) => '<option value="' + escapeHtml(workspace.slug) + '">' + escapeHtml(workspace.name) + '</option>').join("")
      : '<option value="">No workspaces yet</option>';
    if (selected) workspaceSelect.value = selected;
    updateWorkspaceChrome();
  }
  function updateWorkspaceChrome() {
    const slug = currentSlug(); const role = currentRole();
    const labels = { owner: "Owner", manager: "Manager", agent: "Agent", viewer: "Viewer (read-only)" };
    document.getElementById("workspace-role").textContent = slug ? "Your role: " + (labels[role] || role) : "";
    mcpOutput.textContent = slug ? location.origin + "/mcp/" + slug : "Create a workspace first.";
    document.title = (currentWorkspace()?.name ? currentWorkspace().name + " · " : "") + "Agent Bus";
    applyRoleGates();
  }
  function applyRoleGates() {
    const role = currentRole(); const hasWorkspace = Boolean(currentSlug());
    const owner = role === "owner"; const manager = owner || role === "manager";
    document.getElementById("member-panel").hidden = !owner;
    const membersNote = !hasWorkspace ? "Create a workspace to add members." : owner ? "" : role === "agent" ? "Your role can't view or change the member list." : "Only workspace owners can add or change members.";
    document.getElementById("members-note").textContent = membersNote; document.getElementById("members-note").hidden = !membersNote;
    document.getElementById("token-panel").hidden = !manager;
    const tokenNote = !hasWorkspace ? "Create a workspace to connect agents." : manager ? "" : "Only owners and managers can create or revoke agent tokens.";
    document.getElementById("token-note").textContent = tokenNote; document.getElementById("token-note").hidden = !tokenNote;
    document.getElementById("task-form-panel").hidden = !hasWorkspace || role === "viewer";
  }

  function currentView() {
    const view = location.hash.slice(1);
    if (!state.workspaces.length && (!view || view === "chat")) return "new-workspace";
    return VIEWS.includes(view) ? view : "chat";
  }
  function applyView(focus) {
    const view = currentView();
    closeNav();
    if (view === appliedView) return;
    appliedView = view; app.dataset.view = view;
    document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
    document.querySelectorAll("[data-view-link]").forEach((link) => link.dataset.viewLink === view ? link.setAttribute("aria-current", "page") : link.removeAttribute("aria-current"));
    if (view !== "chat") closeDetails(false);
    renderConversationList(); updateDetailsToggle(); loadViewData();
    if (focus) {
      const target = view === "chat" && !narrowNav.matches ? document.getElementById("chat-content") : document.querySelector('[data-view-panel="' + view + '"] h1');
      if (target && !target.disabled) target.focus({ preventScroll: true });
      else document.getElementById("chat-title").focus({ preventScroll: true });
    }
  }
  function showView(view) {
    const hash = view === "chat" ? "" : "#" + view;
    if (location.hash !== hash) history.pushState(null, "", location.pathname + location.search + hash);
    applyView(true);
  }
  function loadViewData() {
    if (appliedView === "members") refreshMembers();
    if (appliedView === "connect") refreshTokens();
    if (appliedView === "tasks" || appliedView === "activity") renderCockpit();
  }
  addEventListener("hashchange", () => applyView(true));
  addEventListener("popstate", () => applyView(true));

  function setNavExpanded(open) { document.querySelectorAll(".nav-open").forEach((button) => button.setAttribute("aria-expanded", String(open))); }
  function openNav(trigger) {
    if (!narrowNav.matches) return;
    lastFocus = trigger || document.activeElement;
    app.classList.add("nav-open"); scrim.hidden = false; mainEl.inert = true; detailsEl.inert = true; setNavExpanded(true);
    (sidebar.querySelector("[aria-current]") || workspaceSelect).focus();
  }
  function closeNav() {
    if (!app.classList.contains("nav-open")) return;
    app.classList.remove("nav-open"); setNavExpanded(false); afterOverlayClose();
  }
  function updateDetailsToggle() {
    const open = overlayDetails.matches ? app.classList.contains("details-open") : !app.classList.contains("details-collapsed");
    document.getElementById("details-toggle").setAttribute("aria-expanded", String(open && app.dataset.view === "chat"));
  }
  function openDetails(trigger) {
    if (!overlayDetails.matches) {
      app.classList.remove("details-collapsed");
      try { localStorage.setItem("agent-bus.details", "open"); } catch {}
      updateDetailsToggle(); return;
    }
    lastFocus = trigger || document.activeElement;
    app.classList.add("details-open"); scrim.hidden = false; mainEl.inert = true; sidebar.inert = true;
    updateDetailsToggle(); document.getElementById("details-close").focus();
  }
  function closeDetails(restore = true) {
    if (!overlayDetails.matches) {
      if (!restore) return;
      app.classList.add("details-collapsed");
      try { localStorage.setItem("agent-bus.details", "closed"); } catch {}
      updateDetailsToggle(); document.getElementById("details-toggle").focus(); return;
    }
    if (!app.classList.contains("details-open")) return;
    app.classList.remove("details-open"); updateDetailsToggle(); afterOverlayClose(restore);
  }
  function afterOverlayClose(restore = true) {
    if (app.classList.contains("nav-open") || app.classList.contains("details-open")) return;
    scrim.hidden = true; mainEl.inert = false; sidebar.inert = false; detailsEl.inert = false;
    if (restore && lastFocus?.isConnected && !lastFocus.closest("[hidden]")) lastFocus.focus({ preventScroll: true });
    lastFocus = null;
  }
  function closeOverlays() {
    lastFocus = null;
    app.classList.remove("nav-open", "details-open"); setNavExpanded(false); afterOverlayClose(false); updateDetailsToggle();
  }
  document.addEventListener("click", (event) => {
    const opener = event.target.closest(".nav-open"); if (opener) openNav(opener);
  });
  document.getElementById("nav-close").addEventListener("click", closeNav);
  document.getElementById("details-toggle").addEventListener("click", (event) => {
    const open = overlayDetails.matches ? app.classList.contains("details-open") : !app.classList.contains("details-collapsed");
    open ? closeDetails() : openDetails(event.currentTarget);
  });
  document.getElementById("details-close").addEventListener("click", () => closeDetails());
  scrim.addEventListener("click", () => { closeNav(); closeDetails(); });
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (app.classList.contains("nav-open")) { event.preventDefault(); closeNav(); }
    else if (app.classList.contains("details-open")) { event.preventDefault(); closeDetails(); }
  });
  for (const query of [narrowNav, overlayDetails]) query.addEventListener("change", () => { closeOverlays(); });
  sidebar.addEventListener("click", (event) => { if (event.target.closest("[data-view-link]")) closeNav(); });

  async function createWorkspace() {
    const slugInput = document.getElementById("workspace-slug");
    const slug = slugInput.value.trim();
    const name = document.getElementById("workspace-name").value.trim() || slug;
    if (!/^[a-zA-Z0-9_.-]+$/.test(slug)) { setNote("workspace-result", "Choose an address using letters, numbers, dots, dashes or underscores.", "error"); slugInput.focus(); return; }
    if (chatContent.value.trim() && !confirm("Discard this draft and switch workspaces?")) return;
    const button = document.getElementById("create-workspace"); button.disabled = true; setNote("workspace-result", "Creating...");
    try {
      const body = await api("/api/workspaces", jsonInit("POST", { slug, name }));
      state.workspaces.unshift({ ...body.workspace, role: body.workspace.role || "owner" });
      renderWorkspaceSelect(body.workspace.slug);
      document.getElementById("workspace-form").reset(); delete slugInput.dataset.edited;
      setNote("workspace-result", "");
      notify("Created " + body.workspace.name + ".");
      switchWorkspace(); showView("chat");
    } catch (error) { setNote("workspace-result", friendly(error), "error"); }
    finally { button.disabled = false; }
  }
  document.getElementById("workspace-form").addEventListener("submit", (event) => { event.preventDefault(); createWorkspace(); });
  document.getElementById("workspace-name").addEventListener("input", (event) => {
    const slugInput = document.getElementById("workspace-slug");
    if (!slugInput.dataset.edited) slugInput.value = event.target.value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  });
  document.getElementById("workspace-slug").addEventListener("input", (event) => { event.target.dataset.edited = "1"; });

  async function createToken() {
    const slug = currentSlug();
    if (!slug) return;
    const name = document.getElementById("token-name").value.trim() || "agent";
    const role = document.getElementById("token-role").value;
    const button = document.getElementById("create-token"); button.disabled = true; setNote("token-result", "Creating...");
    try {
      const body = await api("/api/workspaces/" + encodeURIComponent(slug) + "/tokens", jsonInit("POST", { name, role }));
      const mcpUrl = location.origin + "/mcp/" + slug;
      const config = { mcpServers: { "agent-bus-cloud": { type: "http", url: mcpUrl, headers: { Authorization: "Bearer " + body.token.token } } } };
      tokenOutput.textContent = [
        "MCP URL:", mcpUrl, "",
        "Bearer token:", body.token.token, "",
        "Generic remote MCP config:", JSON.stringify(config, null, 2), "",
        "Debug check:", "curl -H 'authorization: Bearer " + body.token.token + "' " + mcpUrl + "/info",
      ].join("\n");
      document.getElementById("token-reveal").hidden = false;
      document.getElementById("token-name").value = "";
      setNote("token-result", "Created token " + name + ".", "success");
      tokenOutput.focus();
      await refreshTokens();
    } catch (error) { setNote("token-result", friendly(error), "error"); }
    finally { button.disabled = false; }
  }

  async function refreshTokens() {
    const slug = currentSlug();
    const target = document.getElementById("token-list");
    if (!slug) { target.innerHTML = ""; return; }
    if (!target.children.length) target.innerHTML = '<li class="muted">Loading tokens...</li>';
    try {
      const body = await api("/api/workspaces/" + encodeURIComponent(slug) + "/tokens");
      if (slug !== currentSlug()) return;
      const manager = ["owner", "manager"].includes(currentRole());
      target.innerHTML = (body.tokens || []).length ? body.tokens.map((token) => {
        const used = token.last_used_at ? "last used " + new Date(token.last_used_at).toLocaleString() : "never used";
        return '<li><span class="avatar agent" aria-hidden="true">' + escapeHtml(initialsOf(token.name)) + '</span><div class="row-main"><strong>' + escapeHtml(token.name) + '</strong><span>' + escapeHtml(token.role + " · " + used) + '</span></div>' +
          (manager ? '<div class="row-actions"><button class="btn danger" type="button" data-token-id="' + escapeHtml(token.id) + '" data-token-name="' + escapeHtml(token.name) + '">Revoke</button></div>' : '') + '</li>';
      }).join("") : '<li class="muted">No agent tokens yet.</li>';
    } catch (error) {
      target.innerHTML = '<li class="muted">' + escapeHtml(error.status === 403 ? "Your role can't view agent tokens." : friendly(error)) + '</li>';
    }
  }
  document.getElementById("token-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-token-id]"); if (!button) return;
    if (!confirm("Revoke " + button.dataset.tokenName + "? Agents using it will lose access immediately.")) return;
    button.disabled = true;
    try {
      await api("/api/workspaces/" + encodeURIComponent(currentSlug()) + "/tokens/" + encodeURIComponent(button.dataset.tokenId), { method: "DELETE" });
      notify("Revoked " + button.dataset.tokenName + ".");
      await refreshTokens();
    } catch (error) { notify(friendly(error), true); button.disabled = false; }
  });

  function initialsOf(name) { const parts = String(name || "?").split(/[\s._@-]+/).filter(Boolean); return ((parts[0]?.[0] || "?") + (parts[1]?.[0] || "")).toUpperCase(); }
  async function refreshMembers() {
    const slug = currentSlug();
    const target = document.getElementById("member-list");
    if (!slug) { target.innerHTML = ""; target.hidden = true; return; }
    target.hidden = false;
    if (!target.children.length) target.innerHTML = '<li class="muted">Loading members...</li>';
    try {
      const body = await api("/api/workspaces/" + encodeURIComponent(slug) + "/members");
      if (slug !== currentSlug()) return;
      const owner = currentRole() === "owner";
      const roles = ["viewer", "agent", "manager", "owner"];
      target.innerHTML = (body.members || []).length ? body.members.map((member) => {
        const label = member.name || member.email;
        return '<li><span class="avatar person" aria-hidden="true">' + escapeHtml(initialsOf(label)) + '</span><div class="row-main"><strong>' + escapeHtml(label) + '</strong><span>' + escapeHtml(member.name ? member.email : member.role) + '</span></div>' +
          '<div class="row-actions">' + (owner
            ? '<select data-member-role="' + escapeHtml(member.user_id) + '" aria-label="Role for ' + escapeHtml(label) + '">' + roles.map((role) => '<option value="' + role + '"' + (member.role === role ? " selected" : "") + '>' + role.charAt(0).toUpperCase() + role.slice(1) + '</option>').join("") + '</select>' +
              '<button class="btn danger" type="button" data-member-remove="' + escapeHtml(member.user_id) + '" data-member-name="' + escapeHtml(label) + '">Remove</button>'
            : '<span class="tag">' + escapeHtml(member.role) + '</span>') + '</div></li>';
      }).join("") : '<li class="muted">No members yet.</li>';
    } catch (error) {
      target.hidden = error.status === 403;
      if (error.status !== 403) target.innerHTML = '<li class="muted">' + escapeHtml(friendly(error)) + '</li>';
    }
  }
  document.getElementById("member-list").addEventListener("change", async (event) => {
    const select = event.target.closest("select[data-member-role]"); if (!select) return;
    select.disabled = true;
    try {
      await api("/api/workspaces/" + encodeURIComponent(currentSlug()) + "/members/" + encodeURIComponent(select.dataset.memberRole), jsonInit("PATCH", { role: select.value }));
      notify("Role updated.");
    } catch (error) { notify(friendly(error), true); }
    await refreshMembers();
  });
  document.getElementById("member-list").addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-member-remove]"); if (!button) return;
    if (!confirm("Remove " + button.dataset.memberName + " from this workspace?")) return;
    button.disabled = true;
    try {
      await api("/api/workspaces/" + encodeURIComponent(currentSlug()) + "/members/" + encodeURIComponent(button.dataset.memberRemove), { method: "DELETE" });
      notify("Removed " + button.dataset.memberName + ".");
      await refreshMembers();
    } catch (error) { notify(friendly(error), true); button.disabled = false; }
  });
  async function addMember() {
    const slug = currentSlug();
    if (!slug) return;
    const email = document.getElementById("member-email").value.trim();
    const role = document.getElementById("member-role").value;
    if (!email) { setNote("member-result", "Enter the email address of an existing account.", "error"); document.getElementById("member-email").focus(); return; }
    const button = document.getElementById("add-member"); button.disabled = true;
    try {
      await api("/api/workspaces/" + encodeURIComponent(slug) + "/members", jsonInit("POST", { email, role }));
      document.getElementById("member-email").value = "";
      setNote("member-result", "Added " + email + " as " + role + ".", "success");
      await refreshMembers();
    } catch (error) { setNote("member-result", friendly(error), "error"); }
    finally { button.disabled = false; }
  }

  async function workspaceRpc(op, input) {
    const slug = currentSlug();
    if (!slug) throw new Error("Create or select a workspace first.");
    const body = await api("/api/workspaces/" + encodeURIComponent(slug) + "/rpc", jsonInit("POST", { op, input }));
    return body.result;
  }

  async function createTrackedTask() {
    const requested_by = document.getElementById("action-from").value.trim();
    const title = document.getElementById("task-title").value.trim();
    const description = document.getElementById("task-description").value;
    const claimed_by = document.getElementById("task-assignee").value.trim();
    const taskState = document.getElementById("task-state").value;
    const team = document.getElementById("action-team").value.trim();
    if (!requested_by || !title) { setNote("action-result", "Add the requesting agent and a task title.", "error"); document.getElementById(requested_by ? "task-title" : "action-from").focus(); return; }
    const scope = team ? { team, ...(chat.scope && chat.scope.team === team ? { project: chat.scope.project || undefined, area: chat.scope.area || undefined } : {}) } : {};
    const button = document.getElementById("create-task-action"); button.disabled = true;
    try {
      const result = await workspaceRpc("create_task", { requested_by, title, description, claimed_by: claimed_by || undefined, state: taskState, ...scope });
      setNote("action-result", "Created task #" + result.task.id + ".", "success");
      document.getElementById("task-title").value = "";
      document.getElementById("task-description").value = "";
      await refreshCockpit();
    } catch (error) { setNote("action-result", friendly(error), "error"); }
    finally { button.disabled = false; }
  }
  document.getElementById("action-team").addEventListener("input", (event) => { event.target.dataset.auto = "0"; });

  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-target]"); if (!button) return;
    const source = document.getElementById(button.dataset.copyTarget);
    const label = button.querySelector("span");
    try {
      await navigator.clipboard.writeText(source.textContent);
      if (label) { label.textContent = "Copied"; setTimeout(() => { label.textContent = "Copy"; }, 1600); }
    } catch {
      const range = document.createRange(); range.selectNodeContents(source);
      getSelection().removeAllRanges(); getSelection().addRange(range);
      notify("Selected. Press Ctrl+C or Cmd+C to copy.");
    }
  });

  function switchWorkspace() {
    resetHumanChat(); board.all = board.team = null; board.error = "";
    document.getElementById("token-reveal").hidden = true; tokenOutput.textContent = "";
    document.getElementById("member-list").innerHTML = ""; document.getElementById("token-list").innerHTML = "";
    ["member-result", "token-result", "action-result"].forEach((id) => setNote(id, ""));
    updateWorkspaceChrome(); renderCockpit(); loadViewData(); refreshAll();
  }
  async function refreshAll() { await refreshHumanChat(true); await refreshCockpit(); }
`;

const initScript = String.raw`
  document.getElementById("create-token").addEventListener("click", () => createToken());
  document.getElementById("add-member").addEventListener("click", () => addMember());
  document.getElementById("member-email").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); addMember(); } });
  document.getElementById("token-name").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); createToken(); } });
  document.getElementById("create-task-action").addEventListener("click", () => createTrackedTask());
  document.getElementById("refresh-cockpit").addEventListener("click", () => refreshCockpit());
  document.getElementById("logout").addEventListener("click", async () => {
    if (chatContent.value.trim() && !confirm("Discard this draft and log out?")) return;
    try { await fetch("/api/auth/logout", { method: "POST" }); } finally { location.href = "/app"; }
  });
  workspaceSelect.addEventListener("change", () => {
    if (chatContent.value.trim() && !confirm("Discard this draft and switch workspaces?")) { workspaceSelect.value = chat.workspace; return; }
    switchWorkspace();
  });
  try { if (localStorage.getItem("agent-bus.details") === "closed") app.classList.add("details-collapsed"); } catch {}
  renderWorkspaceSelect();
  chat.workspace = currentSlug();
  applyView(false);
  renderChatChrome(); renderHumanMessages(); renderCockpit();
  if (currentSlug()) refreshAll();
`;

export async function dashboardPage(request: Request, env: Env): Promise<Response> {
  const user = await currentUser(env, request);
  if (!user) return authPage();
  const workspaces = await listWorkspaces(env, user.id);
  const initialData = JSON.stringify({ workspaces }).replaceAll("<", "\\u003c");
  const clientIcons = JSON.stringify({ reply: icon("reply", 15), message: icon("message", 16), tasks: icon("tasks", 16) }).replaceAll("<", "\\u003c");
  const displayName = user.name || user.email;
  return shell("Agent Bus", "app-body", appStyles + humanChatStyles + cockpitStyles, `
  <a class="skip-link" href="#chat-content">Skip to message composer</a>
  <div id="app" class="app" data-view="chat">
    <aside id="sidebar" class="sidebar" aria-label="Workspace navigation">
      <div class="sidebar-head">
        <a class="brand" href="/" title="Agent Bus home"><img src="/images/agent-bus-mark.webp" alt="" width="26" height="26">Agent Bus</a>
        <button id="nav-close" class="icon-btn nav-open-only" type="button" aria-label="Close navigation">${icon("x")}</button>
      </div>
      <div class="workspace-switch">
        <label for="workspace-select" class="eyebrow">Workspaces</label>
        <div class="select-wrap"><select id="workspace-select"></select></div>
        <p id="workspace-role" class="role-note"></p>
      </div>
      <div class="sidebar-scroll">
        <nav class="nav-section" aria-labelledby="conversations-heading">
          <h2 id="conversations-heading">Conversations</h2>
          <ul id="conversation-list" class="nav-list"></ul>
        </nav>
        <nav class="nav-section" aria-labelledby="workspace-heading">
          <h2 id="workspace-heading">Workspace</h2>
          <ul class="nav-list">
            <li><a class="nav-item" href="#tasks" data-view-link="tasks">${icon("tasks")}<span class="nav-label">Tasks</span><span id="nav-task-count" class="count"></span></a></li>
            <li><a class="nav-item" href="#activity" data-view-link="activity">${icon("activity")}<span class="nav-label">Activity</span></a></li>
            <li><a class="nav-item" href="#members" data-view-link="members">${icon("users")}<span class="nav-label">Members</span></a></li>
            <li><a class="nav-item" href="#connect" data-view-link="connect">${icon("plug")}<span class="nav-label">Connect agents</span></a></li>
            <li><a class="nav-item" href="#new-workspace" data-view-link="new-workspace">${icon("plus")}<span class="nav-label">New workspace</span></a></li>
          </ul>
        </nav>
      </div>
      <div class="sidebar-foot">
        <div class="me"><span class="avatar person" aria-hidden="true">${escapeHtml(initials(displayName))}</span><div><strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(user.email)}</span></div></div>
        <button id="theme-toggle" class="icon-btn theme-toggle" type="button" data-mode="system" aria-label="Theme: match system. Switch to light" title="Theme: match system">${icon("monitor", 18, "t-system")}${icon("sun", 18, "t-light")}${icon("moon", 18, "t-dark")}</button>
        <button id="logout" class="icon-btn" type="button" aria-label="Log out" title="Log out">${icon("logout")}</button>
      </div>
    </aside>
    <main id="main" class="main">
      ${cockpitMarkup}
      ${adminMarkup}
    </main>
    ${detailsMarkup}
    <div id="scrim" class="scrim" hidden></div>
  </div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
  <script id="initial-data" type="application/json">${initialData}</script>
  <script>
    const ICONS = ${clientIcons};
    ${appScript}
    ${cockpitRenderScript}
    ${humanChatScript}
    ${initScript}
  </script>`);
}
