export function normalizeDirectoryText(value: string): string { return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase().trim(); }
export function stableDirectoryJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableDirectoryJson).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).filter(([,v])=>v!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>`${JSON.stringify(key)}:${stableDirectoryJson(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
