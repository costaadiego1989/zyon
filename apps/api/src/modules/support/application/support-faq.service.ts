/**
 * SUPP-H1: Extracted FAQ matching logic.
 * Performs keyword-based matching against merchant FAQ items.
 */
import type { SupportFaqItem } from "@zyon/shared-types";

function normalize(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

/**
 * Matches buyer message against FAQ items using keyword scoring.
 * Returns the best matching answer or null.
 */
export function faqLookup(message: string, items: SupportFaqItem[]): string | null {
  if (!items.length) return null;
  const q = normalize(message);
  let bestMatch: { answer: string; score: number } | null = null;
  for (const item of items) {
    const keywords = normalize(item.question).split(/\W+/).filter((k) => k.length > 3);
    const score = keywords.filter((k) => q.includes(k)).length;
    if (score >= 2 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { answer: item.answer, score };
    }
  }
  return bestMatch?.answer ?? null;
}
