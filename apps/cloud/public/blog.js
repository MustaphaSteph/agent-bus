(() => {
  "use strict";
  const toc = document.querySelector(".blog-toc");
  if (!toc) return;
  const entries = [...toc.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, heading: document.getElementById(link.hash.slice(1)) }))
    .filter((entry) => entry.heading);
  if (!entries.length) return;
  let active;
  let scheduled = false;

  function update() {
    scheduled = false;
    // Match native anchor positioning (root scroll padding plus heading margin).
    const offset = (parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0)
      + (parseFloat(getComputedStyle(entries[0].heading).scrollMarginTop) || 0) + 2;
    let current = entries[0];
    for (const entry of entries) {
      if (entry.heading.getBoundingClientRect().top > offset) break;
      current = entry;
    }
    if (active === current) return;
    active = current;
    for (const entry of entries) {
      if (entry === current) entry.link.setAttribute("aria-current", "location");
      else entry.link.removeAttribute("aria-current");
    }
    // Only scroll the sidebar itself; never move the article or keyboard focus.
    if (getComputedStyle(toc).position === "sticky") {
      const bounds = toc.getBoundingClientRect();
      const link = current.link.getBoundingClientRect();
      if (link.bottom > bounds.bottom) toc.scrollTop += link.bottom - bounds.bottom;
      else if (link.top < bounds.top) toc.scrollTop -= bounds.top - link.top;
    }
  }
  function schedule() {
    if (!scheduled) { scheduled = true; requestAnimationFrame(update); }
  }
  addEventListener("scroll", schedule, { passive: true });
  addEventListener("resize", schedule);
  addEventListener("hashchange", schedule);
  addEventListener("pageshow", schedule);
  new ResizeObserver(schedule).observe(document.querySelector(".blog-reader"));
  document.fonts.ready.then(schedule);
  update();
})();
