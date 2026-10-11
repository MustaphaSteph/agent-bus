import assert from "node:assert/strict";

export async function testTaskWorkspaceSwitching(page, origin) {
  const workspace = slug => page.locator("#workspace-select").selectOption(slug);
  const view = async name => {
    await page.evaluate(name => { location.hash = name; }, name);
    await page.locator(`[data-view-panel="${name}"]`).waitFor({ state: "visible" });
  };
  await workspace("demo");
  await view("tasks");
  await page.locator("#task-form-panel").evaluate(el => { el.open = true; });
  assert(await page.locator("#action-from").evaluate(el => el.readOnly));
  await page.locator("#action-from").evaluate(el => { el.value = "dot"; });
  await page.locator("#action-team").fill("old-team");
  await page.locator("#task-title").fill("Old workspace draft");
  await page.locator("#task-description").fill("Private old description");
  await page.locator("#task-assignee").fill("chat-codex");
  await page.locator("#task-state").selectOption("backlog");
  await workspace("race-workspace");
  for (const id of ["action-team", "task-title", "task-description", "task-assignee"]) {
    assert.equal(await page.locator("#" + id).inputValue(), "", id + " leaked across workspaces");
  }
  assert.equal(await page.locator("#action-from").inputValue(), "Smoke");
  assert.equal(await page.locator("#task-state").inputValue(), "open");
  await page.locator("#task-title").fill("First human task in empty workspace");
  const created = page.waitForResponse(res => res.url().endsWith("/race-workspace/tasks") && res.request().method() === "POST");
  await page.locator("#create-task-action").click();
  const response = await created;
  assert.equal(response.status(), 201);
  assert.equal(response.request().postDataJSON().requested_by, undefined);
  const task = (await response.json()).result.task;
  assert(task.requested_by.startsWith("human."));
  assert.equal(task.claimed_by, null);
  await page.waitForFunction(() => document.getElementById("action-result").textContent.includes("Created task #"));
  await page.locator("#kanban").getByText("First human task in empty workspace").waitFor();

  // Submission checks the draft's owner even if the selector changed without its change event.
  await page.locator("#task-title").fill("Must not move with the selector");
  await page.locator("#workspace-select").evaluate(el => { el.value = "demo"; });
  let unexpectedWrite = false;
  const watchWrites = request => { if (request.method() === "POST" && request.url().endsWith("/tasks")) unexpectedWrite = true; };
  page.on("request", watchWrites);
  await page.locator("#create-task-action").click();
  assert((await page.locator("#action-result").textContent()).includes("Workspace changed"));
  assert(!unexpectedWrite, "submission sent a draft after its workspace changed");
  page.off("request", watchWrites);

  // Old writes must neither clear a new draft nor change its button/feedback state.
  for (const status of [201, 403]) {
    await workspace("demo");
    await page.locator("#task-title").fill("Delayed old task");
    let release, started;
    const gate = new Promise(resolve => { release = resolve; });
    const requested = new Promise(resolve => { started = resolve; });
    const handler = async route => {
      started(); await gate;
      await route.fulfill({ status, json: status === 201 ? { result: { task: { id: 9876 } } } : { error: { message: "Old task denied" } } });
    };
    await page.route("**/demo/tasks", handler);
    await page.locator("#create-task-action").click(); await requested;
    await workspace("race-workspace");
    await page.locator("#task-title").fill("New draft stays here");
    const finished = page.waitForResponse(res => res.url().endsWith("/demo/tasks"));
    release(); await finished; await page.waitForTimeout(100);
    assert.equal(await page.locator("#task-title").inputValue(), "New draft stays here");
    assert.equal(await page.locator("#action-result").textContent(), "");
    assert(!await page.locator("#create-task-action").isDisabled());
    await page.unroute("**/demo/tasks", handler);
  }

  // Returning to A must also invalidate responses from the previous visit to A.
  for (const endpoint of ["tokens", "members"]) {
    for (const returnToA of [false, true]) {
      await view("tasks"); await workspace("demo");
      let release, started, held = false;
      const gate = new Promise(resolve => { release = resolve; });
      const requested = new Promise(resolve => { started = resolve; });
      const handler = async route => {
        if (held || route.request().method() !== "GET") return route.continue();
        held = true; started(); await gate;
        await route.fulfill({ status: 403, json: { error: { message: "Old workspace denied" } } });
      };
      await page.route(`**/demo/${endpoint}`, handler);
      await view(endpoint === "tokens" ? "connect" : "members"); await requested;
      let loaded = page.waitForResponse(res => res.url().endsWith(`/race-workspace/${endpoint}`));
      await workspace("race-workspace"); await loaded;
      if (returnToA) {
        loaded = page.waitForResponse(res => res.url().endsWith(`/demo/${endpoint}`) && res.status() === 200);
        await workspace("demo"); await loaded;
      }
      const target = page.locator(endpoint === "tokens" ? "#token-list" : "#member-list");
      await page.waitForTimeout(100);
      const before = await target.innerHTML();
      const failed = page.waitForResponse(res => res.url().endsWith(`/demo/${endpoint}`) && res.status() === 403);
      release(); await failed; await page.waitForTimeout(100);
      assert.equal(await target.innerHTML(), before, `stale ${endpoint} failure replaced current contents (return=${returnToA})`);
      assert(await target.isVisible(), `stale ${endpoint} failure hid current panel`);
      await page.unroute(`**/demo/${endpoint}`, handler);
    }
  }
  await workspace("demo");
  console.log("task/workspace browser regressions passed: draft reset, human creation, delayed task success/failure, delayed token/member 403s including A-B-A");
}
