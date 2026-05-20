import { spawnSync } from "node:child_process";
import { readScopeConfig } from "./project.js";

export function runLocalHook(event: string, payload: unknown): void {
  const { config, root } = readScopeConfig();
  const hooks = config?.hooks;
  if (hooks === null || typeof hooks !== "object" || Array.isArray(hooks)) return;
  const command = (hooks as Record<string, unknown>)[event];
  if (typeof command !== "string" || command.trim().length === 0) return;
  spawnSync(command, {
    cwd: root ?? process.cwd(),
    shell: true,
    stdio: "ignore",
    env: {
      ...process.env,
      AGENT_BUS_EVENT: event,
      AGENT_BUS_EVENT_JSON: JSON.stringify(payload),
    },
  });
}
