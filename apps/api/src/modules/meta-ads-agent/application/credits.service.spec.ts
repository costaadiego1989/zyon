import assert from "node:assert/strict";
import { test } from "node:test";
import { readOffer } from "../domain/offer.js";
import { PrismaMetaAdsRepository } from "../infrastructure/prisma-meta-ads.repository.js";
import { testDatabase } from "../infrastructure/__tests__/database.js";
import { CreditsService } from "./credits.service.js";

async function fixture(monthly = 30, extra = 0) {
  const db = await testDatabase(); const repo = new PrismaMetaAdsRepository(db.prisma);
  await repo.mutate("store-a", [], state => {
    state.subscription = { id: "contract-a", offer: readOffer({}), status: "active", provider: "stripe", currentPeriodStart: "2026-11-01T00:00:00Z", currentPeriodEnd: "2026-12-01T00:00:00Z", cancelAtPeriodEnd: false, acceptedAt: "2026-11-01T00:00:00Z", checkoutId: null, providerSubscriptionId: "sub-a", providerCustomerId: "cus-a" };
    state.credits = { monthlyAvailable: monthly, extraAvailable: extra, periodKey: "2026-11", periodEndsAt: "2026-12-01T00:00:00Z", reservations: {} };
    return { result: null };
  });
  const service = new CreditsService(repo, { getPlan: async () => "growth" }, () => new Date("2026-11-14T12:00:00Z"));
  return { ...db, repo, service };
}

test("MGA-28 one persisted usable image costs one credit exactly once", async () => {
  const f = await fixture(); try {
    await f.service.reserve("store-a", "gen-a", 1);
    await f.service.settle("store-a", "gen-a", 1);
    await f.service.settle("store-a", "gen-a", 1);
    assert.equal((await f.service.wallet("store-a")).monthlyAvailable, 29);
    assert.equal((await f.service.wallet("store-a")).reserved, 0);
    assert.equal((await f.repo.read("store-a")).credits.reservations["gen-a"].used, 1);
  } finally { await f.close(); }
});
test("MGA-29 five new carousel images cost five credits", async () => {
  const f = await fixture(); try {
    await f.service.reserve("store-a", "carousel", 5); await f.service.settle("store-a", "carousel", 5);
    assert.equal((await f.service.wallet("store-a")).monthlyAvailable, 25);
  } finally { await f.close(); }
});
test("MGA-34 insufficient credits block generation without changing the wallet", async () => {
  const f = await fixture(1); try {
    await assert.rejects(f.service.reserve("store-a", "too-many", 2), { code: "image_credits_insufficient" });
    assert.deepEqual(await f.service.wallet("store-a"), { monthlyAvailable: 1, extraAvailable: 0, reserved: 0, periodKey: "2026-11", periodEndsAt: "2026-12-01T00:00:00Z" });
    assert.deepEqual((await f.repo.read("store-a")).credits.reservations, {});
  } finally { await f.close(); }
});
test("MGA-78 concurrent requests cannot overspend the last credit", async () => {
  const f = await fixture(1); try {
    const outcomes = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => f.service.reserve("store-a", `gen-${i}`, 1)));
    assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1);
    assert.equal(outcomes.filter(o => o.status === "rejected" && o.reason.code === "image_credits_insufficient").length, 11);
    const wallet = await f.service.wallet("store-a"); assert.equal(wallet.monthlyAvailable, 0); assert.equal(wallet.reserved, 1);
  } finally { await f.close(); }
});
test("MGA-80 saved images can be reused without consuming generation credits", async () => {
  const f = await fixture(0); try {
    await f.repo.mutate("store-a", [], state => { state.media["image-a"] = { id: "image-a", productVariantId: "variant-a", url: "https://media.example.test/image.png", createdAt: "2026-11-14T12:00:00Z", generationId: "gen-old", usable: true } as never; return { result: null }; });
    const before = await f.service.wallet("store-a");
    assert.equal((await f.service.reuse("store-a", "image-a")).id, "image-a");
    assert.deepEqual(await f.service.wallet("store-a"), before);
    await assert.rejects(f.service.reuse("store-b", "image-a"));
  } finally { await f.close(); }
});
test("partial results refund unused credits while unknown results retain reservations", async () => {
  const f = await fixture(2, 4); try {
    await f.service.reserve("store-a", "partial", 5); await f.service.markUnknown("store-a", "partial");
    assert.equal((await f.service.wallet("store-a")).reserved, 5);
    await f.service.reserve("store-a", "partial", 5);
    await assert.rejects(f.service.reserve("store-a", "partial", 4), { code: "credit_reservation_conflict" });
    await f.service.settle("store-a", "partial", 3);
    assert.equal((await f.service.wallet("store-a")).monthlyAvailable, 0);
    assert.equal((await f.service.wallet("store-a")).extraAvailable, 3);
    await assert.rejects(f.service.settle("store-a", "partial", 4), { code: "credit_settlement_conflict" });
  } finally { await f.close(); }
});
test("old monthly reservations cannot replenish a renewed month and extra credits survive", async () => {
  const f = await fixture(2, 5); try {
    await f.service.reserve("store-a", "old", 4);
    await f.repo.mutate("store-a", [], state => { state.credits.periodKey = "2026-12"; state.credits.monthlyAvailable = 30; return { result: null }; });
    await f.service.settle("store-a", "old", 0);
    const wallet = await f.service.wallet("store-a"); assert.equal(wallet.monthlyAvailable, 30); assert.equal(wallet.extraAvailable, 5);
  } finally { await f.close(); }
});
