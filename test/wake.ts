import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChannelReceipt } from "../src/cli/wake/channel.js";
import { CodexWake } from "../src/cli/wake/codex.js";

let count = 0;
async function test(name: string, run: () => Promise<void>) { await run(); console.log("PASS " + name); count++; }
await test("channel notification is not completion; unrelated IDs cannot acknowledge", async () => {
  const receipts = new ChannelReceipt(); const signal = new AbortController(); let notified = false; let finished = false;
  const handling = receipts.handle({ id: 1, claim_token: "test", claim_deadline: Date.now() + 300000 }, signal.signal, async () => { notified = true; }).then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve)); assert(notified); assert(!finished);
  assert.throws(() => receipts.complete(2)); receipts.complete(1); await handling; assert(finished);
  assert.throws(() => receipts.complete(1));
});
await test("channel disconnect/timeout leaves work uncompleted", async () => {
  const receipts = new ChannelReceipt(); const signal = new AbortController();
  const handling = receipts.handle({ id: 1, claim_token: "test", claim_deadline: 1 }, signal.signal, async () => {});
  signal.abort(); await assert.rejects(handling); assert.throws(() => receipts.complete(1));
});
await test("failed channel write clears in-flight receipt", async () => {
  const receipts = new ChannelReceipt();
  await assert.rejects(receipts.handle({ id: 1, claim_token: "test", claim_deadline: 1 }, new AbortController().signal, async () => { throw new Error("closed"); }));
  assert.throws(() => receipts.complete(1));
});
const cwd = mkdtempSync(join(tmpdir(), "agent-bus-wake-test-"));
try {
  for (const mode of ["success", "wrong-cwd", "busy", "approval", "failed", "hang"]) {
    await test(`Codex binding/turn: ${mode}`, async () => {
      const host = new CodexWake({ thread: "test-thread", cwd, sandbox: "read-only", executable: process.execPath,
        args: [new URL("./fixtures/codex-wake.mjs", import.meta.url).pathname, mode] });
      try {
        if (["wrong-cwd", "busy"].includes(mode)) return await assert.rejects(host.start());
        await host.start();
        const result = host.handle({ id: 1, claim_token: "test", claim_deadline: Date.now() + 300000 }, AbortSignal.timeout(mode === "hang" ? 100 : 5000));
        if (mode === "success") assert.equal(await result, "Handled test message.");
        else await assert.rejects(result);
      } finally { await host.close(); }
    });
  }
} finally { rmSync(cwd, { recursive: true, force: true }); }
console.log(`${count} native wake adapter scenarios passed`);
