import assert from "node:assert/strict";
import { test } from "node:test";
import { readOffer, type MetaAdsEnvironment } from "../domain/offer.js";
import type { AddonBillingPort, ProviderBillingEvent, BillingCheckoutRequest } from "../domain/types.js";
import { PrismaMetaAdsRepository } from "../infrastructure/prisma-meta-ads.repository.js";
import { testDatabase } from "../infrastructure/__tests__/database.js";
import { CreditsService } from "./credits.service.js";
import { BillingService } from "./billing.service.js";

async function fixture() {
  const db = await testDatabase(); const repo = new PrismaMetaAdsRepository(db.prisma);
  let env: MetaAdsEnvironment = { META_ADS_AGENT_ENABLED: "true", META_ADS_AGENT_COMMERCIAL_READY: "true", META_ADS_AGENT_COST_BENCHMARK_RESULTS: "40", META_ADS_AGENT_COST_BENCHMARK_SHA256: "a".repeat(64) };
  let plan: "growth" | "scale" | "starter" = "growth"; let now = new Date("2026-11-14T12:00:00Z"); let seq = 0;
  const requests: BillingCheckoutRequest[] = []; const cancellations: string[] = [];
  const commerce = { getPlan: async () => plan, getProfile: async () => ({ name: "Loja", email: "owner@example.test", storefrontUrl: "https://store.example.test", stripeCustomerId: null }) };
  const gateway: AddonBillingPort = {
    quote: async () => ({ amountCents: readOffer(env).monthlyPriceCents, currency: "BRL", cadence: "monthly" }),
    createCheckout: async input => { requests.push(structuredClone(input)); return { id: `cs-${requests.length}`, url: `https://checkout.stripe.test/${requests.length}`, kind: input.kind, amountCents: input.kind === "subscription" ? input.offer.monthlyPriceCents : input.offer.extraImagePriceCents, currency: "BRL", offerVersion: input.offer.version }; },
    cancelRenewal: async id => { cancellations.push(id); }, verifiedEvent: async () => null,
  };
  const service = new BillingService(repo, commerce, gateway, () => readOffer(env), () => now, () => `contract-${++seq}`);
  const start = async (kind: "subscription" | "extra_images" = "subscription", key = "request-a") => service.checkout("store-a", { kind, idempotencyKey: key, offerVersion: kind === "subscription" ? readOffer(env).version : (await repo.read("store-a")).subscription!.offer.version });
  const event = (overrides: Partial<ProviderBillingEvent> = {}): ProviderBillingEvent => ({ eventId: "evt-a", merchantId: "store-a", contractId: "contract-1", checkoutId: "cs-1", subscriptionId: "sub-a", customerId: "cus-a", paymentId: "pay-a", kind: "subscription_paid", amountCents: 14900, currency: "BRL", periodStart: "2026-11-01T00:00:00Z", periodEnd: "2026-12-01T00:00:00Z", occurredAt: "2026-11-14T12:00:00Z", ...overrides });
  const activate = async () => { await start(); await service.applyVerifiedEvent(event()); };
  return { ...db, repo, service, commerce, requests, cancellations, start, event, activate, setPrice: (value: string) => { env = { ...env, META_ADS_AGENT_MONTHLY_PRICE_CENTS: value }; }, setPlan: (value: typeof plan) => { plan = value; }, setNow: (value: string) => { now = new Date(value); }, clock: () => now };
}

