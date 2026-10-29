import { z } from "zod";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";

const cents = z.number().int().min(0).max(2_147_483_647);
const inputSchema = z.strictObject({ lines: z.array(z.strictObject({ canonicalUnitPriceCents: cents,
  savedUnitPriceCents: cents, quantity: z.number().int().min(1).max(99) })).min(1).max(200),
  cartDiscountCents: cents, maxDiscountPercent: z.number().finite().min(0).max(100) });
export type LegacySavedPriceReviewReason = "above_company_limit" | "saved_price_above_catalog" | "quantity_extension" | "source_changed";
export type LegacySavedPriceBasis = { kind: "preserved"; subtotalCents: number; cartDiscountCents: number;
  remainingDiscountCents: number; budget: { version: 1; originalSubtotalCents: number; promotionDiscountCents: number } }
  | { kind: "requires_review"; reason: LegacySavedPriceReviewReason };

/** Pure numeric policy only. Callers must independently load the scoped saved
 * source and current catalog/options; this never authenticates client prices,
 * attributes a historical promotion, extends quantity or writes a grant. */
export function evaluateLegacySavedPriceBasis(input: z.input<typeof inputSchema>): LegacySavedPriceBasis {
  const { lines, cartDiscountCents, maxDiscountPercent } = inputSchema.parse(input);
  if (lines.some(line => line.savedUnitPriceCents > line.canonicalUnitPriceCents)) return { kind: "requires_review", reason: "saved_price_above_catalog" };
  const original = lines.reduce((sum, line) => sum + BigInt(line.canonicalUnitPriceCents) * BigInt(line.quantity), 0n);
  const saved = lines.reduce((sum, line) => sum + BigInt(line.savedUnitPriceCents) * BigInt(line.quantity), 0n);
  if (original > 2_147_483_647n || saved > 2_147_483_647n) throw Error("legacy_saved_price_overflow");
  const budget = { version: 1 as const, originalSubtotalCents: Number(original), promotionDiscountCents: Number(original - saved) };
  const decision = evaluateCombinedDiscount({ currency: "BRL", total: Number(saved) / 100, currentDiscount: cartDiscountCents / 100,
    items: lines.map((line, index) => ({ sku: String(index), name: "Saved quotation", price: line.savedUnitPriceCents / 100,
      originalPrice: line.canonicalUnitPriceCents / 100, quantity: line.quantity })), discountBudget: budget }, { maxDiscountPercent }, cartDiscountCents);
  if (decision.kind !== "authorized") return { kind: "requires_review", reason: "above_company_limit" };
  return { kind: "preserved", budget, subtotalCents: Number(saved), cartDiscountCents, remainingDiscountCents: decision.remainingDiscountCents };
}
