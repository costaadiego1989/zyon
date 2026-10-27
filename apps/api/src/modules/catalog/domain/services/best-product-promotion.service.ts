import { z } from "zod";

const id = z.string().min(1).max(191).refine(value => value.trim().length > 0 && !value.includes("\0")
  && !Array.from(value).some(character => { const point = character.codePointAt(0)!; return point >= 0xd800 && point <= 0xdfff; }));
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const candidate = z.strictObject({
  id, merchantId: id, productId: id.nullish(), variantId: id.nullish(), categoryId: id.nullish(), couponId: id.nullish(),
  discountType: z.string().nullish(), discountValue: z.number().nullish(), promoPriceInCents: z.number().nullish(),
  isActive: z.boolean(), startsAt: z.date(), endsAt: z.date(), createdAt: z.date().optional(), updatedAt: z.date().optional(),
});
export type ProductPromotionCandidate = z.input<typeof candidate>;
export interface BestProductPromotionInput {
  merchantId: string; variantId: string; productId: string; categoryId?: string;
  baseUnitPriceCents: number; promotions: readonly ProductPromotionCandidate[]; now: Date;
}
const selection = z.strictObject({ unitPriceCents: cents, unitDiscountCents: cents, promotionId: id.optional(), couponIds: z.array(id) });
export type BestProductPromotionSelection = z.infer<typeof selection>;
const input = z.strictObject({ merchantId: id, variantId: id, productId: id, categoryId: id.optional(),
  baseUnitPriceCents: cents, promotions: z.array(candidate), now: z.date() });
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;

/** Selects only the greatest applicable inline saving, never authorizes it.
 * All supplied bindings constrain scope. Coupon rows remain badges only.
 * Costs, global ceiling and margin belong to the shared economic authority. */
export function selectBestProductPromotion(value: BestProductPromotionInput): BestProductPromotionSelection {
  const parsed = input.parse(value), couponIds = new Set<string>();
  let winner: { id: string; savings: number } | undefined;
  for (const promotion of parsed.promotions) {
    if (promotion.startsAt >= promotion.endsAt) throw new Error("product_promotion_window_invalid");
    if (!promotion.isActive || promotion.merchantId !== parsed.merchantId
      || promotion.startsAt > parsed.now || promotion.endsAt <= parsed.now) continue;
    const scopes = [promotion.variantId, promotion.productId, promotion.categoryId];
    if (scopes.every(scope => scope == null)
      || (promotion.variantId != null && promotion.variantId !== parsed.variantId)
      || (promotion.productId != null && promotion.productId !== parsed.productId)
      || (promotion.categoryId != null && promotion.categoryId !== parsed.categoryId)) continue;
    const hasType = promotion.discountType != null, hasValue = promotion.discountValue != null;
    const hasPrice = promotion.promoPriceInCents != null;
    if (promotion.couponId != null) {
      if (hasType || hasValue || hasPrice) throw new Error("product_promotion_descriptor_ambiguous");
      couponIds.add(promotion.couponId); continue;
    }
    let savings: number;
    if (hasType && hasValue && !hasPrice) {
      if (promotion.discountType === "percent") {
        const percent = z.number().int().min(0).max(100).parse(promotion.discountValue);
        savings = Number(BigInt(parsed.baseUnitPriceCents) * BigInt(percent) / 100n);
      } else if (promotion.discountType === "fixed") {
        savings = Math.min(parsed.baseUnitPriceCents, cents.parse(promotion.discountValue));
      } else throw new Error("product_promotion_descriptor_invalid");
    } else if (!hasType && !hasValue && hasPrice) {
      savings = Math.max(0, parsed.baseUnitPriceCents - cents.parse(promotion.promoPriceInCents));
    } else throw new Error("product_promotion_descriptor_ambiguous");
    if (savings > 0 && (!winner || savings > winner.savings || (savings === winner.savings && compare(promotion.id, winner.id) < 0))) {
      winner = { id: promotion.id, savings };
    }
  }
  const unitDiscountCents = winner?.savings ?? 0;
  return selection.parse({ unitPriceCents: parsed.baseUnitPriceCents - unitDiscountCents, unitDiscountCents,
    ...(winner ? { promotionId: winner.id } : {}), couponIds: [...couponIds].sort(compare) });
}

const allocationLine = z.strictObject({ key: id, baseUnitPriceCents: cents, requestedUnitDiscountCents: cents,
  quantity: z.number().int().min(1).max(99) }).refine(line => line.requestedUnitDiscountCents <= line.baseUnitPriceCents);
const allocationInput = z.strictObject({ lines: z.array(allocationLine).max(200), budgetCents: cents })
  .refine(value => new Set(value.lines.map(line => line.key)).size === value.lines.length);
const allocationOutput = z.strictObject({
  lines: z.array(z.strictObject({ key: id, quantity: z.number().int().min(1).max(99), unitPriceCents: cents, unitDiscountCents: cents })),
  promotionDiscountCents: cents, requestedPromotionDiscountCents: cents, limitApplied: z.boolean(),
});
export interface PromotionDiscountAllocationInput {
  lines: readonly { key: string; baseUnitPriceCents: number; requestedUnitDiscountCents: number; quantity: number }[];
  budgetCents: number;
}
export type PromotionDiscountAllocation = z.infer<typeof allocationOutput>;

/** Stable key-ordered allocation. Unit prices remain whole cents; a remainder
 * smaller than quantity stays unused, not advertised as an exactly reached cap.
 * This is not a margin optimizer and does not authorize a commercial discount. */
export function allocatePromotionDiscountBudget(value: PromotionDiscountAllocationInput): PromotionDiscountAllocation {
  const parsed = allocationInput.parse(value), ordered = [...parsed.lines].sort((a, b) => compare(a.key, b.key));
  const maximum = BigInt(Number.MAX_SAFE_INTEGER);
  const original = ordered.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  const requested = ordered.reduce((sum, line) => sum + BigInt(line.requestedUnitDiscountCents) * BigInt(line.quantity), 0n);
  if (original > maximum || requested > maximum) throw new Error("product_promotion_allocation_overflow");
  let remaining = BigInt(parsed.budgetCents);
  const lines = ordered.map(line => {
    const requestedUnit = BigInt(line.requestedUnitDiscountCents), quantity = BigInt(line.quantity);
    const unit = requestedUnit < remaining / quantity ? requestedUnit : remaining / quantity;
    remaining -= unit * quantity;
    return { key: line.key, quantity: line.quantity, unitPriceCents: line.baseUnitPriceCents - Number(unit), unitDiscountCents: Number(unit) };
  });
  const allocated = BigInt(parsed.budgetCents) - remaining;
  return allocationOutput.parse({ lines, promotionDiscountCents: Number(allocated), requestedPromotionDiscountCents: Number(requested),
    limitApplied: allocated < requested });
}

