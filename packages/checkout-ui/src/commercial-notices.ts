import type { CommercialNoticeData } from "./types";

const labels: Readonly<Record<CommercialNoticeData["code"], string>> = Object.freeze({
  discount_limit_reached: "Limite de desconto",
  discount_limited: "Desconto ajustado",
  discount_unavailable: "Desconto indisponível",
  benefit_not_combinable: "Benefícios não combináveis",
  benefit_conditions_not_met: "Condições do benefício",
});
export const commercialNoticeLabel = (code: CommercialNoticeData["code"]): string => labels[code];

/** Validate the complete optional group and detach it. No message parsing or
 * financial inference; invalid/unknown metadata cannot become an applied badge. */
export function parseCommercialNotices(value: unknown): CommercialNoticeData[] {
  if (!Array.isArray(value) || value.length > 5) return [];
  const result: CommercialNoticeData[] = [];
  for (const member of value) {
    if (!member || typeof member !== "object" || Array.isArray(member)) return [];
    const row = member as Record<string, unknown>;
    if (Object.keys(row).length !== 3 || !Object.hasOwn(row, "version") || !Object.hasOwn(row, "code") || !Object.hasOwn(row, "message")
      || row.version !== 1 || typeof row.code !== "string" || !Object.hasOwn(labels, row.code)
      || typeof row.message !== "string" || !row.message.trim() || row.message.length > 1000) return [];
    result.push({ version: 1, code: row.code as CommercialNoticeData["code"], message: row.message });
  }
  return result;
}

