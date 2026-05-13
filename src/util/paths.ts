import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";

export function busDir(): string {
  const override = process.env.AGENT_BUS_DIR;
  const dir = override && override.length > 0 ? override : join(homedir(), ".agent-bus");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function dbPath(): string {
  return join(busDir(), "bus.db");
}
