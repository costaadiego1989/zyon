import type { Cart } from "@zyon/shared-types";
import { isDeepStrictEqual } from "node:util";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { allocatePromotionDiscountBudget } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { widgetCrossSellCheckoutQuoteInputSchema, widgetCrossSellCheckoutQuoteResultSchema,
  widgetCrossSellCheckoutQuoteSchema, type WidgetCrossSellCheckoutQuoteResult } from "../contracts/widget-cross-sell-checkout-quote.schemas.js";
import { buildCrossSellQuoteCandidate } from "./cross-sell-quote-candidate.js";

type Reason = Extract<WidgetCrossSellCheckoutQuoteResult, { kind: "requires_review" }>["reason"];
const review = (reason: Reason): WidgetCrossSellCheckoutQuoteResult => widgetCrossSellCheckoutQuoteResultSchema.parse({ kind: "requires_review", reason });
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const maximum = 2_147_483_647n;

/** Pure POST-ADD pricing plan, never an acceptance or financial grant. A future
 * transaction must reload/lock canonical inputs, revalidate stock/payment state,
 * compare against the shown quote and commit base+intent/suggestion/outbox once.
 * Do not expose this server-snapshot input as a browser/LLM quotation endpoint. */
export function prepareWidgetCrossSellCheckoutQuote(value: unknown): WidgetCrossSellCheckoutQuoteResult {
  const parsed = widgetCrossSellCheckoutQuoteInputSchema.safeParse(value);
  if (!parsed.success) return review("invalid_input");
  const input = parsed.data, { checkout, suggestion, target, promotion, policy } = input;
  // Zod detached these arrays from caller state; normalize equivalent explicit
  // selections before producing comparison bytes for the future transaction.
  for (const line of [...checkout.items, target]) {
    line.selectedOptions?.sort((left, right) => compare(left.itemId, right.itemId));
  }
  if ([checkout, suggestion, promotion, policy].some(owner => owner.merchantId !== input.merchantId)
    || suggestion.sessionId !== checkout.sessionId) return review("identity_mismatch");
  if (suggestion.status !== "pending" || suggestion.promotionId !== promotion.id
    || !suggestion.rankedSkus.includes(target.sku)) return review("suggestion_unavailable");
  // The first vertical is add-only. Do not merge ordinary and benefit quantities
  // or infer that an existing option line grants a different accepted selection.
  if (checkout.items.some(line => line.variantId === target.variantId)) return review("target_already_present");
  for (const line of [...checkout.items, target]) {
    const product = line.productCandidate;
    if (product && (BigInt(product.unitPriceCents) + BigInt(product.unitDiscountCents) !== BigInt(line.baseUnitPriceCents)
      || product.unitDiscountCents > line.baseUnitPriceCents)) return review("product_candidate_invalid");
  }
  const basis = [...checkout.items].sort((a, b) => compare(storefrontOptionLineIdentity(a), storefrontOptionLineIdentity(b)));
  const priorSubtotal = basis.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  const original = priorSubtotal + BigInt(target.baseUnitPriceCents) * BigInt(target.quantity);
  const modifier = (target.selectedOptions ?? []).reduce((sum, option) => sum + BigInt(option.priceModifierInCents), 0n);
  if (original > maximum || modifier > maximum) return review("monetary_overflow");
  const intent = { version: 1 as const, promotionId: promotion.id, promotionUpdatedAt: promotion.updatedAt,
    acceptedQuantity: target.quantity, originalUnitPriceCents: target.baseUnitPriceCents };
  const candidate = buildCrossSellQuoteCandidate({ merchantId: input.merchantId, now: input.now, intent, promotion,
    target: { variantId: target.variantId, productId: target.productId, sku: target.sku, quantity: target.quantity,
      baseUnitPriceCents: target.baseUnitPriceCents, optionModifierCents: Number(modifier) },
    catalogVariants: input.catalogVariants, productCandidate: target.productCandidate,
    persistedCart: { kind: "persisted_cart", merchantId: input.merchantId, subtotalCents: Number(priorSubtotal),
      items: basis.map(line => ({ variantId: line.variantId, productId: line.productId, sku: line.sku, categoryId: line.categoryId,
        quantity: line.quantity, unitPriceCents: line.baseUnitPriceCents })) } });
  if (candidate.kind === "unavailable") return review(candidate.reason);
  if (candidate.source === "base") return review("target_benefit_unavailable");

  const lines = [...basis, target].sort((a, b) => compare(storefrontOptionLineIdentity(a), storefrontOptionLineIdentity(b)));
  const cart: Cart = { currency: "BRL", total: Number(original) / 100, items: lines.map(line => ({
    sku: line.sku, name: line.sku, quantity: line.quantity, price: line.baseUnitPriceCents / 100 })) };
  const budget = evaluateCombinedDiscount(cart, policy, 0);
  if (budget.kind !== "authorized") return review("target_benefit_unavailable");
  const allocation = allocatePromotionDiscountBudget({ budgetCents: budget.remainingDiscountCents,
    lines: lines.map((line, index) => ({ key: String(index).padStart(3, "0"), quantity: line.quantity,
      baseUnitPriceCents: line.baseUnitPriceCents, requestedUnitDiscountCents: line === target
        ? candidate.unitDiscountCents : line.productCandidate?.unitDiscountCents ?? 0 })) });
  const allocated = new Map(allocation.lines.map(line => [line.key, line]));
  const items = lines.map((line, index) => ({ ...line, unitPriceCents: allocated.get(String(index).padStart(3, "0"))!.unitPriceCents }));
  const targetLine = items.find(line => line.variantId === target.variantId)!;
  if (targetLine.unitPriceCents >= target.baseUnitPriceCents) return review("target_benefit_unavailable");
  const projected: Cart = { ...cart, items: items.map(line => ({ sku: line.sku, name: line.sku,
    quantity: line.quantity, price: line.unitPriceCents / 100 })), total: (Number(original) - allocation.promotionDiscountCents) / 100,
    discountBudget: { version: 1, originalSubtotalCents: Number(original), promotionDiscountCents: allocation.promotionDiscountCents } };
  const checked = evaluateCombinedDiscount(projected, policy, 0);
  if (checked.kind !== "authorized") return review("target_benefit_unavailable");
  const notice = checked.totalDiscountCents > 0 && checked.remainingDiscountCents === 0 ? "discount_limit_reached"
    : allocation.limitApplied ? "discount_limited" : undefined;
  return widgetCrossSellCheckoutQuoteResultSchema.parse({ kind: "quote_candidate", version: 1,
    merchantId: input.merchantId, sessionId: checkout.sessionId, persistenceVersion: checkout.persistenceVersion,
    suggestionId: suggestion.id, quotedAt: input.now, checkoutBasis: { ...checkout, items: basis },
    target: { ...intent, variantId: target.variantId, productId: target.productId, sku: target.sku, source: candidate.source,
      maximumUnitPriceCents: targetLine.unitPriceCents, selectedOptionItemIds: (target.selectedOptions ?? []).map(option => option.itemId).sort() },
    items, originalSubtotalCents: Number(original), promotionDiscountCents: allocation.promotionDiscountCents,
    totalCents: Number(original) - allocation.promotionDiscountCents, ...(notice ? { notice } : {}) });
}

/** Comparison only: `current` MUST be regenerated from locked canonical inputs
 * at acceptance time, never supplied by the buyer. The changing observation
 * timestamp is excluded; promotion activity still uses the actual current time.
 * Both operands being valid JSON does not establish either one's authority. */
export function widgetCrossSellCheckoutQuoteMatchesCurrent(expected: unknown, current: unknown): boolean {
  const previous = widgetCrossSellCheckoutQuoteSchema.safeParse(expected);
  const fresh = widgetCrossSellCheckoutQuoteSchema.safeParse(current);
  if (!previous.success || !fresh.success) return false;
  const { quotedAt: _previousTime, ...previousBasis } = previous.data;
  const { quotedAt: _currentTime, ...freshBasis } = fresh.data;
  return isDeepStrictEqual(previousBasis, freshBasis);
}
