import type { Cart } from "@zyon/shared-types";
import { evaluateCombinedDiscount } from "@zyon/rules-engine";
import { allocatePromotionDiscountBudget } from "../../../catalog/domain/services/best-product-promotion.service.js";
import { storefrontOptionLineIdentity } from "../../../storefront/domain/contracts/storefront-claimed-cart-effect.schemas.js";
import { normalCheckoutCrossSellPricingInputSchema, normalCheckoutCrossSellPricingResultSchema,
  normalCheckoutCrossSellBatchPricingInputSchema, normalCheckoutCrossSellBatchPricingResultSchema,
  type NormalCheckoutCrossSellPricingResult, type NormalCheckoutCrossSellBatchPricingResult } from "../contracts/normal-checkout-cross-sell-pricing.schemas.js";
import { buildCrossSellQuoteCandidate } from "./cross-sell-quote-candidate.js";

type Reason = Extract<NormalCheckoutCrossSellPricingResult, { kind: "requires_review" }>["reason"];
const review = (reason: Reason): Extract<NormalCheckoutCrossSellPricingResult, { kind: "requires_review" }> => ({ kind: "requires_review", reason });
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const maximum = 2_147_483_647n;

/** Pure normal-checkout price plan, NOT authenticated source, grant, mutation,
 * reservation or receipt. Readers must establish every normalized provenance;
 * writers must reload it in the actual transaction and compare the shown quote.
 * Preserved historical savings consume P0 once and never get another candidate.
 * Existing V1 intents are recomputed from their ORIGINAL canonical base instead. */
export function prepareNormalCheckoutCrossSellPricing(raw: unknown): NormalCheckoutCrossSellPricingResult {
  const parsed = normalCheckoutCrossSellPricingInputSchema.safeParse(raw);
  if (!parsed.success) return review("invalid_input");
  const { target, ...common } = parsed.data;
  const result = prepareNormalCheckoutCrossSellBatchPricing({ ...common, targets: [target] });
  if (result.kind === "requires_review") return result;
  const { targets, ...output } = result;
  return normalCheckoutCrossSellPricingResultSchema.parse({ ...output, target: targets[0] });
}

/** All targets are evaluated against the SAME persisted BEFORE cart and share
 * one allocation. A new batch target can never qualify a sibling's trigger. */
