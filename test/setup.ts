import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, realpathSync, existsSync, statSync, symlinkSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { parse as toml } from "smol-toml";
import { parse as jsonc } from "jsonc-parser";
import { applySetup, CLIENTS, clientPaths, mergeConfig, planSetup, validateEndpoint, verifySetup, type SetupOptions } from "../src/cli/setup.js";

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
  for (const url of ["https://u:secret@example.com/mcp/demo", "http://example.com/mcp/demo", "https://example.com/mcp/demo?token=secret", "https://example.com/", "file:///mcp/demo"]) {
    assert.throws(() => validateEndpoint(url));
  }
  assert.equal(validateEndpoint("http://127.0.0.1:1234/mcp/demo"), "http://127.0.0.1:1234/mcp/demo");
  const cloud: SetupOptions = { mode: "cloud", clients: [...CLIENTS], url: "https://example.com/mcp/demo", token: "private-test-token" };
  applySetup(planSetup(cloud, home, env));
  const cloudToml = toml(readFileSync(join(home, ".codex/config.toml"), "utf8"));
  assert.equal((cloudToml.mcp_servers as any)["agent-bus-cloud"].http_headers.Authorization, "Bearer private-test-token");
  assert((cloudToml.mcp_servers as any)["agent-bus"], "cloud removed local entry");
  assert.equal(planSetup(cloud, home, env).changes.length, 0);
  const race = planSetup({ ...cloud, token: "rotated", replace: true }, home, env);
  writeFileSync(race.changes[0]!.path, "# concurrent edit\n");
  assert.throws(() => applySetup(race), /changed during setup/);
  assert(readFileSync(join(home, ".claude.json"), "utf8").includes("private-test-token"));
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
  result = cli(["--mode", "cloud", "--clients", "cursor", "--url", "https://example.com/mcp/another", "--replace", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert(!result.stdout.includes("DRY_RUN_NOT_A_TOKEN"));
  result = cli(["--mode", "cloud", "--clients", "cursor", "--url", "https://example.com/mcp/demo", "--token-env", "UNSET_SETUP_TEST_TOKEN", "--yes"], { UNSET_SETUP_TEST_TOKEN: "" });
  assert.notEqual(result.status, 0);
  result = cli(["--mode", "local", "--clients", "cursor", "--local-server", local.localServer!, "--yes"]);
  assert.equal(result.status, 0, result.stderr);
  assert(result.stdout.includes("Setup complete"));

  const count = await verifySetup({ options: local, entry: { command: process.execPath, args: [local.localServer!] } });
  assert(count >= 65, `local handshake returned ${count} tools`);
  console.log(`PASS: local MCP handshake (${count} tools), four client adapters, backups, permissions, idempotency, conflicts, dry run, CLI install.`);

  let role = "agent", redirect = false, authSeen = false, hang = false;
  const server = createServer(async (req, res) => {
    if (hang) { res.writeHead(202); res.end(); return; }
    if (redirect) { res.writeHead(302, { location: "/stolen" }); res.end(); return; }
    if (req.headers.authorization !== "Bearer test-token") { res.writeHead(401); res.end("invalid test-token"); return; }
    authSeen = true;
    if (req.method !== "POST") { res.writeHead(405); res.end(); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    if (body.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = body.method === "initialize"
      ? { protocolVersion: "2025-03-26", capabilities: { tools: {} }, serverInfo: { name: "setup-test", version: "1" } }
      : body.method === "tools/list"
        ? { tools: ["register", "inbox", "send", "cloud_workspace"].map(name => ({ name, inputSchema: { type: "object" } })) }
        : { content: [{ type: "text", text: JSON.stringify({ workspace: "demo", role }) }] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result }));
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address() as { port: number };
    const options: SetupOptions = { ...cloud, url: `http://127.0.0.1:${address.port}/mcp/demo`, token: "test-token" };
    const verify = (token = "test-token") => verifySetup({ options, entry: { url: options.url, headers: { Authorization: `Bearer ${token}` } } });
    assert.equal(await verify(), 4);
    assert(authSeen);
    await assert.rejects(verify("invalid"), error => !String(error).includes("test-token") && String(error).includes("verification failed"));
    role = "viewer";
    await assert.rejects(verify(), /verification failed/);
    redirect = true;
    await assert.rejects(verify(), /verification failed/);
    redirect = false;
    hang = true;
    await assert.rejects(verifySetup({ options, entry: { url: options.url, headers: { Authorization: "Bearer test-token" } } }, 300), /verification failed/);
    console.log("PASS: HTTP MCP handshake, workspace verification, rejected invalid/read-only tokens, no redirect credential forwarding.");
  } finally {
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  assert(!readdirSync(root).some(name => name.includes("token")));
} finally { rmSync(root, { recursive: true, force: true }); }
