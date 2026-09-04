import test from "node:test";
import assert from "node:assert/strict";
import type { Cart, ChatStage, CheckoutSession, MerchantRules } from "@zyon/shared-types";
import { CheckoutOfferService } from "../application/services/checkout-offer.service.js";
import { IntentModulatedCapService } from "../../intent-memory/application/services/intent-modulated-cap.service.js";

/**
 * F1-T03: Integration — IntentModulatedCapService modulates the discount cap
 * inside CheckoutOfferService ONLY when cohort=="treatment" AND intent available.
 *
 * Covers: ADI-F1-05 (treatment-only), ADI-F1-06 (no-intent fallback / no regression), INV-07 (holdout intact).
 *
 * Strategy: construct the service directly with a fake repository (test double)
 * and the real (pure) IntentModulatedCapService. We assert on the effective
 * discount percent the rules-engine received via the saved offer value.
 */

function createRules(overrides?: Partial<MerchantRules>): MerchantRules {
  const defaults: MerchantRules = {
    maxDiscountPercent: 30,
    minimumMarginPercent: 10,
    allowFreeShipping: true,
    allowShippingDiscount: true,
    allowBonusItem: false,
    allowStackDiscountAndFreeShipping: false,
    freeShippingMinCartValue: 150,
    maxShippingSubsidy: 50,
    maxPartialShippingDiscount: 50,
    offerExpirationMinutes: 30,
    blockedRegions: [],
    brandVoice: "consultative",
    couponBoxEnabled: false,
    autonomousEngineEnabled: true
  };
  return { ...defaults, ...(overrides || {}) };
}

function createCart(overrides?: Partial<Cart>): Cart {
  const defaults: Cart = {
    currency: "BRL",
    total: 300,
    items: [{ sku: "ITEM-1", name: "Product", price: 300, cost: 60, quantity: 1 }]
  };
  return { ...defaults, ...(overrides || {}) };
}

function createSession(overrides?: Partial<CheckoutSession> & { cohort?: string; buyerIntent?: unknown }): CheckoutSession {
  const cart = createCart();
  const base: any = {
    merchantId: "merchant-1",
    sessionId: "sess-1",
    conversationId: "conv-1",
    globalUserId: "gu-1",
    cart,
    chatHistory: [],
    abandonmentScore: 0.8,
    customer: {},
    shipping: undefined
  };
  return { ...base, ...(overrides || {}) } as CheckoutSession;
}

/** Minimal repository test double: capture the saved offer. */
function makeRepo() {
  const saved: any[] = [];
  const repo: any = {
    async saveOffer(offer: any) {
      saved.push(offer);
      return offer;
    }
  };
  return { repo, saved };
}

const STAGE: ChatStage = "payment";

test("F1-T03: treatment + price_sensitive → cap stays at maxDiscountPercent (top of range)", async () => {
  const { repo, saved } = makeRepo();
  const service = new CheckoutOfferService(repo, undefined, undefined, new IntentModulatedCapService());

  const session = createSession({
    cohort: "treatment",
    buyerIntent: { primary_intent: "price_sensitive", urgency: "high", budget_tier: "budget", pain_points: [] }
  } as any);

  const offer = await service.authorizeOffer("quero desconto", session, createRules(), STAGE, []);

  assert.ok(offer, "offer returned");
  const last = saved.at(-1);
  assert.equal(last.type, "discount_percent");
  // price_sensitive → full max cap (30%). value == 30.
  assert.equal(last.value, 30);
});

test("F1-T03: treatment + quality_seeker → cap modulated to 0 (no discount)", async () => {
  const { repo, saved } = makeRepo();
  const service = new CheckoutOfferService(repo, undefined, undefined, new IntentModulatedCapService());

  const session = createSession({
    cohort: "treatment",
    buyerIntent: { primary_intent: "quality_seeker", urgency: "low", budget_tier: "premium", pain_points: [] }
  } as any);

  const offer = await service.authorizeOffer("quero desconto", session, createRules(), STAGE, []);

  assert.ok(offer);
  const last = saved.at(-1);
  // quality_seeker → cap 0 → discount value 0 (not approved as a positive discount)
  assert.equal(last.value, 0);
});

test("F1-T03: treatment WITHOUT intent → fallback to maxDiscountPercent (no regression)", async () => {
  const { repo, saved } = makeRepo();
  const service = new CheckoutOfferService(repo, undefined, undefined, new IntentModulatedCapService());

  const session = createSession({ cohort: "treatment" } as any); // no buyerIntent

  await service.authorizeOffer("quero desconto", session, createRules(), STAGE, []);

  const last = saved.at(-1);
  assert.equal(last.type, "discount_percent");
  assert.equal(last.value, 30, "no intent → uses maxDiscountPercent (current behavior)");
});

test("F1-T03: holdout cohort → intent NEVER modulates (holdout intact, INV-07)", async () => {
  const { repo, saved } = makeRepo();
  const service = new CheckoutOfferService(repo, undefined, undefined, new IntentModulatedCapService());

  // Even a quality_seeker intent (which would zero the cap) must be ignored for holdout:
  // holdout keeps the standard maxDiscountPercent path.
  const session = createSession({
    cohort: "holdout",
    buyerIntent: { primary_intent: "quality_seeker", urgency: "low", budget_tier: "premium", pain_points: [] }
  } as any);

  await service.authorizeOffer("quero desconto", session, createRules(), STAGE, []);

  const last = saved.at(-1);
  assert.equal(last.type, "discount_percent");
  assert.equal(last.value, 30, "holdout ignores intent modulation, uses maxDiscountPercent");
});

test("F1-T03: no IntentModulatedCapService injected → current behavior (backward-compat)", async () => {
  const { repo, saved } = makeRepo();
  const service = new CheckoutOfferService(repo); // no service

  const session = createSession({
    cohort: "treatment",
    buyerIntent: { primary_intent: "quality_seeker", urgency: "low", budget_tier: "premium", pain_points: [] }
  } as any);

  await service.authorizeOffer("quero desconto", session, createRules(), STAGE, []);

  const last = saved.at(-1);
  assert.equal(last.type, "discount_percent");
  assert.equal(last.value, 30, "no service → maxDiscountPercent unchanged");
});
