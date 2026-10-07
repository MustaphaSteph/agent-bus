import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PLACEHOLDER_DATABASE_ID = "00000000-0000-0000-0000-000000000000";

function fail(message) {
  console.error(`Agent Bus Cloud production config check failed: ${message}`);
  process.exit(1);
}

const wranglerPath = resolve("wrangler.toml");
const config = readFileSync(wranglerPath, "utf8");
const databaseId = config.match(/^\s*database_id\s*=\s*"([^"]+)"/m)?.[1];
const envName = config.match(/^\s*AGENT_BUS_CLOUD_ENV\s*=\s*"([^"]+)"/m)?.[1];

if (!databaseId || databaseId === PLACEHOLDER_DATABASE_ID) {
  fail("replace the placeholder D1 database_id in apps/cloud/wrangler.toml before deploying");
}

if (envName !== "production") {
  fail('set AGENT_BUS_CLOUD_ENV = "production" in apps/cloud/wrangler.toml before deploying');
}

console.log("agent-bus cloud production config passed");
