import { test } from "node:test";
import assert from "node:assert/strict";
import { Reflector } from "@nestjs/core";
import { WidgetCouponsController } from "../../../coupons/presentation/http/widget-coupons.controller.js";
import { ApplyOfferUseCase } from "../use-cases/apply-offer.use-case.js";
import { UpdateCartUseCase } from "../use-cases/update-cart.use-case.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, authorizedOffer, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { CheckoutOfferService } from "./checkout-offer.service.js";
import { TrackCheckoutEventUseCase } from "../use-cases/track-checkout-event.use-case.js";
import { paymentCartFingerprint } from "../../domain/services/payment-cart-fingerprint.js";
import { CashbackError } from "../../../cashback/domain/cashback.js";
import { EmbedAuthGuard } from "../../../embed/presentation/http/embed-auth.guard.js";
import { EmbedTokenService } from "../../../embed/domain/embed-token.service.js";

const merchants = { getProfile: async () => ({ name: "Loja" }), getRules: async () => ({ couponBoxEnabled: true }) } as any;
const cash = { checkoutCashbackCents: async () => 1500 } as any;
const events = { checkoutEvent: { findFirst: async () => null, create: async () => ({}) } } as any;

async function fixture(discount: number) {
  const sessions = new InMemoryCheckoutRepository();
  const session = checkoutSession({ merchantId: "store", sessionId: "session", globalUserId: "buyer", shipping: undefined,persistenceVersion:0,
    cart: { total: 100, currency: "BRL", currentDiscount: discount, items: [{ sku: "p", name: "Produto", price: 100, cost: 20, quantity: 1 }] } });
  await sessions.saveSession(session); return { sessions, session };
}

test("CS-06 coupon response uses the persisted sum and resized cashback rather than the browser cart", async () => {
  const { sessions, session } = await fixture(5);
  let canonicalCalls=0;
  const controller = new WidgetCouponsController({ executeForCheckout: async (input: any) => {
    canonicalCalls++;
    assert.deepEqual(input,{merchant_id:"store",session_id:"session",code:"PROMO",expectedVersion:0});
    const next = { ...session,persistenceVersion:1, cart: { ...session.cart, currentDiscount: 15, commercialBenefitsVersion: 1 } };
    await sessions.saveSession(next);
    return {result:{ redemption_id: "redemption", discount_applied: 10, shipping_discount_applied: 0, coupon: { id: "coupon", code: "PROMO" } },
      session:next,rules:await merchants.getRules("store")};
  } } as any, { assertSessionBelongsToEmbedMerchant: async () => undefined } as any, sessions, merchants,
    { platformFeeBrl: 0 }, cash);
  const result = await controller.apply({ embedClaims: { merchantId: "store" } } as any,
    { session_id: "session", merchant_id: "forged", code: "PROMO", cart: { total: 0, currency: "BRL", items: [] }, buyer_global_user_id: "victim" });
  assert.equal(result.experience.totals.discount, 15); assert.equal(result.experience.totals.cashback_cents, 1500);
  assert.equal(result.experience.totals.total, 70);
  assert.equal(canonicalCalls,1);
  assert.equal((await sessions.getSession("store", "session"))!.cart.commercialBenefitsVersion, 1);
});

test("CS-06 rule application preserves an existing coupon and returns the same net checkout total", async () => {
  const { sessions, session } = await fixture(10);
  const offer = authorizedOffer({ id: "rule", merchantId: "store", sessionId: "session", type: "discount_fixed", value: 5 });
  const useCase = new ApplyOfferUseCase(sessions, { getOffer: async () => offer } as any,
    { apply: async () => ({ success: true }) } as any, { execute: async () => ({}) } as any, merchants, { platformFeeBrl: 0 }, undefined,cash,
    { hasCombination:async()=>true,assertCanApplyAdvancedRule: async () => undefined, applyAdvancedRule: async (stored: typeof session) => {
      const next = { ...stored, cart: { ...stored.cart, currentDiscount: 15, commercialBenefitsVersion: 2 } };
      await sessions.saveSession(next); return next;
    } } as any);
  const result = await useCase.execute({ merchant_id: "store", session_id: "session", offer_id: "rule" });
  assert.equal(result.new_total, 70); assert.equal(result.experience!.totals.discount, 15);
  assert.equal((await sessions.getSession("store", "session"))!.cart.commercialBenefitsVersion, 2);
});

