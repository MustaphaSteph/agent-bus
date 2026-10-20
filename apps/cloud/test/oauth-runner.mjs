import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unstable_dev } from "wrangler";
import { testOAuth } from "./oauth.mjs";

const persistTo = mkdtempSync(join(tmpdir(), "agent-bus-oauth-"));
let worker;
try {
  execFileSync("npx", ["wrangler", "d1", "migrations", "apply", "agent-bus-cloud", "--local", "--persist-to", persistTo], { stdio: "pipe", env: { ...process.env, CI: "1" } });
  worker = await unstable_dev("src/worker.ts", { config: "wrangler.toml", local: true, persistTo, logLevel: "error", vars: { AGENT_BUS_CLOUD_ENV: "test", AGENT_BUS_CLOUD_AUTH_SECRET: "isolated-oauth-test-only" }, experimental: { disableExperimentalWarning: true } });
  const response = await worker.fetch("/api/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "oauth@example.com", password: "test-only-password", name: "OAuth Test" }) });
  if (response.status !== 201) throw new Error(await response.text());
  await testOAuth(worker, response.headers.get("set-cookie"));
} finally {
  await worker?.stop();
  rmSync(persistTo, { recursive: true, force: true });
}
