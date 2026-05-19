import kleur from "kleur";
import { AREA_WILDCARD, PROJECT_WILDCARD } from "../bus.js";
import {
  deriveScope,
  validateAreaFilter,
  validateProjectFilter,
} from "../util/project.js";

export interface ScopeOptions {
  project?: string;
  area?: string;
}

export function resolveProjectScope(value: string | undefined): string | undefined {
  if (value === undefined) return deriveScope().project ?? undefined;
  const normalized = value === "all" ? PROJECT_WILDCARD : value;
  validateProjectFilter(normalized);
  return normalized;
}

export function resolveScopeOptions(project: string | undefined, area: string | undefined): ScopeOptions {
  const derived = deriveScope();
  const resolvedProject =
    project === undefined ? (derived.project ?? undefined) : normalizeProject(project);
  const resolvedArea = area === undefined ? (derived.area ?? undefined) : normalizeArea(area);
  return { project: resolvedProject, area: resolvedArea };
}

export function scopeBanner(scope: ScopeOptions): string | null {
  const parts: string[] = [];
  if (scope.project !== undefined && scope.project !== PROJECT_WILDCARD) {
    parts.push(scope.project);
  }
  if (scope.area !== undefined && scope.area !== AREA_WILDCARD) {
    parts.push(`area=${scope.area}`);
  }
  if (parts.length === 0) return null;
  return kleur.gray(`scoped: ${parts.join(" / ")} (use --project all --area all for global)`);
}

function normalizeProject(value: string): string {
  const normalized = value === "all" ? PROJECT_WILDCARD : value;
  validateProjectFilter(normalized);
  return normalized;
}

function normalizeArea(value: string): string {
  const normalized = value === "all" ? AREA_WILDCARD : value;
  validateAreaFilter(normalized);
  return normalized;
}
