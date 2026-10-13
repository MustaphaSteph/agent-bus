import { icon } from "./icons";

export const workspacePickerStyles = `
  .workspace-trigger { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 62px; padding: 10px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); text-align: left; cursor: pointer; }
  .workspace-trigger:hover, .workspace-trigger[aria-expanded="true"] { background: var(--hover); border-color: var(--muted); }
  .workspace-trigger:disabled { opacity: .6; cursor: not-allowed; }
  .workspace-mark { display: grid; place-items: center; flex: 0 0 34px; height: 34px; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--cyan-soft); color: var(--cyan); font-size: 13px; font-weight: 800; }
  .workspace-copy { display: grid; gap: 1px; flex: 1; min-width: 0; }
  .workspace-copy strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; font-weight: 700; }
  .workspace-copy small { color: var(--muted); font-size: 12px; }
  .workspace-trigger > .icon { color: var(--muted); flex-shrink: 0; }
  .workspace-dialog { position: fixed; inset: 68px auto auto 12px; width: min(360px, calc(100vw - 24px)); max-width: none; max-height: calc(100dvh - 92px); margin: 0; padding: 0; border: 1px solid var(--line-strong); border-radius: 8px; background: var(--surface); color: var(--text); box-shadow: 0 16px 48px var(--shadow); overflow: hidden; }
  .workspace-dialog[open] { display: flex; flex-direction: column; }
  .workspace-dialog::backdrop { background: var(--scrim); }
  .workspace-dialog-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 12px 4px 16px; }
  .workspace-dialog-head h2 { font-family: inherit; font-size: 15px; }
  .workspace-dialog .icon-btn { width: 44px; height: 44px; }
  .workspace-search { padding: 0 12px 12px; }
  .workspace-search input { width: 100%; height: 44px; padding: 0 12px; border: 1px solid var(--line-strong); border-radius: 6px; background: var(--bg); font-size: 16px; }
  .workspace-options { display: grid; gap: 4px; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 0 8px 8px; list-style: none; margin: 0; }
  .workspace-option { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 62px; padding: 10px; border: 1px solid transparent; border-radius: 6px; background: transparent; text-align: left; cursor: pointer; }
  .workspace-option:hover { background: var(--hover); }
  .workspace-option[aria-current="true"] { background: var(--cyan-soft); }
  .workspace-option .workspace-copy strong { white-space: normal; overflow-wrap: anywhere; }
  .workspace-option .icon { color: var(--cyan); flex-shrink: 0; }
  .workspace-empty { padding: 24px 12px; text-align: center; color: var(--muted); }
  .workspace-picker-footer { flex-shrink: 0; padding: 8px; border-top: 1px solid var(--line); }
  .workspace-picker-footer .nav-item { min-height: 44px; }
  @media (max-width: 860px) {
    .workspace-dialog { inset: auto 0 0; width: 100%; max-height: 80dvh; padding-bottom: env(safe-area-inset-bottom); border-bottom: 0; border-radius: 8px 8px 0 0; }
    .workspace-dialog-head { padding-top: 8px; }
  }
`;

export const workspacePickerMarkup = `
  <span class="eyebrow">Workspaces</span>
  <select id="workspace-select" class="sr-only" tabindex="-1" aria-hidden="true"></select>
  <button id="workspace-trigger" class="workspace-trigger" type="button" aria-haspopup="dialog" aria-controls="workspace-dialog" aria-expanded="false">
    <span id="workspace-mark" class="workspace-mark" aria-hidden="true"></span>
    <span class="workspace-copy"><strong id="workspace-name-current"></strong><small id="workspace-role"></small></span>
    ${icon("arrowDown", 16)}
  </button>
`;

// Outside the navigation drawer so its inert state cannot disable the modal.
export const workspaceDialogMarkup = `
  <dialog id="workspace-dialog" class="workspace-dialog" aria-labelledby="workspace-picker-title">
    <div class="workspace-dialog-head"><h2 id="workspace-picker-title">Switch workspace</h2><button id="workspace-picker-close" class="icon-btn" type="button" aria-label="Close workspace picker">${icon("x", 20)}</button></div>
    <div class="workspace-search"><label class="sr-only" for="workspace-search">Search workspaces</label><input id="workspace-search" type="search" placeholder="Search workspaces" autocomplete="off" autocapitalize="none" spellcheck="false"></div>
    <ul id="workspace-options" class="workspace-options" aria-label="Workspaces"></ul>
    <p id="workspace-empty" class="workspace-empty" role="status" hidden>No matching workspaces.</p>
    <div class="workspace-picker-footer"><button id="workspace-picker-create" class="nav-item" type="button">${icon("plus")}<span>New workspace</span></button></div>
  </dialog>
`;