test("MGA-01 eligible stores see the monthly per-store offer and separate Meta spend", async () => {
  const f = await fixture(); try {
    for (const plan of ["growth", "scale"] as const) { f.setPlan(plan); const result = await f.service.describe("store-a"); assert.equal(result.eligible, true); assert.equal(result.unit, "store"); assert.equal(result.offer.monthlyPriceCents, 14900); assert.equal(result.offer.monthlyImageCredits, 30); assert.equal(result.mediaSpendIncluded, false); }
    f.setPlan("starter"); assert.equal((await f.service.describe("store-a")).eligible, false);
  } finally { await f.close(); }
});
test("MGA-05 checkout freezes the accepted offer with store, cadence, currency and quota", async () => {
  const f = await fixture(); try {
    const result = await f.start(); const stored = (await f.repo.read("store-a")).subscription!;
    assert.equal(stored.id, "contract-1"); assert.equal(stored.status, "checkout_pending"); assert.equal(stored.offer.monthlyPriceCents, 14900); assert.equal(stored.offer.currency, "BRL"); assert.equal(stored.offer.cadence, "monthly"); assert.equal(stored.offer.monthlyImageCredits, 30);
    assert.equal(stored.checkoutId, result.id); assert.equal(f.requests[0].merchantId, "store-a");
    assert.deepEqual(await f.start(), result); assert.equal(f.requests.length, 1);
  } finally { await f.close(); }
});
test("MGA-06 changed configuration changes newly issued offers", async () => {
  const f = await fixture(); try { const old = await f.service.describe("store-a"); f.setPrice("19900"); const next = await f.service.describe("store-a"); assert.equal(next.offer.monthlyPriceCents, 19900); assert.notEqual(next.offer.version, old.offer.version); } finally { await f.close(); }
});
test("MGA-07 existing accepted contracts retain their original price", async () => {
  const f = await fixture(); try { await f.activate(); f.setPrice("19900"); const result = await f.service.describe("store-a"); assert.equal(result.offer.monthlyPriceCents, 19900); assert.equal(result.subscription!.offer.monthlyPriceCents, 14900); } finally { await f.close(); }
});
test("MGA-08 stale offer requires a new review before provider checkout", async () => {
  const f = await fixture(); try { const version = (await f.service.describe("store-a")).offer.version; f.setPrice("19900"); await assert.rejects(f.service.checkout("store-a", { kind: "subscription", idempotencyKey: "stale", offerVersion: version }), { code: "addon_offer_changed" }); assert.equal(f.requests.length, 0); assert.equal((await f.repo.read("store-a")).subscription, null); } finally { await f.close(); }
});
test("MGA-09 paid confirmation activates the paid period exactly once across concurrent deliveries", async () => {
  const f = await fixture(); try { await f.start(); await Promise.all(Array.from({ length: 8 }, () => f.service.applyVerifiedEvent(f.event()))); const state = await f.repo.read("store-a"); assert.equal(state.subscription!.status, "active"); assert.equal(state.subscription!.currentPeriodEnd, "2026-12-01T00:00:00.000Z"); assert.equal(state.credits.monthlyAvailable, 30); assert.equal((await f.repo.read("store-b")).subscription, null); } finally { await f.close(); }
});
test("MGA-12 addon price configuration leaves the base plan untouched", async () => {
  const f = await fixture(); try { await f.activate(); f.setPrice("19900"); await f.service.describe("store-a"); assert.equal(await f.commerce.getPlan(), "growth"); const tables = await f.sql.query("SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() ORDER BY table_name"); assert.deepEqual(tables.rows.map(r => r.table_name), ["merchants", "meta_ads_agent_records", "meta_ads_agent_stores"]); } finally { await f.close(); }
});
test("MGA-35 confirmed optional extras credit only their accepted pack once", async () => {
  const f = await fixture(); try { await f.activate(); const checkout = await f.start("extra_images", "extra-a"); const event = f.event({ kind: "extra_images_paid", eventId: "evt-extra", paymentId: "pay-extra", checkoutId: checkout.id, amountCents: 3900, periodStart: null, periodEnd: null }); await f.service.applyVerifiedEvent(event); await f.service.applyVerifiedEvent({ ...event, eventId: "evt-extra-repeated" }); const state = await f.repo.read("store-a"); assert.equal(state.credits.extraAvailable, 10); assert.equal(state.credits.monthlyAvailable, 30); assert.equal((await f.repo.read("store-b")).credits.extraAvailable, 0); } finally { await f.close(); }
});
test("MGA-36 renewal grants the contracted monthly quota without accumulating the old month", async () => {
  const f = await fixture(); try { await f.activate(); await f.repo.mutate("store-a", [], s => { s.credits.monthlyAvailable = 7; return { result: null }; }); const event = f.event({ eventId: "evt-renew", paymentId: "pay-renew", periodStart: "2026-12-01T00:00:00Z", periodEnd: "2027-01-01T00:00:00Z" }); await f.service.applyVerifiedEvent(event); await f.service.applyVerifiedEvent({ ...event, eventId: "evt-same-period", paymentId: "pay-same-period" }); assert.equal((await f.repo.read("store-a")).credits.monthlyAvailable, 30); } finally { await f.close(); }
});
test("MGA-72 cancel renewal preserves entitlement until the paid period ends", async () => {
  const f = await fixture(); try { await f.activate(); const result = await f.service.cancel("store-a"); assert.equal(result.status, "cancel_at_period_end"); assert.equal(result.currentPeriodEnd, "2026-12-01T00:00:00.000Z"); assert.deepEqual(f.cancellations, ["sub-a"]); assert.equal((await f.service.requireAccess("store-a")).id, "contract-1"); } finally { await f.close(); }
});
test("MGA-73 expired entitlement blocks generation and execution access without changing campaign state", async () => {
  const f = await fixture(); try { await f.activate(); f.setNow("2026-12-02T00:00:00Z"); await assert.rejects(f.service.requireAccess("store-a"), { code: "addon_not_entitled", status: 403 }); const credits = new CreditsService(f.repo, f.commerce, f.clock); await assert.rejects(credits.reserve("store-a", "after-end", 1), { code: "addon_not_entitled" }); assert.deepEqual((await f.repo.read("store-a")).executions, {}); } finally { await f.close(); }
});
test("MGA-75 retained history remains readable after entitlement ends without paid calls", async () => {
  const f = await fixture(); try { await f.activate(); await f.repo.mutate("store-a", [], s => { s.media["saved"] = { id: "saved", campaignId: "campaign", variantId: "variant", productId: "product", productVersion: "v1", url: "https://media.example.test/saved.png", createdAt: "2026-11-14T12:00:00Z" }; return { result: null }; }); f.setNow("2026-12-02T00:00:00Z"); const history = await f.service.history("store-a"); assert.equal(history.media[0].id, "saved"); assert.equal(f.requests.length, 1); } finally { await f.close(); }
});
test("MGA-81 monthly renewal preserves purchased extras", async () => {
  const f = await fixture(); try { await f.activate(); await f.repo.mutate("store-a", [], s => { s.credits.extraAvailable = 8; return { result: null }; }); await f.service.applyVerifiedEvent(f.event({ eventId: "evt-dec", paymentId: "pay-dec", periodStart: "2026-12-01T00:00:00Z", periodEnd: "2027-01-01T00:00:00Z" })); assert.equal((await f.repo.read("store-a")).credits.extraAvailable, 8); } finally { await f.close(); }
});
test("MGA-86 losing base eligibility stops addon renewals without external campaign writes", async () => {
  const f = await fixture(); try { await f.activate(); f.setPlan("starter"); await f.service.ensureEligibility("store-a"); const state = await f.repo.read("store-a"); assert.equal(state.subscription!.cancelAtPeriodEnd, true); assert.deepEqual(f.cancellations, ["sub-a"]); await assert.rejects(f.service.requireAccess("store-a"), { code: "addon_not_entitled" }); assert.deepEqual(state.executions, {}); } finally { await f.close(); }
});
test("billing rejects forged amounts, cross-store contracts and out-of-order periods", async () => {
  const f = await fixture(); try { await f.start(); await assert.rejects(f.service.applyVerifiedEvent(f.event({ amountCents: 1 })), { code: "addon_payment_mismatch" }); await assert.rejects(f.service.applyVerifiedEvent(f.event({ merchantId: "store-b" })), { code: "addon_contract_mismatch" }); assert.equal((await f.repo.read("store-a")).credits.monthlyAvailable, 0); await f.service.applyVerifiedEvent(f.event()); await f.repo.mutate("store-a", [], s => { s.credits.monthlyAvailable = 3; return { result: null }; }); await f.service.applyVerifiedEvent(f.event({ eventId: "evt-old", paymentId: "pay-old", periodStart: "2026-10-01T00:00:00Z", periodEnd: "2026-11-01T00:00:00Z" })); assert.equal((await f.repo.read("store-a")).credits.monthlyAvailable, 3); } finally { await f.close(); }
});

