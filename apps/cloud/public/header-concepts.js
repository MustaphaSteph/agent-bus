(() => {
  "use strict";

  const tablist = document.querySelector(".concept-tabs");
  const tabs = Array.from(document.querySelectorAll("[data-concept]"));
  const panels = Array.from(document.querySelectorAll("[data-panel]"));
  if (!tablist || tabs.length !== 3 || panels.length !== 3) return;
  document.documentElement.classList.add("enhanced");

  const select = (index, moveFocus = false) => {
    tabs.forEach((tab, position) => {
      const selected = position === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panels[position].hidden = !selected;
    });
    if (moveFocus) tabs[index].focus();
  };

  const selectedFromLegacyHash = () => {
    return panels.findIndex((panel) => `#concept-${panel.dataset.panel}` === location.hash);
  };

  const selectedFromUrl = () => {
    const legacyIndex = selectedFromLegacyHash();
    if (legacyIndex >= 0) return legacyIndex;
    const concept = new URL(location.href).searchParams.get("concept");
    const index = panels.findIndex((panel) => panel.dataset.panel === concept);
    return index < 0 ? 1 : index;
  };

  const saveSelection = (index) => {
    // Query links retain selection without invoking native fragment scrolling.
    const url = new URL(location.href);
    url.searchParams.set("concept", panels[index].dataset.panel);
    url.hash = "";
    try {
      history.replaceState(null, "", url);
    } catch {
      // Selection still works when the host disallows history changes.
    }
  };

  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-orientation", "horizontal");
  tabs.forEach((tab, index) => {
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", panels[index].id);
    panels[index].setAttribute("role", "tabpanel");
    panels[index].setAttribute("aria-labelledby", tab.id);
    panels[index].tabIndex = 0;

    const activate = (next) => {
      select(next, true);
      saveSelection(next);
    };

    tab.addEventListener("click", (event) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      activate(index);
    });
    tab.addEventListener("keydown", (event) => {
      let next;
      switch (event.key) {
        case "ArrowRight": next = (index + 1) % tabs.length; break;
        case "ArrowLeft": next = (index + tabs.length - 1) % tabs.length; break;
        case "Home": next = 0; break;
        case "End": next = tabs.length - 1; break;
        case " ":
        case "Enter": next = index; break;
        default: return;
      }
      event.preventDefault();
      activate(next);
    });
  });
  select(selectedFromUrl());
  if (selectedFromLegacyHash() >= 0) saveSelection(selectedFromUrl());
  window.addEventListener("hashchange", () => {
    const index = selectedFromLegacyHash();
    if (index >= 0) {
      select(index);
      saveSelection(index);
    }
  });
  window.addEventListener("popstate", () => select(selectedFromUrl()));

  panels.forEach((panel) => {
    const figure = panel.querySelector(".hero-preview");
    const image = panel.querySelector(".concept-image");
    const status = panel.querySelector(".image-status");
    const title = panel.querySelector(".status-title");
    const detail = panel.querySelector(".status-detail");
    const retry = panel.querySelector(".reload-image");
    const download = panel.querySelector(".download-link");
    const source = image.getAttribute("src");
    const label = panel.dataset.panel.toUpperCase();

    const update = (ready) => {
      const retryHadFocus = document.activeElement === retry;
      figure.dataset.imageState = ready ? "ready" : "pending";
      status.hidden = ready;
      download.hidden = !ready;
      retry.hidden = ready;
      retry.removeAttribute("aria-disabled");
      title.textContent = ready ? "" : `Concept ${label} image pending`;
      detail.textContent = ready ? "" : "The asset is not available yet. Reload after it has been added.";
      if (ready && retryHadFocus) download.focus();
    };

    download.hidden = true;
    image.addEventListener("load", () => update(image.naturalWidth > 0));
    image.addEventListener("error", () => update(false));
    retry.addEventListener("click", () => {
      if (figure.dataset.imageState === "loading") return;
      figure.dataset.imageState = "loading";
      title.textContent = `Loading concept ${label}`;
      detail.textContent = "Checking for the generated image.";
      retry.setAttribute("aria-disabled", "true");
      image.src = `${source}?review=${Date.now()}`;
    });
    if (image.complete) update(image.naturalWidth > 0);
  });
})();
