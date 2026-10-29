import { createHash } from "node:crypto";
import { z } from "zod";
import type { Cart, CheckoutEventName, CheckoutSession, MerchantRules, ProgressiveDiscountPolicy } from "@zyon/shared-types";
import { evaluateCombinedDiscount, moneyCents } from "@zyon/rules-engine";
import type { AdvancedRule } from "./advanced-rule-evaluator.service.js";
import { checkoutBenefitsPolicy } from "./checkout-benefits-policy.js";
import { normalCommercialBenefitAuthorizationSchema, type normalCheckoutBenefitsCommandSchema, type NormalCommercialBenefitAuthorization } from "../contracts/normal-commercial-benefit-proof.schemas.js";

export class NormalCommercialBenefitReviewRequired extends Error {
  constructor(readonly reason: string) { super("normal_checkout_benefit_review_required"); }
}
const review = (reason: string): never => { throw new NormalCommercialBenefitReviewRequired(reason); };
export const normalCommercialBenefitHash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const variant = z.tuple([z.string().min(1), z.array(z.string().min(1)).max(250)]);
export function normalCommercialBenefitBasis(cart: Cart): NormalCommercialBenefitAuthorization["basis"] {
  const items = cart.items.map(item => {
    const parsed = item.variant === undefined ? [item.variantId, []] as const : variant.parse(JSON.parse(item.variant));
    if (!item.variantId || !item.product_id || parsed[0] !== item.variantId) return review("line_identity_required");
    const base = moneyCents(item.originalPrice ?? item.price), effective = moneyCents(item.price);
    if (base === null || effective === null) return review("money_invalid");
    return { sku: item.sku, variantId: item.variantId, productId: item.product_id, quantity: item.quantity,
      baseUnitPriceCents: base, unitPriceCents: effective, optionItemIds: [...parsed[1]].sort() };
  });
  const originalSubtotalCents = items.reduce((sum, item) => sum + item.baseUnitPriceCents * item.quantity, 0);
  const merchandiseSubtotalCents = items.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  if (moneyCents(cart.total) !== merchandiseSubtotalCents || cart.discountBudget?.version !== 1
    || cart.discountBudget.originalSubtotalCents !== originalSubtotalCents
    || cart.discountBudget.promotionDiscountCents !== originalSubtotalCents - merchandiseSubtotalCents) return review("basis_invalid");
  return { items, originalSubtotalCents, merchandiseSubtotalCents, promotionDiscountCents: originalSubtotalCents - merchandiseSubtotalCents };
}
export function normalCommercialBasisCart(basis: NormalCommercialBenefitAuthorization["basis"], categories: ReadonlyMap<string, string> = new Map()): Cart {
  return { currency: "BRL", total: basis.merchandiseSubtotalCents / 100, currentDiscount: 0,
    discountBudget: { version: 1, originalSubtotalCents: basis.originalSubtotalCents, promotionDiscountCents: basis.promotionDiscountCents },
    items: basis.items.map(item => ({ sku: item.sku, name: item.sku, variantId: item.variantId, product_id: item.productId,
      category: categories.get(item.variantId), quantity: item.quantity, price: item.unitPriceCents / 100,
      originalPrice: item.baseUnitPriceCents / 100, variant: JSON.stringify([item.variantId, [...item.optionItemIds].sort()]) })) };
}
export type NormalCommercialPaymentMethod = z.infer<typeof normalCheckoutBenefitsCommandSchema>["method"];
export interface NormalCommercialPolicyContext {
  session: CheckoutSession; rules: MerchantRules; advancedRules: AdvancedRule[]; progressivePolicy?: ProgressiveDiscountPolicy;
  method: NormalCommercialPaymentMethod; events: Array<{ id: string; eventName: CheckoutEventName }>; settingsHash: string;
}
/** Match the same card instrument in legacy merchant configuration and the
 * normal checkout wire. This projection never changes saved rules or hashes. */
export function normalCommercialRulesForMatching(rules: readonly AdvancedRule[]): AdvancedRule[] {
  const cardAlias = (value: string) => value === "credit_card" ? "card" : value;
  return rules.map(rule => ({ ...rule, conditions: rule.conditions.map(condition => {
    if (condition.field !== "payment_method") return { ...condition };
    const value = typeof condition.value === "string" ? cardAlias(condition.value)
      : Array.isArray(condition.value) ? condition.value.map(cardAlias) : condition.value;
    return { ...condition, value };
  }) }));
}
/** Only an explicit canonical command calls this creator. Quote/read calls
 * validate existing journal entries instead, so new units never acquire D. */
