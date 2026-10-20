import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";

assert(process.env.AGENT_BUS_LIVE_CLAUDE_TEST === "1", "Set AGENT_BUS_LIVE_CLAUDE_TEST=1 to authorize two small real Claude turns");
assert(process.stdin.isTTY, "Run in a terminal and review the development-channel consent");
assert(process.env.AGENT_BUS_LIVE_CLAUDE_CWD, "Provide an already trusted test project directory");
const dir = mkdtempSync(join(tmpdir(), "agent-bus-local-claude-"));
process.env.AGENT_BUS_DIR = dir;
const bus = await import("../src/bus.js");
const { getDb, closeDb } = await import("../src/db.js");
for (const name of ["sender", "claude-local"]) bus.register({ name, capabilities: [] });
const config = join(dir, "mcp.json");
writeFileSync(config, JSON.stringify({ mcpServers: { "agent-bus-wake": {
  command: process.execPath, alwaysLoad: true,
  args: [resolve("dist/cli/index.js"), "claude-channel", "--agent", "claude-local"], env: { AGENT_BUS_DIR: dir },
} } }), { mode: 0o600 });
const session = randomUUID();
const child = spawn("claude", ["--session-id", session, "--name", `local-wake-test-${session}`, "--no-chrome", "--permission-mode", "default",
  "--strict-mcp-config", "--mcp-config", config, "--setting-sources", "", "--tools", "", "--disable-slash-commands",
  "--allowedTools", "mcp__agent-bus-wake__channel_complete", "--dangerously-load-development-channels", "server:agent-bus-wake", "--",
  "Authorized isolated local Agent Bus test. Reply READY, then wait for channel events. For each test event call channel_complete with its message_id and the exact reply requested. Do not read files, run commands or perform other work."],
  { cwd: process.env.AGENT_BUS_LIVE_CLAUDE_CWD, stdio: "inherit" });
const closed = new Promise<void>(resolve => child.once("close", () => resolve()));
child.on("error", error => console.error(error.message));
async function until(check: () => boolean, ms: number) {
  const end = Date.now() + ms;
  while (!check()) { assert(child.exitCode === null, "Claude exited"); assert(Date.now() < end, "Claude wake test timed out"); await delay(500); }
}
try {
  console.log("Review only this isolated test channel's startup consent; no tool permissions are bypassed.");
  await until(() => {
    const agent = getDb().prepare("SELECT listening_until FROM agents WHERE name = ?").get("claude-local") as { listening_until: number | null };
    return (agent.listening_until ?? 0) > Date.now();
  }, 90000);
  for (const cycle of [1, 2]) {
    await delay(15000);
    const expected = `LOCAL_CLAUDE_WAKE_${cycle}_OK`;
    const message = bus.send({ from: "sender", to: "claude-local", content: `Authorized wake test. Call channel_complete for this message with reply ${expected}. Do nothing else.` });
    await until(() => {
      const row = getDb().prepare("SELECT delivered_at, replied_at FROM messages WHERE id = ?").get(message.id) as { delivered_at: number | null; replied_at: number | null };
      return !!row.delivered_at && !!row.replied_at;
    }, 120000);
    const reply = getDb().prepare("SELECT content FROM messages WHERE reply_to = ?").get(message.id) as { content: string };
    assert(reply.content.includes(expected));
    console.log(`PASS real Claude local SQLite wake ${cycle}: reply then acknowledgement`);
  }
} finally {
  if (child.exitCode === null) {
    child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 5000); await closed; clearTimeout(timer);
  }
  closeDb(); rmSync(dir, { recursive: true, force: true });
}