test("CS-05 coupon preflight blocks a pending checkout before reserving a coupon usage", async () => {
  const { sessions } = await fixture(5);
  let canonicalCalls=0;
  const controller = new WidgetCouponsController({ executeForCheckout:async(input:any)=>{
    canonicalCalls++;assert.deepEqual(input,{merchant_id:"store",session_id:"session",code:"PROMO",expectedVersion:0});
    throw new CashbackError("cashback_payment_in_progress",409);
  },execute: async () => assert.fail("A blocked checkout must not reserve coupon usage") } as any,
    { assertSessionBelongsToEmbedMerchant: async () => undefined } as any, sessions, merchants, { platformFeeBrl: 0 });
  await assert.rejects(controller.apply({ embedClaims: { merchantId: "store" } } as any,
    { session_id: "session", merchant_id: "store", code: "PROMO", cart: {} as any }), { code: "cashback_payment_in_progress", status: 409 });
  assert.equal((await sessions.getSession("store", "session"))!.cart.currentDiscount, 5);
  assert.equal(canonicalCalls,1);
});

test("CS-06 benefit source changes invalidate payment fingerprints even when the discount value is equal", () => {
  const session = checkoutSession();
  const first = { ...session, cart: { ...session.cart, commercialBenefitsVersion: 1 } };
  const second = { ...session, cart: { ...session.cart, commercialBenefitsVersion: 2 } };
  assert.notEqual(paymentCartFingerprint(first), paymentCartFingerprint(second));
  assert.equal(paymentCartFingerprint(session), paymentCartFingerprint({ ...session, cart: { ...session.cart, commercialBenefitsVersion: undefined } }));
});

