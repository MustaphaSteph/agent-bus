import kleur from "kleur";
import { PROJECT_WILDCARD } from "../bus.js";
import { deriveProject, validateProjectFilter } from "../util/project.js";

export function resolveProjectScope(value: string | undefined): string | undefined {
  if (value === undefined) return deriveProject() ?? undefined;
  const normalized = value === "all" ? PROJECT_WILDCARD : value;
  validateProjectFilter(normalized);
  return normalized;
}

export function scopeBanner(project: string | undefined): string | null {
  if (project === undefined || project === PROJECT_WILDCARD) return null;
  return kleur.gray(`scoped: ${project} (use --project all for global)`);
}
