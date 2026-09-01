import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSettingsEntity } from "./checkout-settings.entity.js";

test("CheckoutSettingsEntity creates safe operational defaults", () => {
  const settings = CheckoutSettingsEntity.createDefault({
    merchantId: "mrc_1",
    now: new Date("2026-05-01T12:00:00.000Z")
  });
  const snapshot = settings.snapshot();
  const context = settings.toContext();

  assert.equal(snapshot.mode, "silent_until_trigger");
  assert.equal(snapshot.widgetBehavior.openWidgetOnTrigger, true);
  assert.equal(snapshot.interventionPolicy.cooldownSeconds, 120);
  assert.equal(snapshot.interventionPolicy.maxInterventionsPerSession, 3);
  assert.equal(snapshot.interventionPolicy.progressiveDiscount?.enabled, false);
  assert.equal(snapshot.interventionPolicy.progressiveDiscount?.stages.abandoned_cart, 10);
  assert.deepEqual(context.checkout_settings.enabled_triggers.includes("coupon_field_clicked"), true);
  assert.equal(context.operational_constraints.some((constraint) => constraint.includes("deterministic")), true);
});

test("CheckoutSettingsEntity validates pressure limits and known triggers", () => {
  const settings = CheckoutSettingsEntity.createDefault({ merchantId: "mrc_1" });

  assert.throws(() => settings.update({ interventionPolicy: { cooldownSeconds: 10 } }), /cooldown_too_low/);
  assert.throws(
    () => settings.update({ interventionPolicy: { maxInterventionsPerSession: 11 } }),
    /max_interventions_too_high/
  );
  assert.throws(
    () =>
      settings.update({
        triggerRules: [{ trigger: "unknown" as never, enabled: true, priority: 50 }]
      }),
    /unknown_checkout_trigger/
  );
});

test("CheckoutSettingsEntity accepts progressive discount config but validates bounds", () => {
  const settings = CheckoutSettingsEntity.createDefault({ merchantId: "mrc_1" });

  const updated = settings.update({
    interventionPolicy: {
      progressiveDiscount: {
        enabled: true,
        stages: { initial_coupon: 4, abandoned_cart: 9 }
      }
    }
  });

  assert.equal(updated.snapshot().interventionPolicy.progressiveDiscount?.enabled, true);
  assert.equal(updated.snapshot().interventionPolicy.progressiveDiscount?.stages.initial_coupon, 4);
  assert.equal(updated.snapshot().interventionPolicy.progressiveDiscount?.stages.exit_intent, 5);
  assert.equal(updated.snapshot().interventionPolicy.progressiveDiscount?.stages.abandoned_cart, 9);
  assert.throws(
    () =>
      settings.update({
        interventionPolicy: {
          progressiveDiscount: { stages: { payment_nudge: 101 } }
        }
      }),
    /progressive_discount_percent_out_of_range/
  );
});

test("CheckoutSettingsEntity rejects commercial authorization fields", () => {
  const settings = CheckoutSettingsEntity.createDefault({ merchantId: "mrc_1" });

  assert.throws(
    () => settings.update({ ["discount" as "mode"]: "proactive" as never }),
    /checkout_settings_cannot_authorize_commercial_terms/
  );
  assert.throws(
    () => settings.update({ handoff: { ["freeShipping" as "enabled"]: true as never } }),
    /checkout_settings_cannot_authorize_commercial_terms/
  );
});

test("CheckoutSettingsEntity validates offer_discount percent and maxDiscountReais", () => {
  const settings = CheckoutSettingsEntity.createDefault({ merchantId: "mrc_1" });

  // valid: percent 0–100, no cap
  const validRule = settings.update({
    advancedRules: [
      {
        id: "rule_1",
        name: "Valid discount",
        enabled: true,
        priority: 50,
        conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
        action: { type: "offer_discount" as const, params: { percent: 25 } }
      }
    ]
  });
  assert.ok(validRule);

  // valid: with positive maxDiscountReais
  const validWithCap = settings.update({
    advancedRules: [
      {
        id: "rule_2",
        name: "Valid with cap",
        enabled: true,
        priority: 50,
        conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
        action: { type: "offer_discount" as const, params: { percent: 30, maxDiscountReais: 16.0 } }
      }
    ]
  });
  assert.ok(validWithCap);

  // invalid: percent > 100
  assert.throws(
    () =>
      settings.update({
        advancedRules: [
          {
            id: "rule_3",
            name: "Invalid: percent > 100",
            enabled: true,
            priority: 50,
            conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
            action: { type: "offer_discount" as const, params: { percent: 101 } }
          }
        ]
      }),
    /advanced_rule_percent_out_of_range/
  );

  // invalid: percent < 0
  assert.throws(
    () =>
      settings.update({
        advancedRules: [
          {
            id: "rule_4",
            name: "Invalid: percent < 0",
            enabled: true,
            priority: 50,
            conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
            action: { type: "offer_discount" as const, params: { percent: -5 } }
          }
        ]
      }),
    /advanced_rule_percent_out_of_range/
  );

  // invalid: maxDiscountReais < 0
  assert.throws(
    () =>
      settings.update({
        advancedRules: [
          {
            id: "rule_5",
            name: "Invalid: negative cap",
            enabled: true,
            priority: 50,
            conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
            action: { type: "offer_discount" as const, params: { percent: 30, maxDiscountReais: -10 } }
          }
        ]
      }),
    /advanced_rule_max_discount_reais_invalid/
  );

  // invalid: maxDiscountReais is NaN
  assert.throws(
    () =>
      settings.update({
        advancedRules: [
          {
            id: "rule_6",
            name: "Invalid: NaN cap",
            enabled: true,
            priority: 50,
            conditions: [{ field: "cart_total", operator: "gte" as const, value: 100 }],
            action: { type: "offer_discount" as const, params: { percent: 30, maxDiscountReais: NaN } }
          }
        ]
      }),
    /advanced_rule_max_discount_reais_invalid/
  );
});