test("CS-06 coupon composition requires a signed coupon-write scope on the server", () => {
  const tokens = new EmbedTokenService({ value: Buffer.from("cashback-combination-test-only-secret") });
  const now = Math.floor(Date.now() / 1000);
  const token = tokens.sign({ typ: "aacp_embed_v1", merchantId: "store", nonce: "session", issuedAtUnix: now, expiresAtUnix: now + 60,
    allowedOrigin: "https://store.example.test",
    scopes: ["payment:intents:read"] });
  const guard = new EmbedAuthGuard(tokens, new Reflector());
  assert.throws(() => guard.canActivate({ getHandler: () => WidgetCouponsController.prototype.apply,
    getClass: () => WidgetCouponsController, switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}`, origin: "https://store.example.test" } }) }) } as any), /embed_scope_not_granted/);
});

test("CS-07 cart mutation uses the atomic composition reset without separately cancelling coupon reservations", async () => {
  const { sessions } = await fixture(15);
  let commits=0;
  // Repository owns the journal in the real production transaction; this
  // wrapper fixture checks the commit port, not a detached journal mutation.
  sessions.commitCommercialMutation=async input=>{
    commits++;assert.equal(input.expected.cart.currentDiscount,15);assert.equal(input.next.cart.currentDiscount,0);
    const saved={...input.next,cart:{...input.next.cart,commercialBenefitsVersion:3}};
    await sessions.saveSession(saved);return saved;
  };
  const useCase = new UpdateCartUseCase(sessions, { appendOutbox: async () => undefined } as any, merchants, undefined,
    { platformFeeBrl: 0 }, { couponRedemption: { findMany: async () => assert.fail("The journal owns cancellation in this branch") } } as any,
    undefined,{ checkoutCashbackCents: async () => 0 } as any, { assertMutable: async () => undefined,
      applyCartChange:async()=>assert.fail("The repository transaction owns journal reset") } as any);
  const result = await useCase.execute({ merchant_id: "store", session_id: "session", items: [{ sku: "p", quantity: 2 }] });
  assert.equal(result.experience.totals.subtotal, 200); assert.equal(result.experience.totals.discount, 0);
  const stored = (await sessions.getSession("store", "session"))!;
  assert.equal(stored.cart.currentDiscount, 0); assert.equal(stored.cart.commercialBenefitsVersion, 3);
  assert.equal(commits,1);
});

test("CS-04 explicitly allowing both sources permits a five-percent rule candidate after an existing coupon", async () => {
  const { sessions, session } = await fixture(10);
  const rules = merchantRules({ maxDiscountPercent: 5, minimumMarginPercent: 0 });
  const legacy = new CheckoutOfferService(sessions);
  assert.equal((await legacy.authorizeOffer("Quero desconto", session, rules, "payment", [])).reason, "coupon_already_applied_no_stacking");
  const service = new CheckoutOfferService(sessions, undefined, undefined, undefined, undefined,
    { getProgram: async () => ({ published: { combination: { allowCoupons: true, allowAdvancedRules: true,
      limitMode:"cashback_specific",maximumCombinedDiscountBps:3000,maximumCombinedDiscountCents:null } } }) } as any,
    {hasCombination:async()=>true,candidateRules:async(scope:typeof session,currentRules:typeof rules)=>{
      assert.equal(scope.globalUserId,"buyer");return {...currentRules,maxDiscountPercent:30};
    },assertCanApplyAdvancedRule:async(scope:typeof session,offer:any)=>{
      assert.equal(scope.cart.currentDiscount,10);assert.equal(offer.merchantId,"store");assert.equal(offer.sessionId,"session");
      assert.equal(offer.value,5);assert.equal(offer.approved,true);
    }}as any);
  const result = await service.authorizeOffer("Quero desconto", session, rules, "payment", []);
  assert.equal(result.approved, true); assert.equal(result.type, "discount_percent"); assert.equal(result.value, 5);
  assert.equal((await sessions.getSession("store", "session"))!.cart.currentDiscount, 10, "Generating a candidate cannot apply a discount");
});

for (const rejected of [false, true]) test(`CS-06 progressive rules after a coupon ${rejected ? "do not claim a rejected benefit" : "use the shared composition instead of suppressing the rule"}`, async () => {
  const { sessions, session } = await fixture(10);
  await sessions.setRules("store", { maxDiscountPercent: 30, minimumMarginPercent: 0, couponBoxEnabled: true });
  const settings = { getContext: async () => ({ merchant_id: "store", checkout_settings: { mode: "silent_until_trigger", open_widget_on_trigger: true,
    minimum_abandonment_score: 0, cooldown_seconds: 0, max_interventions_per_session: 3, enabled_triggers: ["coupon_field_clicked"],
    handoff_enabled: true, progressive_discount: { enabled: true, stages: { initial_coupon: 5, exit_intent: 5, abandoned_cart: 10, payment_nudge: 15 } } }, merchant_rules: [], operational_constraints: [] }) };
  const service = new TrackCheckoutEventUseCase(sessions, sessions, settings as any, sessions, undefined, undefined,undefined,
    { advancedDiscountCents: async () => 0, assertCanApplyAdvancedRule: async () => undefined,
      applyAdvancedRule: async (scope: typeof session, offer: any) => {
        assert.equal(offer.value, 5); assert.equal(offer.merchantId, "store"); assert.equal(offer.sessionId, "session");
        if (rejected) throw new CashbackError("cashback_combined_cap_exceeded", 409);
        const next = { ...scope, cart: { ...scope.cart, currentDiscount: 15, commercialBenefitsVersion: 1 } }; await sessions.saveSession(next); return next;
      } } as any);
  const response = await service.execute({ merchant_id: "store", session_id: "session", event: "coupon_field_clicked" });
  assert.equal(response.progressive_offer?.approved_percent, rejected ? undefined : 5);
  assert.equal((await sessions.getSession("store", "session"))!.cart.currentDiscount, rejected ? 10 : 15);
});