export function prepareNormalCheckoutCrossSellBatchPricing(raw: unknown): NormalCheckoutCrossSellBatchPricingResult {
  const parsed = normalCheckoutCrossSellBatchPricingInputSchema.safeParse(raw);
  if (!parsed.success) return review("invalid_input");
  const input = parsed.data, targets = input.targets.sort((a, b) => compare(storefrontOptionLineIdentity(a), storefrontOptionLineIdentity(b)));
  if (input.policy.merchantId !== input.merchantId) return review("identity_mismatch");
  if (input.catalogVariants.some(row => row.merchantId !== input.merchantId)) return review("tenant_mismatch");
  for (const line of [...input.lines, ...targets]) line.selectedOptions?.sort((a, b) => compare(a.itemId, b.itemId));
  if (targets.some(target => input.lines.some(line => storefrontOptionLineIdentity(line) === storefrontOptionLineIdentity(target)))) return review("target_already_present");
  const lines = [...input.lines, ...targets].sort((a, b) => compare(storefrontOptionLineIdentity(a), storefrontOptionLineIdentity(b)));
  // Internal removal projection only: an empty cart cannot receive an offer.
  // There are no lines/savings to allocate, and an existing D cannot disappear.
  // The public quote schema still requires a real target and matching item.
  if(!lines.length){
    if(input.currentDiscountCents!==0)return review("existing_benefit_requires_review");
    return normalCheckoutCrossSellBatchPricingResultSchema.parse({kind:"quote_candidate",version:1,merchantId:input.merchantId,targets:[],items:[],
      originalSubtotalCents:0,preservedSavingsCents:0,allocatedSavingsCents:0,promotionDiscountCents:0,cartDiscountCents:0,
      merchandiseSubtotalCents:0,payableMerchandiseCents:0,remainingDiscountCents:0});
  }
  const original = lines.reduce((sum, line) => sum + BigInt(line.baseUnitPriceCents) * BigInt(line.quantity), 0n);
  if (original > maximum) return review("monetary_overflow");
  for (const line of lines) {
    const options = line.selectedOptions ?? [], ids = options.map(option => option.itemId);
    if (new Set(ids).size !== ids.length) return review("invalid_input");
    const catalog = input.catalogVariants.filter(row => row.sku === line.sku);
    if (catalog.length > 1) return review("catalog_ambiguous");
    if (!catalog.length || !catalog[0]!.isActive || !catalog[0]!.productActive || catalog[0]!.productDeletedAt !== null) return review("catalog_unavailable");
    if (catalog[0]!.variantId !== line.variantId || catalog[0]!.productId !== line.productId) return review("catalog_mismatch");
    const modifiers = options.reduce((sum, option) => sum + BigInt(option.priceModifierInCents), 0n);
    if (BigInt(catalog[0]!.baseUnitPriceCents) + modifiers !== BigInt(line.baseUnitPriceCents)) return review("base_changed");
    const product = "productCandidate" in line ? line.productCandidate : undefined;
    if (product && BigInt(product.unitPriceCents) + BigInt(product.unitDiscountCents) !== BigInt(line.baseUnitPriceCents)) return review("product_candidate_invalid");
  }
  const context = input.lines.map(line => ({ variantId: line.variantId, productId: line.productId, sku: line.sku,
    categoryId: line.categoryId, quantity: line.quantity,
    unitPriceCents: line.kind === "preserved_saved" ? line.savedUnitPriceCents : line.baseUnitPriceCents }));
  const persistedCart = { kind: "persisted_cart" as const, merchantId: input.merchantId,
    subtotalCents: context.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0), items: context };
  const intentFor = (target: (typeof targets)[number]) => ({ version: 1 as const, promotionId: target.promotion.id,
    promotionUpdatedAt: target.promotion.updatedAt, acceptedQuantity: target.quantity, originalUnitPriceCents: target.baseUnitPriceCents });
  const candidateFor = (line: (typeof targets)[number] | Extract<(typeof input.lines)[number], { kind: "accepted_intent" }>) => {
    const accepted = "intent" in line ? line.intent : intentFor(line);
    const excluded = "excludedTriggerVariantIds" in line ? line.excludedTriggerVariantIds ?? [] : [];
    const qualification = excluded.length ? context.filter(item => !excluded.includes(item.variantId)) : context;
    return buildCrossSellQuoteCandidate({
    merchantId: input.merchantId, now: input.now, promotion: line.promotion,
    intent: { version: accepted.version, promotionId: accepted.promotionId, promotionUpdatedAt: accepted.promotionUpdatedAt,
      acceptedQuantity: accepted.acceptedQuantity, originalUnitPriceCents: accepted.originalUnitPriceCents },
    target: { variantId: line.variantId, productId: line.productId, sku: line.sku, quantity: line.quantity,
      baseUnitPriceCents: line.baseUnitPriceCents,
      optionModifierCents: (line.selectedOptions ?? []).reduce((sum, option) => sum + option.priceModifierInCents, 0) },
    catalogVariants: input.catalogVariants, persistedCart: { ...persistedCart, items: qualification,
      subtotalCents: qualification.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0) }, productCandidate: line.productCandidate,
  }); };
  const targetCandidates = targets.map(candidateFor);
  for (const candidate of targetCandidates) {
    if (candidate.kind === "unavailable") return review(candidate.reason);
    if (candidate.source === "base") return review("target_benefit_unavailable");
  }
  const requested = new Map<string, number>();
  let preservedSavings = 0;
  for (const line of input.lines) {
    const key = storefrontOptionLineIdentity(line);
    if (line.kind === "preserved_saved") {
      preservedSavings += (line.baseUnitPriceCents - line.savedUnitPriceCents) * line.quantity;
      requested.set(key, 0);
    } else if (line.kind === "accepted_intent") {
      if (JSON.stringify([...(line.intent.selectedOptionItemIds ?? [])].sort(compare)) !== JSON.stringify((line.selectedOptions ?? []).map(option => option.itemId))) return review("base_changed");
      const candidate = candidateFor(line);
      if (candidate.kind === "unavailable") return review(candidate.reason);
      requested.set(key, candidate.unitDiscountCents);
    } else requested.set(key, line.productCandidate?.unitDiscountCents ?? 0);
  }
  for (const [index, target] of targets.entries()) {
    const candidate = targetCandidates[index]!;
    if (candidate.kind !== "candidate") return review("target_benefit_unavailable");
    requested.set(storefrontOptionLineIdentity(target), candidate.unitDiscountCents);
  }
  const basePrice = (line: (typeof lines)[number]) => "kind" in line && line.kind === "preserved_saved" ? line.savedUnitPriceCents : line.baseUnitPriceCents;
  const initial: Cart = { currency: "BRL", total: (Number(original) - preservedSavings) / 100,
    currentDiscount: input.currentDiscountCents / 100,
    items: lines.map(line => ({ sku: line.sku, name: line.sku, quantity: line.quantity, price: basePrice(line) / 100 })),
    discountBudget: { version: 1, originalSubtotalCents: Number(original), promotionDiscountCents: preservedSavings } };
  const budget = evaluateCombinedDiscount(initial, input.policy, input.currentDiscountCents);
  if (budget.kind !== "authorized" || budget.cartDiscountCents !== input.currentDiscountCents) return review("existing_benefit_requires_review");
  const allocation = allocatePromotionDiscountBudget({ budgetCents: budget.remainingDiscountCents,
    lines: lines.map((line, index) => ({ key: String(index).padStart(3, "0"), quantity: line.quantity,
      baseUnitPriceCents: basePrice(line), requestedUnitDiscountCents: requested.get(storefrontOptionLineIdentity(line))! })) });
  const allocated = new Map(allocation.lines.map(line => [line.key, line]));
  const items = lines.map((line, index) => ({ variantId: line.variantId, productId: line.productId, sku: line.sku,
    ...(line.categoryId === undefined ? {} : { categoryId: line.categoryId }), quantity: line.quantity, baseUnitPriceCents: line.baseUnitPriceCents,
    ...(line.selectedOptions === undefined ? {} : { selectedOptions: line.selectedOptions }),
    unitPriceCents: allocated.get(String(index).padStart(3, "0"))!.unitPriceCents }));
  for (const line of input.lines) if (line.kind === "accepted_intent") {
    const projected = items.find(item => storefrontOptionLineIdentity(item) === storefrontOptionLineIdentity(line))!;
    if (projected.unitPriceCents > line.intent.maximumUnitPriceCents) return review("accepted_price_changed");
  }
  const targetIntents = targets.map((target, index) => {
    const targetLine = items.find(line => storefrontOptionLineIdentity(line) === storefrontOptionLineIdentity(target))!;
    const candidate = targetCandidates[index]!;
    return { ...intentFor(target), variantId: target.variantId, productId: target.productId, sku: target.sku,
      source: candidate.kind === "candidate" ? candidate.source : "base",
      maximumUnitPriceCents: targetLine.unitPriceCents, selectedOptionItemIds: (target.selectedOptions ?? []).map(option => option.itemId) };
  });
  if (targetIntents.some(target => target.maximumUnitPriceCents >= target.originalUnitPriceCents)) return review("target_benefit_unavailable");
  const totalSavings = preservedSavings + allocation.promotionDiscountCents, subtotal = Number(original) - totalSavings;
  const final: Cart = { ...initial, total: subtotal / 100,
    items: items.map(line => ({ sku: line.sku, name: line.sku, quantity: line.quantity, price: line.unitPriceCents / 100 })),
    discountBudget: { version: 1, originalSubtotalCents: Number(original), promotionDiscountCents: totalSavings } };
  const checked = evaluateCombinedDiscount(final, input.policy, input.currentDiscountCents);
  if (checked.kind !== "authorized" || checked.cartDiscountCents !== input.currentDiscountCents) return review("existing_benefit_requires_review");
  const notice = checked.totalDiscountCents > 0 && checked.remainingDiscountCents === 0 ? "discount_limit_reached"
    : allocation.limitApplied ? "discount_limited" : undefined;
  return normalCheckoutCrossSellBatchPricingResultSchema.parse({ kind: "quote_candidate", version: 1, merchantId: input.merchantId, targets: targetIntents,
    items, originalSubtotalCents: Number(original), preservedSavingsCents: preservedSavings,
    allocatedSavingsCents: allocation.promotionDiscountCents, promotionDiscountCents: totalSavings, cartDiscountCents: input.currentDiscountCents,
    merchandiseSubtotalCents: subtotal, payableMerchandiseCents: subtotal - input.currentDiscountCents,
    remainingDiscountCents: checked.remainingDiscountCents, ...(notice ? { notice } : {}) });
}
