import type { CheckoutEventName, CheckoutSession, MerchantRules, ProgressiveDiscountPolicy } from "@zyon/shared-types";
import { assessIncentiveMargin, evaluateDiscountOffer, meetsMarginFloor } from "@zyon/rules-engine";
import { authorizeShippingDiscount } from "@zyon/shipping-engine";
import { AdvancedRuleEvaluator, type AdvancedRule, type RuleMatchContext } from "./advanced-rule-evaluator.service.js";
import { resolveProgressiveDiscountStage, selectProgressiveDiscountPercent } from "./progressive-discount-policy.service.js";

/** Reauthorize earned benefits against today's authoritative cart and quote.
 * Never add percentages together, manufacture completed stages, or turn a
 * client-supplied benefit into a price authorization. */
export function checkoutBenefitsPolicy(input: {
  session: CheckoutSession;
  rules: MerchantRules;
  advancedRules: AdvancedRule[];
  progressivePolicy?: ProgressiveDiscountPolicy;
  events: CheckoutEventName[];
  paymentMethod: string;
}) {
  const { session, rules } = input;
  const next = structuredClone(session);
  const context: RuleMatchContext = {
    cartTotal: session.cart.total,
    shippingCost: session.shipping?.customerPrice ?? Number.NaN,
    cartItemCount: session.cart.items.reduce((sum, item) => sum + item.quantity, 0),
    skusInCart: session.cart.items.map(item => item.sku),
    categoriesInCart: session.cart.items.map(item => item.category ?? ""),
    couponApplied: session.cart.commercialNudge?.kind === "coupon",
    buyerType: session.customer?.isReturning === true ? "returning" : "new",
    paymentMethod: input.paymentMethod,
    triggerFired: input.events.at(-1),
  };
  // Priority remains first-match-wins, as in the storefront and merchant editor.
  const evaluator = new AdvancedRuleEvaluator();
  const rule = input.advancedRules.filter(rule => rule.enabled).sort((a, b) => a.priority - b.priority)
    .find(rule => [undefined, ...input.events].some(event => evaluator.wouldMatch(rule, { ...context, triggerFired: event })));
  const match = { rule, action: rule?.action };
  const existingCoupon = context.couponApplied;
  let requestedPercent = 0;
  let progressive = false;
  if (!existingCoupon && rules.couponBoxEnabled !== false && input.progressivePolicy?.mode !== "coupon_only") {
    for (const event of input.events) {
      const percent = selectProgressiveDiscountPercent(input.progressivePolicy, resolveProgressiveDiscountStage(event));
      if (percent > requestedPercent) { requestedPercent = percent; progressive = true; }
    }
    const progressiveCap = input.progressivePolicy?.maxProgressivePercent;
    if (typeof progressiveCap === "number" && Number.isFinite(progressiveCap)) requestedPercent = Math.min(requestedPercent, Math.max(0, progressiveCap));
  }
  let cap: number | undefined;
  if (!existingCoupon && match.action?.type === "offer_discount") {
    const rulePercent = Number(match.action.params.percent);
    // An eligible merchant rule has priority over a generic progressive offer.
    if (rulePercent > 0) {
      requestedPercent = rulePercent;
      progressive = false;
      cap = match.action.params.maxDiscountReais == null ? undefined : Number(match.action.params.maxDiscountReais);
    }
  }
  if (match.action?.type === "offer_free_shipping" && !rules.allowStackDiscountAndFreeShipping) {
    requestedPercent = 0; // An explicit merchant shipping rule precedes the generic stage incentive.
  }
  const couponCode = !existingCoupon && (session.cart.currentDiscount ?? 0) === 0 && match.action?.type === "offer_coupon"
    && typeof match.action.params.code === "string"
    ? match.action.params.code.trim().toUpperCase() : undefined;
  // A coupon goes through its own validity/reservation path, never progressive math.
  if (couponCode) return { session: next, couponCode };
  if (requestedPercent > 0) {
    const evaluation = evaluateDiscountOffer(next.cart, rules, requestedPercent, cap);
    const discount = Math.round(next.cart.total * evaluation.value) / 100;
    const margin = assessIncentiveMargin(next.cart, {
      totalDiscount: discount,
      shippingRevenue: next.shipping?.customerPrice ?? 0,
      shippingCost: next.shipping?.realCost ?? 0,
    });
    // Preserve an already-authorized larger benefit; target, not additive.
    if (evaluation.approved && discount > (next.cart.currentDiscount ?? 0)
      && meetsMarginFloor(margin, rules.minimumMarginPercent)
      && (next.shipping?.customerPrice !== 0 || !next.shipping.realCost || rules.allowStackDiscountAndFreeShipping)) {
      next.cart.currentDiscount = discount;
      next.cart.commercialNudge = {
        kind: progressive ? "progressive_discount" : "advanced_rule",
        title: progressive ? "Desconto das etapas da compra" : "Desconto da loja",
        message: progressive ? "Benefício conquistado durante esta compra." : "Aplicado conforme as regras da loja para este pedido.",
        discountPercent: evaluation.value,
        ...(match.rule?.id && !progressive ? { ruleId: match.rule.id } : {}),
      };
    }
  }
  const shipping = next.shipping && { ...next.shipping, region: next.shipping.region ?? session.customer?.address?.state?.trim().toUpperCase() };
  const qualifiesForFreeShipping = match.action?.type === "offer_free_shipping"
    || (rules.allowFreeShipping && next.cart.total >= rules.freeShippingMinCartValue);
  if (shipping && shipping.customerPrice > 0 && qualifiesForFreeShipping) {
    const evaluation = authorizeShippingDiscount({ cart: next.cart, rules, shipping,
      type: "shipping_free", requestedDiscount: shipping.customerPrice });
    if (evaluation.approved) {
      next.shipping = { ...shipping, customerPrice: 0 };
      next.cart.appliedBenefits = [{ kind: "shipping", label: "Frete grátis", amount: evaluation.value }];
    }
  }
  if ((next.cart.currentDiscount ?? 0) > 0) {
    const benefit = { kind: "discount" as const, label: next.cart.commercialNudge?.title ?? "Desconto aplicado", amount: next.cart.currentDiscount! };
    next.cart.appliedBenefits = [...(next.cart.appliedBenefits ?? []).filter(item => item.kind !== "discount"), benefit];
  }
  return { session: next, couponCode: undefined };
}
