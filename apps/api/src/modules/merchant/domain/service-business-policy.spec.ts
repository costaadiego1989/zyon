import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertCompatibleBusinessModeChange,
  parseBusinessMode,
  resolveServiceBusinessPolicy,
  validateServicePolicyConfiguration,
  type ServiceBusinessPolicyInput,
} from "./service-business-policy.js";

const configuredAt = new Date("2030-01-01T00:00:00Z");
const base: ServiceBusinessPolicyInput = {
  businessMode: "services", businessModeSelectedAt: configuredAt,
  businessModeNeedsReview: false, hasLegacyServiceData: false,
  policy: { admissionsEnabled: true, holdEnabled: false, holdMinutes: null,
    paymentMode: "at_attendance", version: 1, configuredAt },
};

test("T7", async t => {
  await t.test("only the two explicit commercial modes are valid", () => {
    assert.equal(parseBusinessMode("products"), "products");
    assert.equal(parseBusinessMode("services"), "services");
    for (const value of [undefined, null, "both", "service", "PRODUCTS", "", 1, []])
      assert.throws(() => parseBusinessMode(value), /business_mode_required/);
  });
  await t.test("legacy products keep their product capabilities without a service policy", () => {
    const result = resolveServiceBusinessPolicy({ ...base, businessMode: "products", businessModeSelectedAt: null, policy: null });
    assert.equal(result.businessMode, "products");
    assert.equal(result.selectionState, "legacy");
    assert.deepEqual(result.capabilities, { products: true, serviceAdministration: false, serviceBooking: false, reconcileExisting: true });
    assert.equal(result.bookingBlockReason, "products_mode");
  });
  await t.test("legacy service evidence and review flags require explicit classification", () => {
    for (const input of [{ ...base, businessMode: "products" as const, businessModeSelectedAt: null, hasLegacyServiceData: true },
      { ...base, businessModeNeedsReview: true }, { ...base, businessModeSelectedAt: null }]) {
      const result = resolveServiceBusinessPolicy(input);
      assert.equal(result.selectionState, "review_required");
      assert.equal(result.capabilities.serviceBooking, false);
      assert.equal(result.capabilities.serviceAdministration, false);
      assert.equal(result.bookingBlockReason, "classification_required");
      assert.equal(result.capabilities.reconcileExisting, true);
    }
  });
  await t.test("services without configuration can configure but cannot admit", () => {
    const result = resolveServiceBusinessPolicy({ ...base, policy: null });
    assert.equal(result.capabilities.serviceAdministration, true);
    assert.equal(result.capabilities.serviceBooking, false);
    assert.equal(result.policyStatus, "unconfigured");
    assert.equal(result.policyVersion, null);
    assert.equal(result.bookingBlockReason, "policy_not_configured");
  });
  for (const holdEnabled of [true, false]) for (const paymentMode of ["online", "at_attendance"] as const)
    await t.test(`explicit hold=${holdEnabled} payment=${paymentMode}`, () => {
      const input = { holdEnabled, holdMinutes: holdEnabled ? 7 : null, paymentMode };
      assert.deepEqual(validateServicePolicyConfiguration(input), input);
      const result = resolveServiceBusinessPolicy({ ...base, policy: { ...base.policy!, ...input } });
      assert.equal(result.policyStatus, "configured");
      assert.equal(result.policyVersion, 1);
      assert.equal(result.bookingBlockReason, null);
      assert.equal(result.capabilities.serviceBooking, true);
      assert.deepEqual(result.policy, input);
      assert.equal(result.capabilities.reconcileExisting, true);
    });
  await t.test("configuration requires explicit hold and payment choices", () => {
    for (const input of [{}, { holdEnabled: false }, { paymentMode: "online" },
      { holdEnabled: "false", paymentMode: "online" }, { holdEnabled: false, paymentMode: "cash" }])
      assert.throws(() => validateServicePolicyConfiguration(input), /service_policy_/);
  });
  await t.test("enabled holds require positive whole minutes, disabled holds clear old duration", () => {
    for (const holdMinutes of [undefined, null, 0, -1, 0.5, Infinity, NaN, "10", 2_147_483_648])
      assert.throws(() => validateServicePolicyConfiguration({ holdEnabled: true, holdMinutes, paymentMode: "online" }), /service_policy_hold_minutes/);
    assert.deepEqual(validateServicePolicyConfiguration({ holdEnabled: false, holdMinutes: 999, paymentMode: "online" }),
      { holdEnabled: false, holdMinutes: null, paymentMode: "online" });
  });
  await t.test("invalid or incomplete stored policy fails closed without guessing", () => {
    const policies = [{ ...base.policy!, holdEnabled: null }, { ...base.policy!, paymentMode: null },
      { ...base.policy!, holdEnabled: true, holdMinutes: 0 }, { ...base.policy!, version: 0 },
      { ...base.policy!, version: 1.5 }, { ...base.policy!, configuredAt: new Date("invalid") }];
    for (const policy of policies) {
      const result = resolveServiceBusinessPolicy({ ...base, policy });
      assert.equal(result.policyStatus, "invalid");
      assert.equal(result.policy, null);
      assert.equal(result.capabilities.serviceBooking, false);
      assert.equal(result.bookingBlockReason, "policy_invalid");
      assert.equal(result.capabilities.reconcileExisting, true);
    }
    const result = resolveServiceBusinessPolicy({ ...base, policy: { ...base.policy!, configuredAt: null } });
    assert.equal(result.policyStatus, "unconfigured");
    assert.equal(result.capabilities.serviceBooking, false);
  });
  await t.test("disabling admissions preserves selected policy and existing reconciliation", () => {
    const result = resolveServiceBusinessPolicy({ ...base, policy: { ...base.policy!, admissionsEnabled: false } });
    assert.equal(result.policyStatus, "configured");assert.equal(result.policyVersion, 1);
    assert.equal(result.capabilities.serviceBooking, false);
    assert.equal(result.bookingBlockReason, "admissions_disabled");
    assert.equal(result.capabilities.reconcileExisting, true);
  });
  await t.test("incompatible active offers and ongoing appointments block mode changes", () => {
    const empty = { activeProductOffers: 0, activeServiceOffers: 0, ongoingAppointments: 0 };
    assert.doesNotThrow(() => assertCompatibleBusinessModeChange("products", empty));
    assert.doesNotThrow(() => assertCompatibleBusinessModeChange("services", empty));
    assert.throws(() => assertCompatibleBusinessModeChange("services", { ...empty, activeProductOffers: 1 }), /business_mode_conflict/);
    assert.throws(() => assertCompatibleBusinessModeChange("products", { ...empty, activeServiceOffers: 1 }), /business_mode_conflict/);
    assert.throws(() => assertCompatibleBusinessModeChange("products", { ...empty, ongoingAppointments: 1 }), /business_mode_conflict/);
    assert.doesNotThrow(() => assertCompatibleBusinessModeChange("services", { ...empty, ongoingAppointments: 1 }));
    for (const count of [-1, NaN, 0.5])
      assert.throws(() => assertCompatibleBusinessModeChange("services", { ...empty, activeProductOffers: count }), /business_mode_invalid_facts/);
  });
});
