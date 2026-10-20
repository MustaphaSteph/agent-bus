import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexWake } from "../src/cli/wake/codex.js";

if (process.env.AGENT_BUS_LIVE_WAKE_TEST !== "1") throw new Error("Set AGENT_BUS_LIVE_WAKE_TEST=1 to authorize two small real model turns using your Codex login");
const cwd = mkdtempSync(join(tmpdir(), "agent-bus-codex-live-"));
process.env.AGENT_BUS_DIR = join(cwd, "bus");
const local = process.env.AGENT_BUS_LIVE_WAKE_LOCAL === "1";
const bus = await import("../src/bus.js");
const { closeDb } = await import("../src/db.js");
const { listenCloud } = await import("../src/cli/cloud-listen.js");
const { callLocalWake } = await import("../src/cli/wake/local.js");
async function control(method: string, params: Record<string, unknown>): Promise<any> {
  const process = spawn("codex", ["app-server", "--listen", "stdio://"], { cwd, stdio: ["pipe", "pipe", "pipe"] });
  process.stderr.resume();
  let serial = 0;
  const requests = new Map<number, (rpc: any) => void>();
  let finish: ((rpc: any) => void) | undefined;
  createInterface({ input: process.stdout }).on("line", line => { const rpc = JSON.parse(line); if (rpc.id !== undefined) requests.get(rpc.id)?.(rpc); else if (rpc.method === "turn/completed") finish?.(rpc); });
  const request = (method: string, params: Record<string, unknown>) => new Promise<any>((resolve, reject) => {
    const id = ++serial; const timer = setTimeout(() => reject(new Error("Codex control timeout")), 30000);
    requests.set(id, rpc => { clearTimeout(timer); requests.delete(id); rpc.error ? reject(new Error(JSON.stringify(rpc.error))) : resolve(rpc.result); });
    process.stdin.write(JSON.stringify({ id, method, params }) + "\n");
  });
  try {
    await request("initialize", { clientInfo: { name: "agent_bus_live_wake_test", version: "1" } });
    process.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
    const result = await request(method, params);
    if (method === "thread/start") {
      // An empty thread has no durable rollout yet. Seed a harmless first turn
      // before stopping the original host and testing resume on our adapter.
      const done = new Promise<any>((resolve, reject) => { const timer = setTimeout(() => reject(new Error("Seed turn timeout")), 120000); finish = rpc => { clearTimeout(timer); resolve(rpc); }; });
      await request("turn/start", { threadId: result.thread.id, input: [{ type: "text", text: "Authorized isolated integration test. Do not read files or call tools. Reply exactly SEED_OK." }] });
      const completed = await done; assert.equal(completed.params.turn.status, "completed");
      console.log("PASS real Codex test thread seeded and persisted");
    }
    return result;
  } finally { await new Promise<void>(resolve => { process.once("close", () => resolve()); process.kill("SIGKILL"); }); }
}
let thread: string | undefined;
let host: CodexWake | undefined;
try {
  const result = await control("thread/start", { cwd, sandbox: "read-only", approvalPolicy: "untrusted" });
  thread = result.thread.id;
  assert(thread);
  host = new CodexWake({ thread, cwd, sandbox: "read-only" }); await host.start();
  if (local) for (const name of ["test-human", "codex-live"]) bus.register({ name, capabilities: [] });
  let cursor = 0;
  for (const id of [1, 2]) {
    if (id === 2) await new Promise(resolve => setTimeout(resolve, 2000));
    if (local) {
      const original = bus.send({ from: "test-human", to: "codex-live", content: `Authorized isolated integration test. Do not read files or call tools. Reply exactly WAKE_TEST_${id}_OK.` });
      const stop = new AbortController();
      await listenCloud({ agent: "codex-live", cursor, signal: AbortSignal.any([stop.signal, AbortSignal.timeout(180000)]), call: callLocalWake,
        handle: async (message, signal) => {
          const answer = await host!.handle(message, signal); assert(answer.includes(`WAKE_TEST_${id}_OK`), answer);
          bus.wakeReply({ agent: "codex-live", message_id: message.id, claim_token: message.claim_token, message: answer });
        },
        saveCursor: value => { cursor = value; stop.abort(); },
      });
      assert.equal(cursor, original.id);
      assert.equal(bus.inboxStatus({ agent: "codex-live" }).unread.length, 0);
      console.log(`PASS real Codex local SQLite cycle ${id}: woke, replied, acknowledged, checkpointed`);
      continue;
    }
    const reply = await host.handle({ id, claim_token: "local-live-test", claim_deadline: Date.now() + 180000,
      from_agent: "test-human", content: `This is an authorized isolated integration test. Do not read files or call tools. Reply exactly WAKE_TEST_${id}_OK.`, thread_id: "test" }, AbortSignal.timeout(180000));
    assert(reply.includes(`WAKE_TEST_${id}_OK`), reply);
    console.log(`PASS real Codex ${id === 1 ? "resumed thread" : "idle thread woke again"}: expected reply received`);
  }
} finally {
  await host?.close();
  if (thread) await control("thread/archive", { threadId: thread }).catch(() => console.error("Test thread archival failed; no user thread modified"));
  closeDb(); rmSync(cwd, { recursive: true, force: true });
}