export const workspacePickerScript = String.raw`
  const workspaceTrigger = document.getElementById("workspace-trigger");
  const workspaceDialog = document.getElementById("workspace-dialog");
  const workspaceSearch = document.getElementById("workspace-search");
  const workspaceOptions = document.getElementById("workspace-options");
  const workspaceRoles = { owner: "Owner", manager: "Manager", agent: "Agent", viewer: "Viewer (read-only)" };
  function syncWorkspacePicker() {
    const workspace = currentWorkspace();
    const name = workspace?.name || "Choose workspace";
    document.getElementById("workspace-name-current").textContent = name;
    document.getElementById("workspace-mark").textContent = name.slice(0, 2).toUpperCase();
    workspaceTrigger.setAttribute("aria-label", "Switch workspace, " + name);
    workspaceTrigger.disabled = workspaceSelect.disabled;
    if (workspaceDialog.open) renderWorkspaceOptions();
  }
  function renderWorkspaceOptions() {
    const query = workspaceSearch.value.trim().toLocaleLowerCase();
    const matches = state.workspaces.filter(workspace => (workspace.name + " " + workspace.slug).toLocaleLowerCase().includes(query));
    workspaceOptions.innerHTML = matches.map(workspace => {
      const current = workspace.slug === currentSlug();
      return '<li><button type="button" class="workspace-option" data-workspace="' + escapeHtml(workspace.slug) + '"' + (current ? ' aria-current="true"' : '') + '><span class="workspace-mark" aria-hidden="true">' + escapeHtml(workspace.name.slice(0, 2).toUpperCase()) + '</span><span class="workspace-copy"><strong>' + escapeHtml(workspace.name) + '</strong><small>' + escapeHtml(workspaceRoles[workspace.role] || workspace.role) + '</small></span>' + (current ? ICONS.check : '') + '</button></li>';
    }).join("");
    const empty = document.getElementById("workspace-empty");
    empty.hidden = matches.length > 0;
    empty.textContent = state.workspaces.length ? "No matching workspaces." : "No workspaces yet.";
  }
  function closeWorkspacePicker() { if (workspaceDialog.open) workspaceDialog.close(); }
  workspaceTrigger.addEventListener("click", () => {
    if (workspaceSelect.disabled || workspaceDialog.open) return;
    workspaceSearch.value = ""; renderWorkspaceOptions();
    workspaceDialog.showModal(); workspaceTrigger.setAttribute("aria-expanded", "true");
    // Keep the mobile keyboard closed until the user chooses to search.
    (narrowNav.matches ? document.getElementById("workspace-picker-close") : workspaceSearch).focus({ preventScroll: true });
  });
  workspaceDialog.addEventListener("close", () => { workspaceTrigger.setAttribute("aria-expanded", "false"); });
  workspaceDialog.addEventListener("keydown", event => { if (event.key === "Escape") event.stopPropagation(); });
  workspaceDialog.addEventListener("click", event => {
    if (event.target !== workspaceDialog) return;
    const rect = workspaceDialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeWorkspacePicker();
  });
  document.getElementById("workspace-picker-close").addEventListener("click", closeWorkspacePicker);
  workspaceSearch.addEventListener("input", renderWorkspaceOptions);
  workspaceDialog.addEventListener("keydown", event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [...workspaceOptions.querySelectorAll("button")];
    const index = buttons.indexOf(document.activeElement);
    if (!buttons.length || (index < 0 && event.target !== workspaceSearch)) return;
    if (event.target === workspaceSearch && event.key !== "ArrowDown") return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1 : event.key === "ArrowDown" ? (index + 1) % buttons.length : (index - 1 + buttons.length) % buttons.length;
    buttons[next].focus();
  });
  workspaceOptions.addEventListener("click", event => {
    const button = event.target.closest("[data-workspace]");
    if (!button || workspaceSelect.disabled) return;
    closeWorkspacePicker();
    workspaceSelect.value = button.dataset.workspace;
    workspaceSelect.dispatchEvent(new Event("change"));
  });
  document.getElementById("workspace-picker-create").addEventListener("click", () => { closeWorkspacePicker(); showView("new-workspace"); });
`;
