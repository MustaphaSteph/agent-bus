import assert from "node:assert/strict";

// Optional browser coverage. Uses temporary smoke-test accounts and storage only.
export async function testHumanChatBrowser({ origin, scope, rpc }) {
  const { chromium } = await import(process.env.AGENT_BUS_PLAYWRIGHT_PATH || "playwright");
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  const wait = expression => page.waitForFunction(expression, undefined, { timeout: 15000 });
  try {
    await page.goto(origin + "/app");
    await page.locator("#email").fill("smoke@example.com");
    await page.locator("#password").fill("change-me-please");
    await page.locator("#login").click();
    await wait("document.querySelector('[data-chat-scope]') !== null");
    await page.locator(`[data-chat-scope='${JSON.stringify([scope.project, scope.area, scope.team])}']`).click();
    await wait(`document.getElementById('chat-title-text').textContent === ${JSON.stringify(scope.team)} && !document.getElementById('chat-content').disabled`);
    await page.locator("#theme-toggle").click();
    assert.equal(await page.evaluate(() => [document.documentElement.dataset.theme, getComputedStyle(document.body).backgroundColor].join()), "light,rgb(247, 248, 250)", "app light theme");
    await page.locator("#theme-toggle").click();
    await page.locator("#theme-toggle").click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme ?? "system"), "system", "app theme toggle did not return to system");
    await page.locator("#chat-content").fill("Browser check @chat-cl");
    await page.locator("#chat-mentions").waitFor({ state: "visible" });
    await page.locator("#chat-content").press("Enter");
    assert((await page.locator("#chat-content").inputValue()).includes("@chat-claude "));
    assert.equal(await page.locator("#chat-audience").textContent(), "To @chat-claude");
    await page.locator("#chat-send").click();
    await wait("document.getElementById('chat-feedback').textContent.includes('Queued for @chat-claude')");
    const inbox = await rpc("inbox", { agent: "chat-claude", team: scope.team });
    const message = inbox.messages.find(item => item.content.includes("Browser check"));
    assert(message, "browser message was not delivered to the agent");
    const reply = await rpc("reply", { from: "chat-claude", message_id: message.id, message: "Browser roundtrip confirmed." });
    await wait("document.getElementById('team-chat').textContent.includes('Browser roundtrip confirmed.')");
    await page.locator(`[data-chat-reply="${reply.id}"]`).click();
    await page.locator("#chat-content").fill("Thank you, continue.");
    await page.locator("#chat-send").click();
    await wait("document.getElementById('chat-content').value === ''");
    assert(!await page.locator("#chat-reply-context").isVisible(), "sent reply context remained visible");
    await page.locator("#chat-content").fill("Enter sends this @chat-codex");
    await page.locator("#chat-content").press("Escape");
    await page.locator("#chat-content").press("Enter");
    await wait("document.getElementById('chat-feedback').textContent.includes('Queued for @chat-codex')");
    assert.equal(await page.locator("#chat-content").inputValue(), "", "Enter did not send on desktop");
    const followup = await rpc("inbox", { agent: "chat-claude", team: scope.team });
    assert(followup.messages.some(item => item.content === "Thank you, continue." && item.thread_id === message.thread_id));
    await page.locator("#chat-content").fill("@missing-agent keep this draft");
    await page.locator("#chat-send").click();
    await wait("document.getElementById('chat-feedback').classList.contains('error')");
    assert.equal(await page.locator("#chat-content").inputValue(), "@missing-agent keep this draft");
    const long = await rpc("reply", { from: "chat-claude", message_id: message.id, message: "Full report ".repeat(500) + "END_OF_REPORT" });
    await page.locator("#refresh-chat").click();
    await page.locator(`[data-chat-full="${long.id}"]`).click();
    await wait("document.getElementById('team-chat').textContent.includes('END_OF_REPORT')");
    await page.locator("#refresh-chat").click();
    await page.waitForTimeout(1000);
    assert((await page.locator("#team-chat").textContent()).includes("END_OF_REPORT"));
    await page.locator("#chat-content").fill("");
    await page.evaluate(() => { document.getElementById("team-chat").scrollTop = 0; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "desktop overflow");
    await page.locator(".human-chat").screenshot({ path: "/tmp/agent-bus-human-chat-desktop.png" });
    await page.setViewportSize({ width: 390, height: 844 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "mobile overflow");
    await page.locator(".human-chat").screenshot({ path: "/tmp/agent-bus-human-chat-mobile.png" });
    await page.locator("#sidebar").waitFor({ state: "hidden", timeout: 2000 }); // mobile navigation starts closed
    await page.locator("#details-toggle").click();
    await page.locator("#details-close").waitFor({ state: "visible" });
    assert.equal(await page.evaluate(() => document.activeElement?.id), "details-close", "details sheet did not take focus");
    await page.keyboard.press("Escape");
    await page.locator("#details").waitFor({ state: "hidden" });
    await page.locator("#nav-toggle").click();
    await page.locator("#logout").waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await page.locator("#sidebar").waitFor({ state: "hidden" });
    await page.locator("#nav-toggle").click();
    await page.locator("#logout").click();
    await page.locator("#email").fill("chat-viewer@example.com");
    await page.locator("#password").fill("test-password-only");
    await page.locator("#login").click();
    await page.locator("#chat-content").waitFor();
    await wait("document.getElementById('chat-access').textContent === 'Read-only'");
    assert(await page.locator("#chat-content").isDisabled());
    assert(await page.locator("#chat-send").isDisabled());
    assert.deepEqual(errors, [], "browser errors");
    console.log("human chat browser passed: conversation list, mentions, send/reply, Enter to send, refresh, draft recovery, full reports, responsive layouts, mobile drawer and details sheet, and viewer controls");
  } catch (error) {
    await page.screenshot({ path: "/tmp/agent-bus-human-chat-failure.png" });
    console.error("browser page errors:", errors);
    throw error;
  } finally {
    await browser.close();
  }
}
