import assert from "node:assert/strict";

// Optional browser coverage for the public landing page. Read-only: no accounts or writes.
export async function testLandingBrowser(origin) {
  const { chromium } = await import(process.env.AGENT_BUS_PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const errors = [];
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 340, height: 900 }]) {
      // Reduced motion stops the typing loop so the test controls every phrase.
      const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
      page.on("pageerror", error => errors.push(`${viewport.width}: ${error.message}`));
      await page.goto(origin + "/");
      await page.locator("#hero-diagram").waitFor();
      assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `landing overflows at ${viewport.width}px`);
      const tops = [];
      const words = (await page.locator("#typed").getAttribute("data-words")).split("|");
      for (const text of [...words, ""]) {
        tops.push(await page.evaluate(value => {
          document.getElementById("typed").textContent = value;
          return document.getElementById("hero-diagram").getBoundingClientRect().top + scrollY;
        }, text));
      }
      assert.equal(new Set(tops.map(Math.round)).size, 1, `typing reflows the hero at ${viewport.width}px: ${tops.join(", ")}`);
      const kicker = await page.locator(".kicker").evaluate(el => ({ fits: el.scrollWidth <= el.clientWidth + 1, right: el.getBoundingClientRect().right }));
      assert(kicker.fits && kicker.right <= viewport.width, `kicker overflows at ${viewport.width}px`);
      if (viewport.width >= 1024) {
        const bottom = await page.locator("#setup-command").evaluate(el => el.getBoundingClientRect().bottom);
        assert(bottom <= viewport.height, `setup command is below the first viewport (${bottom}px)`);
      }
      assert.equal(await page.locator('a[href*="docs/setup.md"]').count(), 0, "landing links to unpublished setup docs");
      // Page length budget: the connect guides live in a drawer, not in the page flow.
      const screens = await page.evaluate(() => document.documentElement.scrollHeight / innerHeight);
      assert(screens <= (viewport.width >= 1024 ? 6.5 : 10.5), `landing is ${screens.toFixed(1)} screens tall at ${viewport.width}px`);
      // Deep links open the matching guide in the drawer.
      await page.goto(origin + "/#connect-chatgpt");
      await page.locator("#guide-drawer[open]").waitFor();
      assert(await page.locator("#connect-chatgpt").isVisible(), "direct links must open the selected guide");
      assert(!await page.locator("#connect-claude").isVisible(), "only the selected guide is shown");
      assert.equal(await page.locator("#oauth-endpoint").textContent(), origin + "/mcp", "OAuth URL must use this deployment's origin");
      assert(!await page.locator("#workspace-address").isVisible(), "OAuth guides do not ask for a workspace token URL");
      await page.getByRole("button", { name: "Copy OAuth MCP URL", exact: true }).click();
      await page.waitForFunction(() => /Copied|Text selected/.test(document.getElementById("drawer-copy-result").textContent));
      await page.keyboard.press("Escape");
      await page.locator("#guide-drawer").waitFor({ state: "hidden" });
      await page.waitForFunction(() => location.hash === "#connect", undefined, { timeout: 2000 }); // close event is async
      // Picking a client opens its guide; the workspace field fills the examples and rejects bad input.
      const gemini = page.locator('.client-pick[href="#connect-gemini-cli"]');
      await gemini.click();
      await page.locator("#connect-gemini-cli").waitFor();
      assert(!await page.locator("#oauth-endpoint").isVisible(), "token guides hide the OAuth connector URL");
      await page.locator("#workspace-address").fill("my-team");
      const config = await page.locator("#config-gemini-cli").textContent();
      assert(config.includes('"httpUrl"') && config.includes(origin + "/mcp/my-team"), "Gemini needs its own HTTP key and the filled workspace URL");
      assert(config.includes("YOUR_AGENT_TOKEN"), "tokens are never filled in");
      await page.locator("#workspace-address").fill("not valid!");
      assert.equal(await page.locator("#workspace-address").getAttribute("aria-invalid"), "true");
      assert((await page.locator("#config-gemini-cli").textContent()).includes("/mcp/YOUR_WORKSPACE"), "invalid addresses are not filled in");
      assert(await page.locator("#guide-drawer").evaluate(el => el.scrollWidth <= el.clientWidth + 1), `drawer overflows at ${viewport.width}px`);
      await page.locator(".drawer-close").click();
      await page.locator("#guide-drawer").waitFor({ state: "hidden" });
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("href")), "#connect-gemini-cli", "focus returns to the chosen client");
      await page.screenshot({ path: `/tmp/agent-bus-connectors-${viewport.width}.png`, fullPage: false });
      await page.close();
    }
    // Themes: follow the system by default; the toggle cycles system -> light -> dark and persists.
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, colorScheme: "light", reducedMotion: "reduce" });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(`theme: ${error.message}`));
    await page.goto(origin + "/");
    const background = () => page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor);
    assert.equal(await background(), "rgb(246, 247, 249)", "system light preference not applied");
    assert(await page.locator('.client-pick[href="#connect-codex"] img[src="/logos/codex.svg"]').isVisible(), "light-background Codex mark hidden in light mode");
    assert(!await page.locator('.client-pick[href="#connect-codex"] img[src="/logos/codex-white.svg"]').isVisible(), "white Codex mark shown on a light tile");
    assert(await page.locator('.setup-bar img[src="/logos/codex-white.svg"]').isVisible(), "dark command bar lost its white Codex mark");
    await page.locator("#theme-toggle").click();
    assert.equal(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem("agent-bus.theme")].join()), "light,light");
    await page.locator("#theme-toggle").click();
    assert.equal(await background(), "rgb(8, 9, 11)", "dark choice did not override the light system preference");
    await page.reload();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark", "theme choice did not persist across reloads");
    assert.equal(await page.locator("#theme-toggle").getAttribute("data-mode"), "dark");
    await page.locator("#theme-toggle").click();
    assert.equal(await page.evaluate(() => localStorage.getItem("agent-bus.theme")), null, "returning to system did not clear the stored choice");
    await context.close();
    assert.deepEqual(errors, [], "landing page errors");
    console.log("landing browser passed: no overflow, stable typing layout, kicker fits, setup action in first viewport, light/dark themes with persistent toggle");
  } finally {
    await browser.close();
  }
}
