import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strict as assert } from "node:assert";

const tmp = mkdtempSync(join(tmpdir(), "agent-bus-xp-"));
const env = { ...process.env, AGENT_BUS_DIR: tmp };

function run(args: string[]): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const child = spawn("./node_modules/.bin/tsx", ["src/cli/index.ts", ...args], {
      env,
      cwd: process.cwd(),
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (b) => (out += b.toString()));
    child.stderr.on("data", (b) => (err += b.toString()));
    child.on("close", (code) => {
      if (code !== 0 && err) process.stderr.write(err);
      resolve({ stdout: out, code: code ?? 1 });
    });
  });
}

console.log("agent-bus cross-process smoke test");
console.log(`tmpdir: ${tmp}`);

await run(["register", "--name", "alice", "--capabilities", "frontend", "--replace"]);
await run(["register", "--name", "bob", "--capabilities", "backend", "--replace"]);

await Promise.all([
  run(["inject", "--from", "alice", "--to", "bob", "msg-1"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-2"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-3"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-4"]),
  run(["inject", "--from", "alice", "--to", "bob", "msg-5"]),
]);

const log = await run(["log", "-n", "10"]);
console.log(log.stdout);

const matches = log.stdout.match(/msg-\d/g) ?? [];
const unique = new Set(matches);
assert.equal(unique.size, 5, `expected 5 distinct messages, got ${unique.size}`);

console.log("✓ 5 concurrent writes from separate processes all landed");

rmSync(tmp, { recursive: true, force: true });
