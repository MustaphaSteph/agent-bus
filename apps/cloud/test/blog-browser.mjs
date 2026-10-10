import assert from "node:assert/strict";

export async function testBlogBrowser(origin) {
  const { chromium } = await import(process.env.AGENT_BUS_PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of [340, 390, 768, 1440]) {
      for (const colorScheme of ["light", "dark"]) {
        const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        for (const path of ["/blog", "/blog/connect-claude-code-and-codex", "/blog/messages-vs-tracked-tasks"]) {
          await page.goto(origin + path);
          await page.evaluate(() => document.fonts.ready);
          assert.equal(await page.locator("h1").count(), 1);
          const layout = await page.evaluate(() => {
            const overflowing = [...document.querySelectorAll("main *, .site-header *")].filter((el) => {
              const r = el.getBoundingClientRect();
              return r.width && (r.right > innerWidth + 1 || r.left < -1) && getComputedStyle(el).position !== "absolute";
            }).map((el) => el.tagName + "." + el.className);
            return { overflowing, broken: [...document.images].filter((i) => !i.complete || !i.naturalWidth).length };
          });
          assert.deepEqual(layout.overflowing, [], `${width}/${colorScheme}/${path} overflow`);
          assert.equal(layout.broken, 0);
          if (process.env.AGENT_BUS_BLOG_SCREENSHOTS) await page.screenshot({ path: `/tmp/blog-${width}-${colorScheme}-${path === "/blog" ? "index" : path.split("/").at(-1)}.png`, fullPage: true });
          if (path !== "/blog") {
            const ids = await page.locator(".blog-prose h2[id]").evaluateAll((els) => els.map((el) => el.id));
            for (const id of [...ids, ...ids.slice().reverse()]) {
              await page.evaluate((id) => {
                const heading = document.getElementById(id);
                window.scrollTo({ top: heading.getBoundingClientRect().top + scrollY - 100, behavior: "instant" });
              }, id);
              await page.waitForFunction((id) => document.querySelector('.blog-toc a[aria-current="location"]')?.hash === "#" + id, id);
              assert.equal(await page.locator('.blog-toc a[aria-current="location"]').count(), 1);
              if (width > 860) {
                const top = await page.locator(".blog-toc").evaluate((el) => el.getBoundingClientRect().top);
                assert.ok(Math.abs(top - 100) <= 1, `Sidebar not sticky: ${top}`);
              }
            }
            assert.equal(new URL(page.url()).hash, "", "Reading must not rewrite history");
            if (width > 860) {
              await page.locator(`.blog-toc a[href='#${ids[2]}']`).focus();
              await page.keyboard.press("Enter");
              await page.waitForFunction((id) => document.querySelector('.blog-toc a[aria-current="location"]')?.hash === "#" + id, ids[2]);
              assert.equal(new URL(page.url()).hash, "#" + ids[2]);
              if (process.env.AGENT_BUS_BLOG_SCREENSHOTS) await page.screenshot({ path: `/tmp/blog-scroll-${colorScheme}.png` });
              await page.reload();
              await page.waitForFunction((id) => document.querySelector('.blog-toc a[aria-current="location"]')?.hash === "#" + id, ids[2]);
            }
          }
        }
        if (width < 861) {
          await page.getByRole("button", { name: "Open navigation" }).click();
          await page.locator("#mobile-nav a[href='/blog']").click();
          assert.equal(new URL(page.url()).pathname, "/blog");
        }
        await page.locator("#theme-toggle").click();
        assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
        await page.reload();
        assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
        assert.deepEqual(errors, []);
        await context.close();
      }
    }
    const context = await browser.newContext({ javaScriptEnabled: false });
    const page = await context.newPage();
    await page.goto(origin + "/blog");
    await page.getByRole("link", { name: "Connect Claude Code and Codex in one team", exact: true }).click();
    assert.ok(await page.getByRole("heading", { name: "2. Connect both clients" }).isVisible());
    assert.ok((await page.locator("main").innerText()).includes("npx --package=@agent-bus-connect/cli@latest agent-bus setup"));
    await context.close();
    const xmlContext = await browser.newContext();
    const xmlPage = await xmlContext.newPage();
    await xmlPage.goto(origin + "/blog");
    const xmlResults = await xmlPage.evaluate(async () => {
      const results = [];
      for (const path of ["/sitemap.xml", "/feed.xml"]) {
        const text = await (await fetch(path)).text();
        const doc = new DOMParser().parseFromString(text, "application/xml");
        results.push(doc.querySelectorAll("parsererror").length);
      }
      return results;
    });
    assert.deepEqual(xmlResults, [0, 0]);
    await xmlContext.close();
    console.log("blog browser: 340/390/768/1440, light/dark, navigation, XML and no-JS passed");
  } finally { await browser.close(); }
}
