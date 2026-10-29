import test from "node:test";
import assert from "node:assert/strict";
import {
  AttributionTaggerService,
  type TagInput,
} from "../domain/services/attribution-tagger.service.js";

test("AttributionTaggerService — multi-touch tagging + holdout safety", async (t) => {
  const tagger = new AttributionTaggerService();

  await t.test("A4: order with negotiation_applied=true → tagged correctly", () => {
    const input: TagInput = {
      sessionId: "s1",
      orderId: "o1",
      cohort: "treatment",
      features: {
        negotiation: true,
        crossSell: false,
        progressiveDiscount: false,
        cartRecovery: false,
        intentPersonalization: false,
      },
      revenue: {
        orderValueCents: 10000,
        discountCents: 500,
        shippingSubsidyCents: 0,
      },
      aiCostCents: 50,
    };

    const tag = tagger.tag(input);

    assert.equal(tag.negotiationApplied, true, "negotiation_applied should be true");
    assert.equal(tag.cohort, "treatment");
    assert.equal(tag.orderId, "o1");
    assert.equal(tag.aiCostCents, 50);
  });

  await t.test("A4: order with MULTIPLE features → all tagged (multi-touch)", () => {
    const input: TagInput = {
      sessionId: "s2",
      orderId: "o2",
      cohort: "treatment",
      features: {
        negotiation: true,
        crossSell: true,
        progressiveDiscount: false,
        cartRecovery: true,
        intentPersonalization: true,
        experimentVariantId: "variant_b",
      },
      revenue: {
        orderValueCents: 15000,
        discountCents: 1000,
        shippingSubsidyCents: 500,
      },
      aiCostCents: 75,
    };

    const tag = tagger.tag(input);

    // A4: multi-touch — multiple features can be true simultaneously
    assert.equal(tag.negotiationApplied, true);
    assert.equal(tag.crossSellApplied, true);
    assert.equal(tag.cartRecoveryApplied, true);
    assert.equal(tag.intentPersonalizationApplied, true);
    assert.equal(tag.progressiveDiscountApplied, false, "progressiveDiscount was false");
    assert.equal(tag.experimentVariantId, "variant_b");
  });

  await t.test("A3: holdout safety guard — ALL features_applied = false (even if upstream claims them)", () => {
    // Even if the caller (start-checkout use-case) mistakenly passes
    // features={negotiation: true, crossSell: true, ...}, the tagger must
    // coerce them to false for holdout cohort.
    const input: TagInput = {
      sessionId: "s_holdout",
      orderId: "o_holdout",
      cohort: "holdout",
      features: {
        negotiation: true,        // upstream bug — must be coerced to false
        crossSell: true,
        progressiveDiscount: false,
        cartRecovery: true,
        intentPersonalization: false,
      },
      revenue: {
        orderValueCents: 10000,
        discountCents: 0,
        shippingSubsidyCents: 0,
      },
      aiCostCents: 0, // holdout = no LLM = no cost
    };

    const tag = tagger.tag(input);

    // INVARIANT A3: holdout must have ALL features false
    assert.equal(tag.negotiationApplied, false, "A3 violation: negotiation_applied was true for holdout");
    assert.equal(tag.crossSellApplied, false, "A3 violation: cross_sell_applied was true for holdout");
    assert.equal(tag.progressiveDiscountApplied, false, "A3 violation: progressive_discount was true for holdout");
    assert.equal(tag.cartRecoveryApplied, false, "A3 violation: cart_recovery was true for holdout");
    assert.equal(tag.intentPersonalizationApplied, false, "A3 violation: intent_personalization was true for holdout");
    assert.strictEqual(tag.experimentVariantId, undefined);
    // Holdout = 0 cost
    assert.equal(tag.aiCostCents, 0);
  });

  await t.test("completeness check: tag includes all 5 feature booleans + variant_id", () => {
    const input: TagInput = {
      sessionId: "s3",
      orderId: "o3",
      cohort: "treatment",
      features: {
        negotiation: false,
        crossSell: false,
        progressiveDiscount: true,
        cartRecovery: false,
        intentPersonalization: true,
      },
      revenue: { orderValueCents: 5000, discountCents: 0, shippingSubsidyCents: 0 },
      aiCostCents: 10,
    };

    const tag = tagger.tag(input);

    // Every required field must be present (even if false)
    assert.ok("negotiationApplied" in tag);
    assert.ok("crossSellApplied" in tag);
    assert.ok("progressiveDiscountApplied" in tag);
    assert.ok("cartRecoveryApplied" in tag);
    assert.ok("intentPersonalizationApplied" in tag);
    assert.ok("experimentVariantId" in tag);
    assert.ok("orderValueCents" in tag);
    assert.ok("discountGivenCents" in tag);
    assert.ok("shippingSubsidyCents" in tag);
    assert.ok("aiCostCents" in tag);

    // Specific values
    assert.equal(tag.progressiveDiscountApplied, true);
    assert.equal(tag.intentPersonalizationApplied, true);
  });

  await t.test("extreme: holdout with all features true → all forced false (strong guard)", () => {
    const input: TagInput = {
      sessionId: "s_extreme",
      orderId: "o_extreme",
      cohort: "holdout",
      features: {
        negotiation: true,
        crossSell: true,
        progressiveDiscount: true,
        cartRecovery: true,
        intentPersonalization: true,
      },
      revenue: { orderValueCents: 999999, discountCents: 999999, shippingSubsidyCents: 999999 },
      aiCostCents: 999999,
    };

    const tag = tagger.tag(input);

    // Even with maxed-out features, holdout must have all features false
    assert.equal(tag.negotiationApplied, false);
    assert.equal(tag.crossSellApplied, false);
    assert.equal(tag.progressiveDiscountApplied, false);
    assert.equal(tag.cartRecoveryApplied, false);
    assert.equal(tag.intentPersonalizationApplied, false);
    // AI cost zeroed out
    assert.equal(tag.aiCostCents, 0);
    // Revenue numbers preserved (order still happened, just no AI features credited)
    assert.equal(tag.orderValueCents, 999999);
  });

  await t.test("tagging is pure: same input → same output (deterministic)", () => {
    const input: TagInput = {
      sessionId: "s_det",
      orderId: "o_det",
      cohort: "treatment",
      features: {
        negotiation: true,
        crossSell: true,
        progressiveDiscount: true,
        cartRecovery: true,
        intentPersonalization: true,
      },
      revenue: { orderValueCents: 1000, discountCents: 50, shippingSubsidyCents: 25 },
      aiCostCents: 5,
    };

    const tag1 = tagger.tag(input);
    const tag2 = tagger.tag(input);

    assert.deepEqual(tag1, tag2);
  });
});
