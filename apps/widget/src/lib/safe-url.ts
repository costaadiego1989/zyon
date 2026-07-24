export function safeExternalUrl(url: string | null | undefined): string | undefined {
  if (!url?.trim() || typeof window === "undefined") return undefined;
  try {
    const parsed = new URL(url, window.location.origin);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return parsed.href;
  } catch {
    return undefined;
  }
}

export function safeOrigin(url: string | null | undefined): string | undefined {
  if (!url?.trim()) return undefined;
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    return parsed.origin;
  } catch {
    return undefined;
  }
}
