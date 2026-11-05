/** A display excerpt of published copy, never a generated product claim. */
export function publicProductSummary(description: unknown, limit = 200): string {
  const text = typeof description === "string" ? description
    .replace(/<\s*(script|style)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi, "")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, " ").trim() : "";
  if (!text) return "Descrição não informada.";
  const characters = Array.from(text);
  return characters.length <= limit ? text : characters.slice(0, limit - 1).join("").trimEnd() + "…";
}