test("a single paid extras checkout cannot credit twice through different provider event forms", async () => {
  const f = await fixture(); try {
    await f.activate(); const checkout = await f.start("extra_images", "extra-once");
    await f.service.applyVerifiedEvent(f.event({ kind: "extra_images_paid", eventId: "evt-checkout", paymentId: "pi-extra", checkoutId: checkout.id, amountCents: 3900, periodStart: null, periodEnd: null }));
    await f.service.applyVerifiedEvent(f.event({ kind: "extra_images_paid", eventId: "evt-payment", paymentId: "payment-extra", checkoutId: checkout.id, amountCents: 3900, periodStart: null, periodEnd: null }));
    assert.equal((await f.repo.read("store-a")).credits.extraAvailable, 10);
  } finally { await f.close(); }
});

test("independent one-time extras payments do not need a Stripe subscription identifier", async () => {
  const f = await fixture(); try {
    await f.activate(); const checkout = await f.start("extra_images", "extra-independent");
    await f.service.applyVerifiedEvent(f.event({ kind: "extra_images_paid", eventId: "evt-independent", paymentId: "pi-independent", checkoutId: checkout.id, subscriptionId: null, amountCents: 3900, periodStart: null, periodEnd: null }));
    assert.equal((await f.repo.read("store-a")).credits.extraAvailable, 10);
    assert.equal((await f.repo.read("store-a")).subscription!.providerSubscriptionId, "sub-a");
  } finally { await f.close(); }
});
