import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, statSync, symlinkSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse as toml } from "smol-toml";
import { parse as jsonc } from "jsonc-parser";
import { applySetup, CLIENTS, clientPaths, mergeConfig, planSetup, verifySetup, type SetupOptions } from "../src/cli/setup.js";

const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-bus-setup-test-")));
const home = join(root, "home");
const env = { ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), KIMI_CODE_HOME: join(home, ".kimi-code"), CLAUDE_CONFIG_DIR: "", AGENT_BUS_DIR: join(root, "bus") };
const local: SetupOptions = { mode: "local", clients: [...CLIENTS], localServer: resolve("dist/mcp/server.js") };
function cli(args: string[], extra: NodeJS.ProcessEnv = {}) {
  return spawnSync(process.execPath, ["dist/cli/index.js", "setup", ...args], { env: { ...env, ...extra }, encoding: "utf8", timeout: 150000 });
}
try {
  mkdirSync(join(home, ".codex"), { recursive: true });
  const originalToml = '# Keep my comment\nmodel = "existing"\n[mcp_servers.other]\ncommand = "other-command"\n';
  writeFileSync(join(home, ".codex/config.toml"), originalToml);
  writeFileSync(join(home, ".claude.json"), '{\n // preserve this comment\n "other": true, "mcpServers": {"existing": {"command":"other"}}\n}\n');
  const plan = planSetup(local, home, env);
  assert.equal(plan.configs.length, 4);
  assert.equal(readFileSync(join(home, ".codex/config.toml"), "utf8"), originalToml, "planning wrote files");
  const backups = applySetup(plan);
  assert.equal(readFileSync(backups[0]!, "utf8"), originalToml);
  for (const path of backups) assert.equal(statSync(path).mode & 0o777, 0o600);
  const codex = readFileSync(join(home, ".codex/config.toml"), "utf8");
  assert(codex.startsWith(originalToml));
  assert.equal((toml(codex).mcp_servers as any)["agent-bus"].command, process.execPath);
  assert(readFileSync(join(home, ".claude.json"), "utf8").includes("preserve this comment"));
  assert.equal(jsonc(readFileSync(join(home, ".claude.json"), "utf8")).mcpServers["agent-bus"].type, "stdio");
  for (const client of CLIENTS) {
    const paths = clientPaths(client, home, env);
    assert(existsSync(join(paths.skills, "agent-bus/SKILL.md")));
    assert.equal(statSync(paths.config).mode & 0o777, 0o600);
  }
  assert.equal(planSetup(local, home, env).changes.length, 0, "repeat setup was not idempotent");
  assert.throws(() => planSetup({ ...local, localServer: undefined }, home, env), /already differs/);
  assert.throws(() => mergeConfig('{"bad":', {}, "x", false), /Invalid/);
  assert.throws(() => mergeConfig("bad = [", {}, "x", true), /Invalid/);
  assert.throws(() => mergeConfig('{"mcpServers":[]}', {}, "x", false), /must be an object/);
  assert.throws(() => planSetup({ ...local, clients: ["unknown" as any] }, home, env), /Choose clients/);
  assert.throws(() => planSetup({ ...local, name: "../secret" }, home, env), /Server name/);
  const replaced = toml(mergeConfig(codex, { command: "new-command" }, "agent-bus", true, true));
  assert.equal(replaced.model, "existing");
  assert.equal((replaced.mcp_servers as any).other.command, "other-command");
  assert.equal((toml(mergeConfig('mcp_servers = { other = {command="x"} }', {command:"y"}, "new", true)).mcp_servers as any).other.command, "x");
  const race = planSetup({ ...local, name: "second-bus" }, home, env);
  writeFileSync(race.changes[0]!.path, "# concurrent edit\n");
  assert.throws(() => applySetup(race), /changed during setup/);
  const symlinkHome = join(root, "symlink-home");
  mkdirSync(symlinkHome);
  symlinkSync(join(home, ".codex"), join(symlinkHome, ".codex"));
  assert.throws(() => planSetup({ ...local, clients: ["codex"] }, symlinkHome, {}), /symlink/);
  const custom = clientPaths("kimi", home, { KIMI_CODE_HOME: join(root, "kimi-custom") });
  assert.equal(custom.config, join(root, "kimi-custom/mcp.json"));

  let result = cli(["--mode", "local", "--clients", "cursor", "--local-server", local.localServer!, "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes("Dry run"));
  result = cli(["--yes"]);
  assert.notEqual(result.status, 0);
  result = cli(["--mode", "local", "--clients", "cursor", "--local-server", local.localServer!, "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes("Setup complete"));

  const rejected = cli(["--mode", "remote", "--clients", "cursor", "--dry-run"]);
  assert.notEqual(rejected.status, 0);
  assert(rejected.stderr.includes("only local mode"));
  const count = await verifySetup({ options: local, entry: { command: process.execPath, args: [local.localServer!] } });
  assert(count >= 65, `local handshake returned ${count} tools`);
  console.log(`PASS: local MCP handshake (${count} tools), four client adapters, backups, permissions, idempotency, conflicts, dry run, CLI install.`);

  assert(!readdirSync(root).some(name => name.includes("token")));
} finally { rmSync(root, { recursive: true, force: true }); }
