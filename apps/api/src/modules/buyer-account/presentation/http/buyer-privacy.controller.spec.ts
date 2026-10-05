import assert from "node:assert/strict";
import test from "node:test";
import { BuyerPrivacyController } from "./buyer-privacy.controller.js";

test("privacy access rejects an unauthenticated request before reading data", async () => {
  await assert.rejects(new BuyerPrivacyController({} as never).get({}), /missing_authenticated_buyer/);
  await assert.rejects(new BuyerPrivacyController({} as never).remove({}), /missing_authenticated_buyer/);
});

test("privacy access uses the authenticated buyer and the token's store restriction", async () => {
  const queries: any[] = [];
  const controller = new BuyerPrivacyController({
    buyerIntentMemoryConsent: { findMany: async (q: any) => { queries.push(q); return [{ optedIn: true, expiresAt: new Date("2099-01-01"), updatedAt: new Date("2026-10-05") }]; } },
    customerIntentRecord: { findFirst: async (q: any) => { queries.push(q); return { primaryIntent: "Produto", categoryFocus: [], budgetTier: "low" }; } },
  } as never);
  const result = await controller.get({ user: { globalUserId: "buyer-own", merchantId: "store-own" } });
  assert.equal(result.has_consent, true);
  assert.equal(result.has_data, true);
  for (const q of queries) assert.deepEqual(q.where, { globalUserId: "buyer-own", merchantId: "store-own" });
});

test("expired consent does not hide data that the buyer can still remove", async () => {
  const controller = new BuyerPrivacyController({
    buyerIntentMemoryConsent: { findMany: async () => [{ optedIn: true, expiresAt: new Date("2000-01-01"), updatedAt: new Date("1999-01-01") }] },
    customerIntentRecord: { findFirst: async () => null },
  } as never);
  const result = await controller.get({ user: { globalUserId: "buyer-own" } });
  assert.equal(result.has_consent, false);
  assert.equal(result.has_data, true);
});

test("privacy deletion removes only owned intent records and permissions in a transaction", async () => {
  const calls: any[] = [];
  const tx = {
    customerIntentRecord: { deleteMany: async (q: any) => calls.push(["intents", q]) },
    buyerIntentMemoryConsent: { deleteMany: async (q: any) => calls.push(["permissions", q]) },
  };
  const controller = new BuyerPrivacyController({ $transaction: async (run: any) => run(tx) } as never);
  assert.deepEqual(await controller.remove({ user: { globalUserId: "buyer-own" } }), { success: true });
  assert.deepEqual(calls, [["intents", { where: { globalUserId: "buyer-own" } }], ["permissions", { where: { globalUserId: "buyer-own" } }]]);
});

test("privacy deletion never reports success when persistence fails", async () => {
  const controller = new BuyerPrivacyController({ $transaction: async () => { throw new Error("database unavailable"); } } as never);
  await assert.rejects(controller.remove({ user: { globalUserId: "buyer-own" } }), /database unavailable/);
});
