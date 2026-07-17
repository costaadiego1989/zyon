/**
 * Extracts suggested SKUs from LLM output.
 *
 * The LLM is instructed to append [SUGGEST:sku1,sku2] at the end of its message
 * when it wants to recommend products. This module parses that marker and
 * returns the SKUs for backend resolution into SuggestedProduct cards.
 */

const SUGGEST_PATTERN = /\[SUGGEST:([^\]]+)\]/;

export function extractSuggestedSkus(text: string): string[] {
  const match = text.match(SUGGEST_PATTERN);
  if (!match?.[1]) return [];
  return match[1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function stripSuggestMarker(text: string): string {
  return text.replace(SUGGEST_PATTERN, "");
}
