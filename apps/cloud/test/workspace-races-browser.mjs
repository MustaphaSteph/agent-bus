import assert from "node:assert/strict";
import { testTaskWorkspaceSwitching } from "./task-workspace-browser.mjs";

export async function testWorkspaceRaces(page, origin, scope) {
  const selector = value => `[data-chat-scope='${JSON.stringify([value.project, value.area, value.team])}']`;
  const ready = () => page.waitForFunction(() => !document.getElementById("chat-content").disabled);
  const other = { ...scope, project: "different-project" };
  let release;
  let started;
  const gate = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { started = resolve; });
  const delayedChat = async route => {
    if (new URL(route.request().url()).searchParams.get("project") !== other.project) return route.continue();
    started();
    await gate;
    await route.continue();
  };
  await page.route("**/chat?**", delayedChat);
  await page.locator(selector(other)).click();
  await requested;
  assert(!(await page.locator("#team-chat").textContent()).includes("END_OF_REPORT"), "old messages leaked during team loading");
  assert(await page.locator("#chat-content").isDisabled());
  release();
  await ready();
  await page.unroute("**/chat?**", delayedChat);
  await page.locator(selector(scope)).click();
  await ready();

  let releaseSend;
  const sendGate = new Promise(resolve => { releaseSend = resolve; });
  const delayedSend = async route => {
    if (route.request().method() === "POST") await sendGate;
    await route.continue();
  };
  await page.route("**/chat", delayedSend);
  await page.locator("#chat-content").fill("@chat-codex pending send regression");
  await page.locator("#chat-send").click();
  assert(await page.locator(selector(other)).isDisabled(), "team switch enabled during send");
  assert(await page.locator("#workspace-select").isDisabled());
  assert(await page.locator("#workspace-trigger").isDisabled(), "workspace picker enabled during send");
  assert(await page.locator("#create-workspace").isDisabled());
  releaseSend();
  await ready();
  await page.unroute("**/chat", delayedSend);

  // Use browser fetch: Secure cookies work on loopback in Chrome, unlike APIRequestContext.
  const status = await page.evaluate(async () => (await fetch("/api/workspaces", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ slug: "race-workspace", name: "Race workspace" }),
  })).status);
  assert.equal(status, 201);
  await page.reload();
  await page.locator("#workspace-select").selectOption("demo");
  await page.evaluate(() => { location.hash = "connect"; });
  await page.locator("#create-token").waitFor({ state: "visible" });
  let releaseToken;
  let tokenStarted;
  const tokenGate = new Promise(resolve => { releaseToken = resolve; });
  const tokenRequested = new Promise(resolve => { tokenStarted = resolve; });
  const delayedToken = async route => {
    if (route.request().method() !== "POST") return route.continue();
    tokenStarted();
    await tokenGate;
    await route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ token: { token: "test-only-delayed-token" } }) });
  };
  await page.route("**/tokens", delayedToken);
  await page.locator("#create-token").click();
  await tokenRequested;
  await page.locator("#workspace-select").selectOption("race-workspace");
  const tokenResponse = page.waitForResponse(res => res.request().method() === "POST" && res.url().endsWith("/tokens"));
  releaseToken();
  await tokenResponse;
  await page.waitForTimeout(150);
  assert(!await page.locator("#token-reveal").isVisible(), "delayed secret appeared in another workspace");
  assert.equal(await page.locator("#token-output").textContent(), "");
  await page.unroute("**/tokens", delayedToken);
  await testTaskWorkspaceSwitching(page, origin);
  await page.locator("#workspace-select").selectOption("demo");
  await page.evaluate(() => { location.hash = "chat"; });
  await page.locator(selector(scope)).click();
  await ready();
  console.log("workspace switching regressions passed: loading isolation, send lock, delayed token isolation");
}
