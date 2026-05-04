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
