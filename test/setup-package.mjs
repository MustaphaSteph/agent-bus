import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = realpathSync(mkdtempSync(join(tmpdir(), "agent-bus-npx-test-")));
try {
  const [packed] = JSON.parse(execFileSync("npm", ["pack", "--pack-destination", root, "--json"], { encoding: "utf8" }));
  const paths = new Set(packed.files.map(file => file.path));
  for (const file of ["dist/cli/setup.js", "skills/agent-bus/SKILL.md", "skills/agent-bus-cloud/SKILL.md", "docs/setup.md"]) {
    assert(paths.has(file), `package missing ${file}`);
  }
  const home = join(root, "home");
  const env = {
    ...process.env, HOME: home, CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: "",
    KIMI_CODE_HOME: join(home, ".kimi-code"), AGENT_BUS_DIR: join(root, "bus"),
    npm_config_cache: join(root, "npm-cache"),
  };
  const output = execFileSync("npx", ["--yes", `--package=${join(root, packed.filename)}`, "agent-bus", "setup",
    "--mode", "local", "--clients", "codex,claude-code,kimi,cursor", "--local-server", resolve("dist/mcp/server.js"), "--yes"],
  { env, encoding: "utf8", timeout: 240000 });
  assert(output.includes("Setup complete"), output);
  assert(readFileSync(join(home, ".codex/skills/agent-bus/SKILL.md"), "utf8").includes("version-pinned"));
  const dryRun = execFileSync("npx", ["--yes", `--package=${join(root, packed.filename)}`, "agent-bus", "setup",
    "--mode", "cloud", "--clients", "codex,kimi", "--url", "https://example.com/mcp/demo", "--dry-run"],
  { env, encoding: "utf8", timeout: 30000 });
  assert(dryRun.includes("Dry run"));
  assert(!dryRun.includes("DRY_RUN_NOT_A_TOKEN"));
  console.log("PASS: packed npm archive installs with npx, bundles both skills, and runs Local setup + Cloud dry-run in an isolated home/cache.");
} finally { rmSync(root, { recursive: true, force: true }); }
