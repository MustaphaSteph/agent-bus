import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, relative, resolve } from "node:path";

const PROJECT_NAME_RE = /^[a-zA-Z0-9_.-]+$/;
const CONFIG_FILE = ".agent-bus.json";

export interface SessionScope {
  project: string | null;
  area: string | null;
}

export interface ScopeConfig {
  project?: unknown;
  areas?: unknown;
  routing?: unknown;
  hooks?: unknown;
}

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
  const configured = readScopeConfig(cwd);
  if (typeof configured.config?.project === "string") {
    const sanitized = sanitize(configured.config.project);
    if (sanitized.length > 0) return sanitized;
  }
  const root = findGitRoot(cwd);
  const raw = root !== null ? basename(root) : basename(cwd);
  const sanitized = sanitize(raw);
  return sanitized.length > 0 ? sanitized : null;
}

export function deriveScope(cwd: string = process.cwd()): SessionScope {
  const configured = readScopeConfig(cwd);
  return {
    project: deriveProject(cwd),
    area: deriveAreaFromConfig(cwd, configured),
  };
}

export function deriveArea(cwd: string = process.cwd()): string | null {
  return deriveAreaFromConfig(cwd, readScopeConfig(cwd));
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

function findConfigRoot(start: string): string | null {
  let current = resolve(start);
  while (true) {
    if (existsSync(`${current}/${CONFIG_FILE}`)) return current;
    const parent = dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

export function scopeConfigPath(cwd: string = process.cwd()): string | null {
  const root = findConfigRoot(cwd);
  return root === null ? null : `${root}/${CONFIG_FILE}`;
}

export function readScopeConfig(cwd: string = process.cwd()): { root: string | null; config: ScopeConfig | null } {
  const root = findConfigRoot(cwd);
  if (root === null) return { root, config: null };
  try {
    const parsed = JSON.parse(readFileSync(`${root}/${CONFIG_FILE}`, "utf8")) as ScopeConfig;
    return { root, config: parsed };
  } catch {
    return { root, config: null };
  }
}

export function writeScopeConfig(config: ScopeConfig, cwd: string = process.cwd()): string {
  const root = findGitRoot(cwd) ?? resolve(cwd);
  const path = `${root}/${CONFIG_FILE}`;
  writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`);
  return path;
}

export function configuredAreas(cwd: string = process.cwd()): Record<string, string[]> {
  const { config } = readScopeConfig(cwd);
  return isAreaMap(config?.areas) ? config.areas : {};
}

function deriveAreaFromConfig(
  cwd: string,
  configured: { root: string | null; config: ScopeConfig | null },
): string | null {
  if (configured.root === null || configured.config === null) return null;
  if (!isAreaMap(configured.config.areas)) return null;

  const rel = normalizePath(relative(configured.root, resolve(cwd)));
  for (const [name, patterns] of Object.entries(configured.config.areas)) {
    const area = sanitize(name);
    if (area.length === 0) continue;
    if (patterns.some((pattern) => matchesPattern(rel, pattern))) return area;
  }
  return null;
}

function isAreaMap(value: unknown): value is Record<string, string[]> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(
    (patterns) =>
      Array.isArray(patterns) && patterns.every((pattern) => typeof pattern === "string"),
  );
}

function normalizePath(value: string): string {
  return value.split("\\").join("/").replace(/^\.\//, "");
}

function matchesPattern(relativePath: string, rawPattern: string): boolean {
  const pattern = normalizePath(rawPattern).replace(/^\/+|\/+$/g, "");
  if (pattern.length === 0) return false;
  if (pattern.endsWith("/**")) {
    const prefix = pattern.slice(0, -3);
    return relativePath === prefix || relativePath.startsWith(`${prefix}/`);
  }
  if (pattern.endsWith("/*")) {
    const prefix = pattern.slice(0, -2);
    return relativePath.startsWith(`${prefix}/`);
  }
  return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
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

export function validateAreaFilter(value: string): void {
  if (value === "*") return;
  if (!PROJECT_NAME_RE.test(value)) {
    throw new Error(
      `invalid area filter '${value}'; must be '*' or match [a-zA-Z0-9_.-]+`,
    );
  }
}
