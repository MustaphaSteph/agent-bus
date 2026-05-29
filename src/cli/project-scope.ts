import kleur from "kleur";
import { AREA_WILDCARD, PROJECT_WILDCARD, TEAM_WILDCARD } from "../bus.js";
import {
  deriveScope,
  validateAreaFilter,
  validateProjectFilter,
} from "../util/project.js";

export interface ScopeOptions {
  project?: string;
  area?: string;
  team?: string;
}

export function resolveProjectScope(value: string | undefined): string | undefined {
  if (value === undefined) return deriveScope().project ?? undefined;
  const normalized = value === "all" ? PROJECT_WILDCARD : value;
  validateProjectFilter(normalized);
  return normalized;
}

export function resolveScopeOptions(project: string | undefined, area: string | undefined, team?: string): ScopeOptions {
  const derived = deriveScope();
  const resolvedProject =
    project === undefined ? (derived.project ?? undefined) : normalizeProject(project);
  const resolvedArea = area === undefined ? (derived.area ?? undefined) : normalizeArea(area);
  const resolvedTeam = team === undefined ? undefined : normalizeTeam(team);
  return { project: resolvedProject, area: resolvedArea, team: resolvedTeam };
}

export function scopeBanner(scope: ScopeOptions): string | null {
  const parts: string[] = [];
  if (scope.project !== undefined && scope.project !== PROJECT_WILDCARD) {
    parts.push(scope.project);
  }
  if (scope.area !== undefined && scope.area !== AREA_WILDCARD) {
    parts.push(`area=${scope.area}`);
  }
  if (scope.team !== undefined && scope.team !== TEAM_WILDCARD) {
    parts.push(`team=${scope.team}`);
  }
  if (parts.length === 0) return null;
  return kleur.gray(`scoped: ${parts.join(" / ")} (use --project all --area all --team all for global)`);
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

function normalizeTeam(value: string): string {
  const normalized = value === "all" ? TEAM_WILDCARD : value;
  validateProjectFilter(normalized);
  return normalized;
}
