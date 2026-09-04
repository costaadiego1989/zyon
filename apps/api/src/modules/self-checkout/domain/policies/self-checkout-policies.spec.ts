import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { checkConsent, CURRENT_CONSENT_VERSION } from "./consent.policy.js";
import { evaluateTemplateExecution } from "./template-execution.policy.js";
import { BuyerUserEntity } from "../entities/buyer-user.entity.js";

function makeBuyer(consent_version: string = CURRENT_CONSENT_VERSION): BuyerUserEntity {
  return BuyerUserEntity.create({ merchant_id: "test_merchant", email: "buyer@test.com",
    password_hash: "hash",
    consent_version,
    marketing_opt_in: false,
  });
}

describe("consent.policy", () => {
  it("allows buyer with current consent version", () => {
    assert.equal(checkConsent(makeBuyer()).allowed, true);
  });

  it("rejects buyer with empty consent_version", () => {
    const result = checkConsent(makeBuyer(""));
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "CONSENT_REQUIRED");
  });

  it("rejects buyer with outdated consent version", () => {
    const result = checkConsent(makeBuyer("v0"));
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "OUTDATED_CONSENT");
  });
});

describe("template-execution.policy", () => {
  const base = {
    accepted_payment_brands: [] as string[],
    allowed_shipping_regions: [] as string[],
    payment_brand: "visa",
    delivery_state: "SP",
    items_in_stock: true,
  };

  it("allows when no restrictions and in stock", () => {
    assert.equal(evaluateTemplateExecution(base).allowed, true);
  });

  it("rejects when payment brand not in accepted list", () => {
    const result = evaluateTemplateExecution({ ...base, accepted_payment_brands: ["mastercard"] });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "PAYMENT_TYPE_REJECTED");
  });

  it("allows when payment brand is in accepted list", () => {
    const result = evaluateTemplateExecution({ ...base, accepted_payment_brands: ["visa", "mastercard"] });
    assert.equal(result.allowed, true);
  });

  it("rejects when delivery region not in allowed list", () => {
    const result = evaluateTemplateExecution({ ...base, allowed_shipping_regions: ["RJ"], delivery_state: "SP" });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "REGION_NOT_ALLOWED");
  });

  it("allows when delivery region is in allowed list", () => {
    const result = evaluateTemplateExecution({ ...base, allowed_shipping_regions: ["SP", "RJ"], delivery_state: "SP" });
    assert.equal(result.allowed, true);
  });

  it("rejects when items are out of stock", () => {
    const result = evaluateTemplateExecution({ ...base, items_in_stock: false });
    assert.equal(result.allowed, false);
    if (!result.allowed) assert.equal(result.reason, "OUT_OF_STOCK");
  });
});
