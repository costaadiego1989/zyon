import test from "node:test";
import assert from "node:assert/strict";
import { checkoutBenefitsPolicy } from "../domain/services/checkout-benefits-policy.js";
import { checkoutSession, merchantRules } from "./checkout-test-fixtures.js";
import type { AdvancedRule } from "../domain/services/advanced-rule-evaluator.service.js";
import { CheckoutBenefitsService } from "../application/services/checkout-benefits.service.js";
import { buildExperienceFromSession } from "../application/services/checkout-experience.service.js";
import { StockCheckedCreatePaymentIntentUseCase as CreatePaymentIntentUseCase } from "../../payment/__tests__/payment-stock-reader.fixture.js";
import { InMemoryPaymentRepository } from "../../payment/infrastructure/in-memory-payment.repository.js";
import { InMemoryCheckoutRepository } from "../infrastructure/repositories/in-memory-checkout.repository.js";
import { FakePaymentProvider } from "../../payment/infrastructure/fake-payment-provider.js";
import type { CreateProviderPaymentInput } from "../../payment/domain/ports/payment-provider.port.js";
import { BadRequestException } from "@nestjs/common";
import { checkoutWithCoupon } from "../../coupons/application/services/checkout-coupon.js";

function input() {
  return { session: checkoutSession(), rules: merchantRules(), advancedRules: [] as AdvancedRule[],
    events: ["payment_method_selected" as const], paymentMethod: "pix",
    progressivePolicy: { enabled: true, stages: { initial_coupon: 5, exit_intent: 5, abandoned_cart: 10, payment_nudge: 15 } } };
}
test("earned stages apply before quick Pix; percentage is a total target, capped and idempotent", () => {
  const args = input(); args.session.cart.currentDiscount = 15;
  const first = checkoutBenefitsPolicy(args).session;
  assert.equal(first.cart.currentDiscount, 30);
  assert.equal(first.shipping?.customerPrice, 35, "no unauthorized stacking with free shipping");
  assert.deepEqual(checkoutBenefitsPolicy({ ...args, session: first }).session, first);
  const view = buildExperienceFromSession(first, { serviceFee: .99 });
  assert.equal(view.totals.total_to_pay, 305.99);
  assert.equal(view.applied_benefits?.[0]?.amount, 30);
});
test("product and selected payment rule is reapplied to the current server cart", () => {
  const args = input(); args.progressivePolicy.enabled = false;
  args.advancedRules = [{ id: "product-rule", enabled: true, priority: 1, conditions: [
    { field: "product_in_cart", operator: "contains", value: "kit" },
    { field: "payment_method", operator: "is", value: "card" },
  ], action: { type: "offer_discount", params: { percent: 10, maxDiscountReais: 7.12 } } }];
  assert.equal(checkoutBenefitsPolicy(args).session.cart.currentDiscount ?? 0, 0);
  const result = checkoutBenefitsPolicy({ ...args, paymentMethod: "card" }).session;
  assert.equal(result.cart.currentDiscount, 7.12);
  assert.equal(result.cart.commercialNudge?.ruleId, "product-rule");
  assert.equal(checkoutBenefitsPolicy({ ...args, paymentMethod: "card", session: { ...args.session,
    cart: { ...args.session.cart, items: [{ ...args.session.cart.items[0]!, sku: "different" }] } } }).session.cart.currentDiscount ?? 0, 0);
});
test("previously completed trigger remains eligible after later payment selection", () => {
  const args = input(); args.progressivePolicy.enabled = false;
  args.advancedRules = [{ enabled: true, priority: 1, conditions: [{ field: "trigger_fired", operator: "is", value: "coupon_field_clicked" }],
    action: { type: "offer_discount", params: { percent: 5 } } }];
  const result = checkoutBenefitsPolicy({ ...args, events: ["coupon_field_clicked", "payment_method_selected"] });
  assert.equal(result.session.cart.currentDiscount, 15);
});
test("uncompleted stages are never fabricated", () => {
  const args = input();
  const result = checkoutBenefitsPolicy({ ...args, events: ["checkout_started"], rules: { ...args.rules, allowFreeShipping: false } });
  assert.equal(result.session.cart.currentDiscount ?? 0, 0);
});
test("coupon-only mode and the progressive cap remain merchant controls", () => {
  const args = input(); args.rules.allowFreeShipping = false;
  assert.equal(checkoutBenefitsPolicy({ ...args, progressivePolicy: { ...args.progressivePolicy, mode: "coupon_only" } }).session.cart.currentDiscount ?? 0, 0);
  assert.equal(checkoutBenefitsPolicy({ ...args, progressivePolicy: { ...args.progressivePolicy, maxProgressivePercent: 3 } }).session.cart.currentDiscount, 9);
});
test("free shipping uses actual carrier cost and appears as an applied benefit", () => {
  const args = input(); args.progressivePolicy.enabled = false;
  const result = checkoutBenefitsPolicy(args).session;
  assert.equal(result.shipping?.customerPrice, 0);
  assert.equal(result.shipping?.realCost, 37);
  assert.deepEqual(result.cart.appliedBenefits, [{ kind: "shipping", label: "Frete grátis", amount: 35 }]);
  assert.equal(buildExperienceFromSession(result, { serviceFee: .99 }).totals.total_to_pay, 300.99);
  assert.equal(checkoutBenefitsPolicy({ ...args, rules: { ...args.rules, maxShippingSubsidy: 36 } }).session.shipping?.customerPrice, 35);
});
test("stacking, region, eligibility threshold and missing costs remain economic gates", () => {
  const args = input();
  const both = checkoutBenefitsPolicy({ ...args, rules: { ...args.rules, minimumMarginPercent: 37, allowStackDiscountAndFreeShipping: true } }).session;
  assert.equal(both.cart.currentDiscount, 30); assert.equal(both.shipping?.customerPrice, 0);
  assert.equal(checkoutBenefitsPolicy({ ...args, rules: { ...args.rules, allowStackDiscountAndFreeShipping: true } }).session.shipping?.customerPrice, 35,
    "stacking permission still cannot bypass the 38% margin floor");
  assert.equal(checkoutBenefitsPolicy({ ...args, rules: { ...args.rules, blockedRegions: ["SP"] }, progressivePolicy: undefined }).session.shipping?.customerPrice, 35);
  assert.equal(checkoutBenefitsPolicy({ ...args, rules: { ...args.rules, freeShippingMinCartValue: 400 }, progressivePolicy: undefined }).session.shipping?.customerPrice, 35);
  const withoutCost = checkoutSession(); delete withoutCost.cart.items[0]!.cost;
  const blocked = checkoutBenefitsPolicy({ ...args, session: withoutCost }).session;
  assert.equal(blocked.cart.currentDiscount ?? 0, 0); assert.equal(blocked.shipping?.customerPrice, 35);
});
test("explicit free-shipping rule precedes generic stages when stacking is disabled", () => {
  const args = input();
  args.advancedRules = [{ enabled: true, priority: 1, conditions: [], action: { type: "offer_free_shipping", params: {} } }];
  const result = checkoutBenefitsPolicy(args).session;
  assert.equal(result.shipping?.customerPrice, 0);
  assert.equal(result.cart.currentDiscount ?? 0, 0);
});
test("eligible coupon routes to coupon authorization, never percentage math or stacking", () => {
  const args = input(); args.advancedRules = [{ enabled: true, priority: 1, conditions: [], action: { type: "offer_coupon", params: { code: "test10" } } }];
  assert.equal(checkoutBenefitsPolicy(args).couponCode, "TEST10");
  assert.equal(checkoutBenefitsPolicy(args).session.cart.currentDiscount ?? 0, 0);
  args.session.cart.currentDiscount = 60;
  args.session.cart.commercialNudge = { kind: "coupon", title: "Cupom aplicado", message: "Já autorizado", couponCode: "TEST20" };
  assert.equal(checkoutBenefitsPolicy(args).session.cart.currentDiscount, 60);
});

