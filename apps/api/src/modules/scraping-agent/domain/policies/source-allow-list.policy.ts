export type SourceAllowListResult =
  | { allowed: true }
  | { allowed: false; reason: "SOURCE_NOT_ALLOWED"; source: string };

export function checkSourceAllowList(source: string, allowedSources: string[]): SourceAllowListResult {
  if (!allowedSources.includes(source)) {
    return { allowed: false, reason: "SOURCE_NOT_ALLOWED", source };
  }
  return { allowed: true };
}

export function filterAllowedSources(requested: string[], allowed: string[]): string[] {
  return requested.filter((s) => allowed.includes(s));
}