export function createNormalPolicyBenefitAuthorization(input: NormalCommercialPolicyContext): NormalCommercialBenefitAuthorization | undefined {
  const basis = normalCommercialBenefitBasis(input.session.cart);
  const base = { ...input.session, cart: normalCommercialBasisCart(basis,
    new Map(input.session.cart.items.map(item => [item.variantId!, item.category ?? ""]))) };
  const evaluated = checkoutBenefitsPolicy({ session: base, rules: input.rules, advancedRules: normalCommercialRulesForMatching(input.advancedRules),
    progressivePolicy: input.progressivePolicy, paymentMethod: input.method, events: input.events.map(event => event.eventName) });
  if (evaluated.couponCode) return undefined; // existing coupon command owns reservation/validity.
  const discountCents = moneyCents(evaluated.session.cart.currentDiscount ?? 0);
  if (discountCents === null) return review("money_invalid");
  if (discountCents === 0) return undefined;
  const nudge = evaluated.session.cart.commercialNudge;
  if (!nudge || !["progressive_discount", "advanced_rule"].includes(nudge.kind)) return review("policy_origin_required");
  return normalCommercialBenefitAuthorizationSchema.parse({ version: 1, merchantId: base.merchantId, checkoutSessionId: base.sessionId,
    buyerId: base.globalUserId, checkoutVersion: (base.persistenceVersion ?? -1) + 1, paymentMethod: input.method,
    origin: nudge.kind === "progressive_discount" ? "progressive" : "advanced_rule", settingsHash: input.settingsHash,
    stageEventIds: input.events.map(event => event.id), basis, discountCents, ...(nudge.ruleId ? { ruleId: nudge.ruleId } : {}) });
}
/** Validate the original grant's surviving approved subcart, not a percentage
 * of today's enlarged cart. Additional lines/units never extend this grant. */
export function assertNormalCommercialGrantBasis(cart: Cart, raw: unknown, rules: MerchantRules) {
  const grant = normalCommercialBenefitAuthorizationSchema.parse(raw), current = normalCommercialBenefitBasis(cart);
  if (moneyCents(cart.currentDiscount ?? 0) !== grant.discountCents) return review("grant_amount_changed");
  const identity = (item: NormalCommercialBenefitAuthorization["basis"]["items"][number]) => JSON.stringify([item.variantId, [...item.optionItemIds].sort()]);
  const remaining = grant.basis.items.flatMap(approved => {
    const actual = current.items.find(item => identity(item) === identity(approved));
    if (!actual) return [];
    if (actual.sku !== approved.sku || actual.productId !== approved.productId || actual.baseUnitPriceCents !== approved.baseUnitPriceCents
      || actual.unitPriceCents !== approved.unitPriceCents) return review("approved_line_changed");
    // This only proves the original fixed D. The caller's catalog/stock/P0/A
    // authority alone authorizes additional units; they never enlarge this D.
    return [{ ...approved, quantity: Math.min(actual.quantity, approved.quantity) }];
  });
  if (!remaining.length) return review("approved_basis_removed");
  const original = remaining.reduce((sum, item) => sum + item.baseUnitPriceCents * item.quantity, 0);
  const effective = remaining.reduce((sum, item) => sum + item.unitPriceCents * item.quantity, 0);
  const approvedCart = normalCommercialBasisCart({ items: remaining, originalSubtotalCents: original,
    merchandiseSubtotalCents: effective, promotionDiscountCents: original - effective },
    new Map(cart.items.map(item => [item.variantId!, item.category ?? ""])));
  const whole = evaluateCombinedDiscount(cart, rules, grant.discountCents);
  const subset = evaluateCombinedDiscount(approvedCart, rules, grant.discountCents);
  if (whole.kind !== "authorized" || whole.cartDiscountCents !== grant.discountCents
    || subset.kind !== "authorized" || subset.cartDiscountCents !== grant.discountCents) return review("company_ceiling_changed");
  return { grant, approvedCart };
}