test("preparation is scoped, preserves committed payments and propagates failed benefit writes", async () => {
  let session = checkoutSession({ persistenceVersion: 1 }); let committed = false; let saved = 0;
  const sessions = { getSession: async () => structuredClone(session), getSessionEvents: async () => ["payment_method_selected"],
    saveBenefitsIfMutable: async (next: typeof session) => { saved++; session = next; return next; } };
  const service = new CheckoutBenefitsService(sessions as never, { getRules: async () => merchantRules() } as never,
    { getContext: async () => ({ checkout_settings: { progressive_discount: input().progressivePolicy } }),
      getInterventionConfig: async () => ({ advancedRules: [] }) } as never,
    { hasCommittedPaymentForSession: async () => committed } as never, {} as never);
  committed = true;
  assert.equal((await service.prepare("mrc_1", "chk_1", "pix")).cart.currentDiscount ?? 0, 0); assert.equal(saved, 0);
  committed = false;
  assert.equal((await service.prepare("mrc_1", "chk_1", "pix")).cart.currentDiscount, 30); assert.equal(saved, 1);
  session.cart.currentDiscount = 0;
  sessions.saveBenefitsIfMutable = async () => { throw new Error("version conflict"); };
  await assert.rejects(service.prepare("mrc_1", "chk_1", "pix"), /version conflict/);
});

