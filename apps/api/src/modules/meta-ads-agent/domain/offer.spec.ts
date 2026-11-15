import assert from "node:assert/strict";
import { test } from "node:test";
import { readOffer, requireIdentifier, requireEntitlement, stableDigest } from "./offer.js";
import { initialStore, MetaAdsError } from "./types.js";

test("MGA-02 initial offer is BRL 149 per month with 30 images per store", () => {
  const offer = readOffer({});
  assert.equal(offer.monthlyPriceCents, 14900);
  assert.equal(offer.monthlyImageCredits, 30);
  assert.equal(offer.extraImageCredits, 10);
  assert.equal(offer.extraImagePriceCents, 3900);
  assert.equal(offer.maxManagedCampaigns, 5);
  assert.equal(offer.currency, "BRL");
  assert.equal(offer.cadence, "monthly");
  assert.equal(offer.commercialReady, false);
});

test("MGA-03 invalid configured monetary values close new offers", () => {
  for (const value of ["0", "-1", "149.99", "NaN", "Infinity", "", "1e5", "9007199254740992", "14900 BRL"]) {
    assert.throws(() => readOffer({ META_ADS_AGENT_MONTHLY_PRICE_CENTS: value }),
      (error: unknown) => error instanceof MetaAdsError && error.code === "addon_price_invalid");
  }
  assert.equal(readOffer({ META_ADS_AGENT_MONTHLY_PRICE_CENTS: "19900" }).monthlyPriceCents, 19900);
});

test("offer versions cover commercial quantities while accepted offers stay independent", () => {
  const original = readOffer({});
  const accepted = structuredClone(original);
  const changed = readOffer({ META_ADS_AGENT_MONTHLY_PRICE_CENTS: "19900", META_ADS_AGENT_MONTHLY_IMAGE_CREDITS: "40" });
  assert.notEqual(changed.version, original.version);
  assert.equal(accepted.monthlyPriceCents, 14900);
  assert.equal(accepted.monthlyImageCredits, 30);
  assert.equal(original.version, readOffer({}).version);
  assert.equal(stableDigest({ b: 2, a: 1 }), stableDigest({ a: 1, b: 2 }));
});

test("invalid credit or capacity configuration never creates an unlimited allowance", () => {
  for (const key of ["META_ADS_AGENT_MONTHLY_IMAGE_CREDITS", "META_ADS_AGENT_EXTRA_IMAGE_CREDITS", "META_ADS_AGENT_MAX_MANAGED_CAMPAIGNS"]) {
    for (const value of ["0", "-1", "2.5", "unlimited"]) {
      assert.throws(() => readOffer({ [key]: value }), (e: unknown) => e instanceof MetaAdsError && e.code === "addon_allowance_invalid");
    }
  }
});

test("MGA-85 commercial access requires an explicitly reviewed cost benchmark of at least forty results", () => {
  const env = { META_ADS_AGENT_ENABLED: "true", META_ADS_AGENT_COMMERCIAL_READY: "true", META_ADS_AGENT_COST_BENCHMARK_RESULTS: "39", META_ADS_AGENT_COST_BENCHMARK_SHA256: "a".repeat(64) };
  const missing = readOffer(env);
  assert.equal(missing.commercialReady, false);
  assert.ok(missing.unavailableReasons.includes("cost_benchmark_required"));
  const ready = readOffer({ ...env, META_ADS_AGENT_COST_BENCHMARK_RESULTS: "40" });
  assert.equal(ready.commercialReady, true);
  assert.deepEqual(ready.unavailableReasons, []);
  assert.equal(readOffer({ ...env, META_ADS_AGENT_COST_BENCHMARK_RESULTS: "40", META_ADS_AGENT_COST_BENCHMARK_SHA256: "not-a-proof" }).commercialReady, false);
  assert.equal(readOffer({ ...env, META_ADS_AGENT_COST_BENCHMARK_RESULTS: "40", META_ADS_AGENT_ENABLED: "false" }).commercialReady, false);
});

test("entitlement requires an eligible base plan and an unexpired paid store contract", () => {
  const now = new Date("2026-11-14T12:00:00Z");
  const state = initialStore("store-a");
  const deny = (plan: string) => assert.throws(() => requireEntitlement(plan, state, now),
    (e: unknown) => e instanceof MetaAdsError && e.code === "addon_not_entitled" && e.status === 403);
  deny("growth");
  state.subscription = { id: "sub-local", offer: readOffer({}), status: "active", provider: "stripe", currentPeriodStart: "2026-11-01T00:00:00Z",
    currentPeriodEnd: "2026-12-01T00:00:00Z", cancelAtPeriodEnd: false, acceptedAt: now.toISOString(), checkoutId: "cs_1", providerSubscriptionId: "sub_1", providerCustomerId: "cus_1" };
  assert.equal(requireEntitlement("growth", state, now).id, "sub-local");
  assert.equal(requireEntitlement("scale", state, now).id, "sub-local");
  deny("starter"); deny("starter179");
  state.subscription.status = "checkout_pending"; deny("growth");
  state.subscription.status = "cancel_at_period_end";
  assert.equal(requireEntitlement("growth", state, now).id, "sub-local");
  state.subscription.currentPeriodEnd = now.toISOString(); deny("growth");
  state.subscription.currentPeriodEnd = "not-a-date"; deny("growth");
});

test("tenant and idempotency identifiers reject empty or path-like data", () => {
  for (const value of ["", "../store", "a/b", "a b", "a".repeat(161)]) assert.throws(() => requireIdentifier(value));
  assert.equal(requireIdentifier("store-tenant_1"), "store-tenant_1");
});
