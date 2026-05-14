import { existsSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const PROJECT_NAME_RE = /^[a-zA-Z0-9_.-]+$/;

/**
 * Derive the project slug for an MCP/CLI session from its cwd.
 *
 * Algorithm:
 *   1. Walk up from cwd looking for a `.git` directory or file. If found,
 *      use the basename of that directory as the project slug.
 *   2. Otherwise, fall back to the basename of cwd itself.
 *   3. Sanitize the result to match the agent/project name regex
 *      `[a-zA-Z0-9_.-]+`. Disallowed chars are stripped.
 *   4. If the sanitized slug is empty, return null (caller treats as
 *      global / NULL project).
 *
 * Pure function. Bus.ts never calls this — adapters (MCP server, CLI)
 * call it and pass the result to bus.ts via the `project` parameter.
 */
export function deriveProject(cwd: string = process.cwd()): string | null {
  const root = findGitRoot(cwd);
  const raw = root !== null ? basename(root) : basename(cwd);
  const sanitized = sanitize(raw);
  return sanitized.length > 0 ? sanitized : null;
}

function findGitRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(`${current}/.git`)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function sanitize(name: string): string {
  return name
    .trim()
    .split("")
    .map((ch) => (PROJECT_NAME_RE.test(ch) ? ch : "-"))
    .join("")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 64);
}

/**
 * Validate a project filter value supplied by a caller. The wildcard
 * "*" passes through; any other value must match the project-name regex.
 */
export function validateProjectFilter(value: string): void {
  if (value === "*") return;
  if (!PROJECT_NAME_RE.test(value)) {
    throw new Error(
      `invalid project filter '${value}'; must be '*' or match [a-zA-Z0-9_.-]+`,
    );
  }
}
