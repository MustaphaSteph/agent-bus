export type ChatScope = { team: string; project: string | null; area: string | null };

export function scopeFrom(input: Record<string, unknown>): ChatScope {
  if (typeof input.team !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(input.team)) throw new Error("Choose a team before sending.");
  for (const field of ["project", "area"] as const) {
    if (input[field] !== null && input[field] !== undefined &&
        (typeof input[field] !== "string" || !/^[a-zA-Z0-9_.-]{1,64}$/.test(input[field] as string))) throw new Error(`Invalid ${field}.`);
  }
  return { team: input.team, project: (input.project as string) || null, area: (input.area as string) || null };
}
