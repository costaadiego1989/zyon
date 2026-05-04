export function normalizeEmbedOrigin(raw: string): string {
  return raw.trim().replace(/\/+$/, "");
}
