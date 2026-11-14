import assert from "node:assert/strict";
import { test } from "node:test";
import { mapMerchantBusinessProfile } from "./merchant-business-profile.mapper.js";
import type { ServiceBusinessPolicyInput } from "../domain/service-business-policy.js";

const base: ServiceBusinessPolicyInput = {
  businessMode: "services", businessModeSelectedAt: new Date("2030-01-01T00:00:00Z"),
  businessModeNeedsReview: false, hasLegacyServiceData: false,
  policy: { admissionsEnabled: true, holdEnabled: false, holdMinutes: null,
    paymentMode: "at_attendance", version: 3, configuredAt: new Date("2030-01-01T00:00:00Z") },
};
test("T9", async t => {
  await t.test("whitelists configured policy and capabilities", () => {
    assert.deepEqual(mapMerchantBusinessProfile(base), {
      businessMode: "services", businessModeSelectionState: "selected", servicePolicyStatus: "configured", policyVersion: 3,
      servicePolicy: { holdEnabled: false, holdMinutes: null, paymentMode: "at_attendance", admissionsEnabled: true },
      bookingBlockReason: null,
      capabilities: { products: false, serviceAdministration: true, serviceBooking: true, reconcileExisting: true },
    });
  });
  await t.test("products and unconfigured services remain distinct", () => {
    const product = mapMerchantBusinessProfile({ ...base, businessMode: "products", policy: null });
    assert.equal(product.businessMode, "products");assert.equal(product.servicePolicy, null);assert.equal(product.policyVersion, null);
    assert.deepEqual(product.capabilities, { products: true, serviceAdministration: false, serviceBooking: false, reconcileExisting: true });
    const service = mapMerchantBusinessProfile({ ...base, policy: null });
    assert.equal(service.capabilities.serviceAdministration, true);assert.equal(service.capabilities.serviceBooking, false);
    assert.equal(service.servicePolicyStatus, "unconfigured");assert.equal(service.policyVersion, null);
  });
  await t.test("disabled admissions preserve configuration and reconciliation", () => {
    const result = mapMerchantBusinessProfile({ ...base, policy: { ...base.policy!, admissionsEnabled: false } });
    assert.equal(result.policyVersion, 3);assert.equal(result.servicePolicy?.admissionsEnabled, false);
    assert.equal(result.capabilities.serviceBooking, false);assert.equal(result.capabilities.reconcileExisting, true);
    assert.equal(result.bookingBlockReason, "admissions_disabled");
  });
  await t.test("legacy evidence requires explicit review", () => {
    const result = mapMerchantBusinessProfile({ ...base, businessMode: "products", businessModeSelectedAt: null, hasLegacyServiceData: true });
    assert.equal(result.businessModeSelectionState, "review_required");assert.equal(result.bookingBlockReason, "classification_required");
    assert.equal(result.capabilities.serviceAdministration, false);assert.equal(result.capabilities.serviceBooking, false);
  });
  await t.test("extra secrets, role, segment and plan cannot affect or escape the projection", () => {
    const input = { ...base, role: "staff", plan: "CHECKOUT_ONLY", storeCategory: "electronics", credentials: "private-canary",
      policy: { ...base.policy!, apiKey: "private-canary" } };
    const result = mapMerchantBusinessProfile(input);
    assert.deepEqual(result, mapMerchantBusinessProfile(base));
    assert.equal(JSON.stringify(result).includes("private-canary"), false);
    assert.equal(Object.hasOwn(result, "role"), false);assert.equal(Object.hasOwn(result, "plan"), false);
  });
});
