import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MerchantNegotiationPolicyController } from "./merchant-negotiation-policy.controller.js";
import {
  GetMerchantNegotiationPolicyUseCase,
  UpsertMerchantNegotiationPolicyUseCase
} from "../../application/merchant-negotiation-policy.use-cases.js";
import { InMemoryNegotiationStore } from "../../infrastructure/in-memory-negotiation.store.js";

describe("MerchantNegotiationPolicyController", () => {
  it("scopes upsert to JWT merchant", async () => {
    const store = new InMemoryNegotiationStore();
    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    await c.put(
      { user: { merchantId: "m_jwt", userId: "u", email: "e", role: "owner" } },
      {
        merchantId: "m_evil",
        enabled: true,
        global: { minOfferDiscountPercent: 1, maxDiscountPercent: 5 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 1
      }
    );

    const row = await store.getMerchantPolicy("m_jwt");
    assert.ok(row?.enabled);

    const other = await store.getMerchantPolicy("m_evil");
    assert.equal(other, null);
  });

  // Bug 8 regression: GET must issue exactly one DB read, not two
  it("[Bug 8] GET policy hits store exactly once (no duplicate reads)", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getMerchantPolicy.bind(store);
    store.getMerchantPolicy = async (merchantId: string) => {
      readCount++;
      return origGet(merchantId);
    };

    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    // GET with no stored policy → returns default, has_custom_policy=false, single read
    readCount = 0;
    const res1 = await c.get({ user: { merchantId: "m1", userId: "u", email: "e", role: "owner" } });
    assert.equal(readCount, 1, "GET without stored policy must read store exactly once");
    assert.equal(res1.has_custom_policy, false);
    assert.ok(res1.policy, "resolved policy must be returned");

    // Seed a policy, then GET again
    await store.upsertMerchantPolicy("m1", {
      enabled: true,
      global: { minOfferDiscountPercent: 2, maxDiscountPercent: 10 },
      maxRounds: 3,
      estimatedCostPerAiCallCents: 5
    });

    readCount = 0;
    const res2 = await c.get({ user: { merchantId: "m1", userId: "u", email: "e", role: "owner" } });
    assert.equal(readCount, 1, "GET with stored policy must read store exactly once");
    assert.equal(res2.has_custom_policy, true);
    assert.equal(res2.policy.enabled, true);
  });

  // Bug 8 regression: PUT re-reads exactly once after upsert
  it("[Bug 8] PUT policy re-reads store exactly once after upsert", async () => {
    const store = new InMemoryNegotiationStore();
    let readCount = 0;
    const origGet = store.getMerchantPolicy.bind(store);
    store.getMerchantPolicy = async (merchantId: string) => {
      readCount++;
      return origGet(merchantId);
    };

    const getPolicy = new GetMerchantNegotiationPolicyUseCase(store);
    const upsert = new UpsertMerchantNegotiationPolicyUseCase(store);
    const c = new MerchantNegotiationPolicyController(getPolicy, upsert);

    readCount = 0;
    const res = await c.put(
      { user: { merchantId: "m2", userId: "u", email: "e", role: "owner" } },
      {
        enabled: true,
        global: { minOfferDiscountPercent: 1, maxDiscountPercent: 8 },
        maxRounds: 2,
        estimatedCostPerAiCallCents: 2
      }
    );
    assert.equal(readCount, 1, "PUT must re-read store exactly once after upsert");
    assert.equal(res.policy.enabled, true);
  });
});
