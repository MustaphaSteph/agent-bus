import assert from "node:assert/strict";

export async function testWorkspacePicker(page, browser, origin) {
  const open = page => page.locator("#workspace-trigger").click();
  await open(page);
  await page.locator("#workspace-dialog").waitFor({ state: "visible" });
  assert.equal(await page.locator("#workspace-options [aria-current]").getAttribute("data-workspace"), "demo");
  await page.locator("#workspace-search").fill("no-such-workspace");
  assert(await page.locator("#workspace-empty").isVisible());
  await page.locator("#workspace-search").fill("Race");
  assert.equal(await page.locator(".workspace-option").count(), 1);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  assert.equal(await page.locator("#workspace-select").inputValue(), "race-workspace");
  assert.equal(await page.locator("#workspace-name-current").textContent(), "Race workspace");
  await open(page);
  await page.keyboard.press("Escape");
  await page.locator("#workspace-dialog").waitFor({ state: "hidden" });
  assert.equal(await page.evaluate(() => document.activeElement.id), "workspace-trigger");
  await open(page);
  await page.locator('[data-workspace="demo"]').click();
  await page.waitForFunction(() => !document.getElementById("chat-content").disabled);
  await page.locator("#chat-content").fill("Keep this workspace draft");
  page.once("dialog", dialog => dialog.dismiss());
  await open(page);
  await page.locator('[data-workspace="race-workspace"]').click();
  assert.equal(await page.locator("#workspace-select").inputValue(), "demo");
  assert.equal(await page.locator("#chat-content").inputValue(), "Keep this workspace draft");
  await page.locator("#chat-content").fill("");

  const storageState = await page.context().storageState();
  for (const [width, height] of [[320, 844], [390, 844], [768, 844], [844, 390]]) {
    const context = await browser.newContext({ storageState, viewport: { width, height }, isMobile: true, hasTouch: true, colorScheme: width === 390 ? "dark" : "light" });
    const mobile = await context.newPage();
    try {
      await mobile.goto(origin + "/app");
      await mobile.locator("#workspace-select").selectOption("demo", { force: true });
      await mobile.locator("#nav-toggle").tap();
      await mobile.locator("#workspace-trigger").tap();
      await mobile.locator("#workspace-dialog").waitFor({ state: "visible" });
      assert.equal(await mobile.evaluate(() => document.activeElement.id), "workspace-picker-close", "drawer click stole picker focus");
      await mobile.locator("#workspace-search").tap();
      await mobile.locator("#workspace-search").fill("race");
      assert.equal(await mobile.evaluate(() => document.activeElement.id), "workspace-search");
      await mobile.locator('[data-workspace="race-workspace"]').tap();
      await mobile.locator("#sidebar").waitFor({ state: "hidden" });
      assert.equal(await mobile.locator("#workspace-select").inputValue(), "race-workspace");
      assert.equal(await mobile.evaluate(() => document.getElementById("main").inert), false);
      await mobile.locator("#nav-toggle").tap();
      await mobile.locator("#workspace-trigger").tap();
      await mobile.keyboard.press("Escape");
      assert(await mobile.locator("#sidebar").isVisible(), "picker Escape also closed navigation");
      assert.equal(await mobile.evaluate(() => document.activeElement.id), "workspace-trigger");
      await mobile.locator("#workspace-trigger").tap();
      await mobile.locator("#workspace-search").fill("");
      assert(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "picker horizontal overflow");
      const rect = await mobile.locator("#workspace-dialog").boundingBox();
      assert(rect.x >= 0 && rect.x + rect.width <= width && rect.y >= 0 && rect.y + rect.height <= height + 1);
      assert.equal(Math.round(rect.width), width, "mobile sheet must span the viewport");
      await mobile.screenshot({ path: `/tmp/agent-bus-workspace-picker-${width}.png` });
      await mobile.locator("#workspace-picker-create").tap();
      await mobile.locator("#workspace-name").waitFor({ state: "visible" });
      assert.equal(await mobile.evaluate(() => document.getElementById("main").inert), false);
    } finally { await context.close(); }
  }
  await open(page);
  await page.screenshot({ path: "/tmp/agent-bus-workspace-picker-desktop.png" });
  await page.keyboard.press("Escape");
  console.log("workspace picker passed: search, keyboard, focus, touch switching at 320/390/768px, dismissal and creation");
}
