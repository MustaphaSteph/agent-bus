import assert from "node:assert/strict";
import { testPng } from "./attachments.mjs";

export async function testAttachmentBrowser(page, origin) {
  const waitReady = () => page.waitForFunction(() => !document.getElementById("chat-send").disabled);
  const file = { name: 'notes-"<review>.md', mimeType: "text/markdown", buffer: Buffer.from("# Review\nCheck the attachment workflow.") };
  let fail = true;
  const uploadRoute = async route => {
    if (fail) { fail = false; await route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { message: "Upload interrupted." } }) }); }
    else await route.continue();
  };
  await page.route("**/files?**", uploadRoute);
  await page.locator("#chat-files").setInputFiles(file);
  await page.locator("[data-file-retry]").waitFor();
  assert(await page.locator("#chat-send").isDisabled(), "failed file was sendable");
  assert((await page.locator("#chat-draft-files").innerText()).includes(file.name), "filename not rendered as text");
  await page.locator("[data-file-retry]").click();
  await waitReady();
  await page.unroute("**/files?**", uploadRoute);
  await page.locator("#chat-content").fill("@missing-agent keep the uploaded file");
  await page.locator("#chat-send").click();
  await page.waitForFunction(() => document.getElementById("chat-feedback").classList.contains("error"));
  assert.equal(await page.locator("#chat-draft-files .file-card").count(), 1, "send failure discarded attachment");
  await page.locator("#chat-content").fill("");
  await page.locator("#chat-send").click();
  await page.waitForFunction(() => !document.querySelector("#chat-draft-files .file-card"));
  const download = page.locator(".msg .file-name").filter({ hasText: file.name });
  await download.waitFor();
  const downloadResponse = await page.request.get(origin + await download.getAttribute("href"));
  assert.equal(await downloadResponse.text(), file.buffer.toString());

  await page.locator("#chat-content").evaluate((input, base64) => {
    const data = new DataTransfer();
    data.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], "pasted-image.png", { type: "image/png" }));
    input.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, testPng.toString("base64"));
  await waitReady();
  await page.locator("#chat-send").click();
  await page.waitForFunction(() => [...document.querySelectorAll('.file-preview img')].some(image => image.alt === 'pasted-image.png' && image.naturalWidth > 0));
  await page.reload();
  await page.locator("#workspace-select").selectOption("demo");
  await page.waitForFunction(() => !document.getElementById("chat-content").disabled);
  // Reload may select another team; return to the conversation containing the sent files.
  await page.locator('[data-chat-scope=\'["chat-project","ui","human-chat-test"]\']').click();
  await page.waitForFunction(() => [...document.querySelectorAll('.file-preview img')].some(image => image.alt === 'pasted-image.png' && image.naturalWidth > 0));

  await page.locator(".human-chat").evaluate(el => {
    const data = new DataTransfer();
    data.items.add(new File(["remove me"], "discard.txt", { type: "text/plain" }));
    el.dispatchEvent(new DragEvent("drop", { dataTransfer: data, bubbles: true, cancelable: true }));
  });
  await waitReady();
  const removed = page.waitForResponse(response => response.request().method() === "DELETE" && response.url().includes("/files/"));
  await page.locator("[data-file-remove]").click();
  const removedResponse = await removed;
  assert.equal(removedResponse.status(), 200);
  assert.equal((await page.request.get(removedResponse.url())).status(), 404);
  await page.locator("#chat-files").setInputFiles({ name: "too-large.zip", mimeType: "application/zip", buffer: Buffer.alloc(10485761) });
  assert((await page.locator("#chat-feedback").textContent()).includes("10 MB"));
  assert.equal(await page.locator("#chat-draft-files .file-card").count(), 0);
  await page.locator("#chat-files").setInputFiles({ name: "Next steps.md", mimeType: "text/markdown", buffer: Buffer.from("# Next steps\nReview the design.") });
  await waitReady();
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(400);
    await page.locator("#team-chat").evaluate(el => { el.scrollTop = el.scrollHeight; });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "attachments caused page overflow");
    await page.locator(".human-chat").screenshot({ path: `/tmp/agent-bus-attachments-${width}.png`, animations: "disabled" });
  }
  await page.locator("[data-file-remove]").click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  console.log("attachment browser passed: upload retry, escaped filenames, draft preservation, file-only send, image paste, downloads, reload, drop/remove, limits, and responsive layout");
}