test("payment admission charges the earned amount once and keeps the persisted cart in sync", async () => {
  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(checkoutSession({ customer: { email: "buyer@example.test", asaasCustomerId: "customer" } }));
  let writes = 0;
  const sessions = Object.assign(checkout, { saveBenefitsIfMutable: async (next: ReturnType<typeof checkoutSession>) => {
    writes++; checkout.saveSession(next); return next;
  } });
  const payments = new InMemoryPaymentRepository(checkout);
  const benefits = new CheckoutBenefitsService(sessions, checkout,
    { getContext: async () => ({ checkout_settings: { progressive_discount: input().progressivePolicy } }),
      getInterventionConfig: async () => ({ advancedRules: [] }) } as never, payments, {} as never);
  const inputs: CreateProviderPaymentInput[] = [];
  const fake = new FakePaymentProvider();
  const provider = { createPayment: async (request: CreateProviderPaymentInput) => {
    inputs.push(request); return fake.createPayment(request);
  } };
  const useCase = new CreatePaymentIntentUseCase(checkout, checkout, payments, provider,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, benefits);
  const request = { merchant_id: "mrc_1", session_id: "chk_1", idempotency_key: "benefits-pix", method: "pix" as const };
  const intent = await useCase.execute(request);
  assert.equal(intent.amountCents, 30599);
  assert.equal(inputs[0]?.amountCents, 30599);
  assert.equal(checkout.getSession("mrc_1", "chk_1")?.cart.currentDiscount, 30);
  assert.equal(writes, 1);
  assert.ok(intent.id);
  assert.equal((await useCase.execute(request)).id, intent.id);
  assert.equal(inputs.length, 1);
  assert.equal(writes, 1, "a committed Pix must not be repriced or created twice");
});

test("partial shipping coupon savings are described without discounting the subtotal twice", () => {
  const next = checkoutWithCoupon(checkoutSession(), { coupon: { code: "SHIP10", discount_type: "shipping_fixed" },
    discount_applied: 0, shipping_discount_applied: 10 });
  const view = buildExperienceFromSession(next, { serviceFee: .99 });
  assert.equal(view.totals.shipping, 25);
  assert.equal(view.totals.discount, 0);
  assert.equal(view.totals.total_to_pay, 325.99);
  assert.deepEqual(view.applied_benefits, [{ kind: "shipping", label: "Desconto no frete", amount: 10 }]);
});

test("automatic coupons use the authorized session; ineligible coupons do not block payment but persistence errors do", async () => {
  const checkout = new InMemoryCheckoutRepository();
  checkout.saveSession(checkoutSession({ persistenceVersion: 3 }));
  const sessions = Object.assign(checkout, { saveBenefitsIfMutable: async (next: ReturnType<typeof checkoutSession>) => {
    checkout.saveSession(next); return next;
  } });
  let outcome = "apply";
  const coupons = { executeForCheckout: async (request: { merchant_id: string; session_id: string; code: string; expectedVersion: number }) => {
    assert.deepEqual(request, { merchant_id: "mrc_1", session_id: "chk_1", code: "AUTO10", expectedVersion: 3 });
    if (outcome === "expired") throw new BadRequestException("COUPON_EXPIRED");
    if (outcome === "database") throw new Error("database unavailable");
    return { session: checkoutWithCoupon(checkout.getSession("mrc_1", "chk_1")!, {
      coupon: { code: "AUTO10", discount_type: "fixed" }, discount_applied: 10 }) };
  } };
  const service = new CheckoutBenefitsService(sessions, checkout,
    { getContext: async () => ({ checkout_settings: { progressive_discount: input().progressivePolicy } }),
      getInterventionConfig: async () => ({ advancedRules: [{ enabled: true, priority: 1, conditions: [],
        action: { type: "offer_coupon", params: { code: "AUTO10" } } }] }) } as never,
    new InMemoryPaymentRepository(), coupons as never);
  assert.equal((await service.prepare("mrc_1", "chk_1", "pix")).cart.currentDiscount, 10);
  outcome = "expired";
  assert.equal((await service.prepare("mrc_1", "chk_1", "pix")).cart.currentDiscount, 30);
  checkout.saveSession(checkoutSession({ persistenceVersion: 3 }));
  outcome = "database";
  await assert.rejects(service.prepare("mrc_1", "chk_1", "pix"), /database unavailable/);
});
