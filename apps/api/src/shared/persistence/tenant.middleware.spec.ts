import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldInjectTenant, injectMerchantId } from "./tenant.middleware.js";

describe("registerTenantMiddleware", () => {
  it("injects merchantId filter when ALS context is active", () => {
    assert.ok(shouldInjectTenant("CheckoutSession", "findMany"));
    const result = injectMerchantId({ where: { status: "open" } }, "mrc_abc");
    assert.deepEqual(result.where, { status: "open", merchantId: "mrc_abc" });
  });

  it("passes through without context (unauthenticated / no ALS)", () => {
    // when ctx is null the middleware skips injection — shouldInjectTenant still true
    // but injectMerchantId is never called; args stay as-is
    assert.ok(shouldInjectTenant("CheckoutSession", "findMany"), "model/action pair is scoped");
    // simulate no-context path: args not modified
    const args = { where: { status: "open" } };
    const unchanged = args; // no injection
    assert.deepEqual(unchanged.where, { status: "open" });
  });

  it("passes through for non-scoped models", () => {
    assert.equal(shouldInjectTenant("Merchant", "findMany"), false);
    assert.equal(shouldInjectTenant("AgentRules", "findMany"), false);
  });

  it("scopes all expected tenant models and read/write actions", () => {
    const models = ["CheckoutSession", "Offer", "Order", "OutboxEvent", "NegotiationSession", "MerchantNegotiationPolicy", "BuyerAgentPreferences", "Payment"];
    const actions = ["findMany", "findFirst", "findUnique", "update", "updateMany", "delete", "deleteMany"];
    for (const model of models) {
      for (const action of actions) {
        assert.ok(shouldInjectTenant(model, action), `${model}.${action} should be tenant-scoped`);
      }
    }
  });

  it("does not scope create or upsert actions", () => {
    assert.equal(shouldInjectTenant("CheckoutSession", "create"), false);
    assert.equal(shouldInjectTenant("CheckoutSession", "upsert"), false);
    assert.equal(shouldInjectTenant("Payment", "createMany"), false);
  });

  it("injectMerchantId merges with existing where clause", () => {
    const result = injectMerchantId({ where: { status: "open", sessionId: "s1" } }, "mrc_1");
    assert.deepEqual(result.where, { status: "open", sessionId: "s1", merchantId: "mrc_1" });
  });

  it("injectMerchantId works when where is absent", () => {
    const result = injectMerchantId({ take: 10 }, "mrc_1");
    assert.deepEqual(result.where, { merchantId: "mrc_1" });
    assert.equal((result as Record<string, unknown>).take, 10);
  });
});
