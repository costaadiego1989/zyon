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
});
