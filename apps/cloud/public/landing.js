(() => {
  "use strict";
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");

  // Theme: system by default; an explicit choice is shared with the app via localStorage.
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
    document.getElementById("theme-color")?.setAttribute("content", effective === "light" ? "#f6f7f9" : "#08090b");
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

  // Mobile navigation.
  const menuButton = document.querySelector(".menu-toggle");
  const menu = document.getElementById("mobile-nav");
  function setMenu(open) {
    menu.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
  }
  menuButton.addEventListener("click", () => setMenu(menuButton.getAttribute("aria-expanded") !== "true"));
  menu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !menu.hidden) { setMenu(false); menuButton.focus(); }
  });
  matchMedia("(min-width: 861px)").addEventListener("change", () => setMenu(false));

  // Header border once the page scrolls.
  const header = document.getElementById("site-header");
  const onScroll = () => header.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // Copy buttons share one handler and announce the result.
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-copy-target]");
    if (!button) return;
    const source = document.getElementById(button.dataset.copyTarget);
    const label = button.querySelector("span");
    const status = document.getElementById(button.dataset.copyTarget === "setup-command" ? "setup-copy-result" : "prompt-copy-result");
    try {
      await navigator.clipboard.writeText(source.textContent.trim());
      button.classList.add("copied");
      if (label) label.textContent = "Copied";
      if (status) status.textContent = "Copied to clipboard.";
      setTimeout(() => { button.classList.remove("copied"); if (label) label.textContent = "Copy"; }, 1800);
    } catch {
      const range = document.createRange();
      range.selectNodeContents(source);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      if (status) status.textContent = "Text selected. Press Ctrl+C or Cmd+C to copy.";
    }
  });

  // Typed phrase in the hero. The full sentence is available to screen readers separately.
  const typed = document.getElementById("typed");
  if (typed && !reducedMotion.matches) {
    const words = typed.dataset.words.split("|");
    let word = 0;
    let length = words[0].length;
    let deleting = true;
    let paused = false;
    const tick = () => {
      if (document.hidden || paused) { setTimeout(tick, 400); return; }
      const current = words[word];
      if (deleting) {
        length -= 1;
        if (length <= 0) { deleting = false; word = (word + 1) % words.length; }
      } else {
        length += 1;
        if (length >= words[word].length) { deleting = true; typed.textContent = words[word]; setTimeout(tick, 2200); return; }
      }
      typed.textContent = (deleting ? current : words[word]).slice(0, Math.max(0, length));
      setTimeout(tick, deleting ? 28 : 55);
    };
    setTimeout(tick, 2600);
    reducedMotion.addEventListener("change", () => { paused = reducedMotion.matches; if (paused) typed.textContent = words[0]; });
  }

  // Connector lines between agents, the hub and the workspace tiles.
  const diagram = document.getElementById("hero-diagram");
  const svg = diagram?.querySelector(".diagram-lines");
  function curve(x1, y1, x2, y2) {
    const dx = Math.max(24, (x2 - x1) * 0.5);
    return "M" + x1 + " " + y1 + " C" + (x1 + dx) + " " + y1 + ", " + (x2 - dx) + " " + y2 + ", " + x2 + " " + y2;
  }
  function drawConnectors() {
    if (!svg || getComputedStyle(svg).display === "none") return;
    const box = diagram.getBoundingClientRect();
    const hub = diagram.querySelector(".hub").getBoundingClientRect();
    const hubY = hub.top + hub.height / 2 - box.top;
    const lines = [];
    const agents = [...diagram.querySelectorAll(".agent-card")];
    agents.forEach((card, index) => {
      const rect = card.getBoundingClientRect();
      const spread = (index - (agents.length - 1) / 2) * 10;
      lines.push(curve(rect.right - box.left, rect.top + rect.height / 2 - box.top, hub.left - box.left, hubY + spread));
    });
    const tiles = [...diagram.querySelectorAll(".tile")];
    const rows = [...new Set(tiles.map((tile) => Math.round(tile.getBoundingClientRect().top)))];
    rows.forEach((top, index) => {
      const tile = tiles.find((item) => Math.round(item.getBoundingClientRect().top) === top);
      const rect = tile.getBoundingClientRect();
      const spread = (index - (rows.length - 1) / 2) * 10;
      lines.push(curve(hub.right - box.left, hubY + spread, rect.left - box.left, rect.top + rect.height / 2 - box.top));
    });
    svg.setAttribute("viewBox", "0 0 " + box.width + " " + box.height);
    svg.innerHTML = lines.map((d, index) =>
      '<path d="' + d + '"/><path class="pulse" pathLength="100" style="animation-delay:' + (index * 0.45).toFixed(2) + 's" d="' + d + '"/>').join("");
  }
  if (diagram) {
    new ResizeObserver(() => requestAnimationFrame(drawConnectors)).observe(diagram);
    document.fonts?.ready.then(drawConnectors);
  }
})();
