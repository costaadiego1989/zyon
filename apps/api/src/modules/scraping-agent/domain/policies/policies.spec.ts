import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidePurchaseRouting } from "./purchase-routing.policy.js";
import { checkSourceAllowList, filterAllowedSources } from "./source-allow-list.policy.js";
import { calculateTotalCost } from "./total-cost.policy.js";
import type { PriceQuoteResult } from "../entities/price-quote-job.entity.js";

function makeResult(url: string): PriceQuoteResult {
  return {
    id: "res_1",
    source_key: "flat-rate",
    product_title: "Product",
    url,
    price: 100,
    shipping_estimate: 10,
    total_cost: 110,
    currency: "BRL",
    availability: "in_stock",
    raw_snapshot: {},
    ingested_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// decidePurchaseRouting
// ---------------------------------------------------------------------------
describe("decidePurchaseRouting", () => {
  it("returns 'integrated' when result URL hostname contains merchantDomain", () => {
    const result = makeResult("https://shop.merchant.com/product/123");
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "integrated");
  });

  it("returns 'external' when result URL hostname does NOT contain merchantDomain", () => {
    const result = makeResult("https://amazon.com.br/item");
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "external");
  });

  it("returns 'external' for non-parseable URLs", () => {
    const result = makeResult("not-a-url");
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "external");
  });

  it("returns 'external' for empty string URL", () => {
    const result = makeResult("");
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "external");
  });

  it("handles subdomain matching (shop.merchant.com contains merchant.com)", () => {
    const result = makeResult("https://shop.merchant.com/item");
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "integrated");
  });

  it("is case-sensitive on domain matching", () => {
    const result = makeResult("https://shop.Merchant.com/item");
    // URL constructor lowercases hostname, so this should still match.
    assert.equal(decidePurchaseRouting(result, "merchant.com"), "integrated");
  });
});

// ---------------------------------------------------------------------------
// checkSourceAllowList
// ---------------------------------------------------------------------------
describe("checkSourceAllowList", () => {
  it("returns allowed:true when source is in the allowlist", () => {
    const result = checkSourceAllowList("amazon-br", ["amazon-br", "flat-rate"]);
    assert.deepEqual(result, { allowed: true });
  });

  it("returns allowed:false with reason when source is NOT in the allowlist", () => {
    const result = checkSourceAllowList("evil-source", ["amazon-br", "flat-rate"]);
    assert.equal(result.allowed, false);
    if (!result.allowed) {
      assert.equal(result.reason, "SOURCE_NOT_ALLOWED");
      assert.equal(result.source, "evil-source");
    }
  });

  it("returns allowed:false when allowlist is empty", () => {
    const result = checkSourceAllowList("any", []);
    assert.equal(result.allowed, false);
  });
});

// ---------------------------------------------------------------------------
// filterAllowedSources
// ---------------------------------------------------------------------------
describe("filterAllowedSources", () => {
  it("returns only sources present in the allowed list", () => {
    const result = filterAllowedSources(["amazon-br", "evil", "flat-rate"], ["amazon-br", "flat-rate"]);
    assert.deepEqual(result.sort(), ["amazon-br", "flat-rate"].sort());
  });

  it("returns empty array when no sources match", () => {
    const result = filterAllowedSources(["evil"], ["amazon-br", "flat-rate"]);
    assert.deepEqual(result, []);
  });

  it("returns empty array when requested is empty", () => {
    const result = filterAllowedSources([], ["amazon-br"]);
    assert.deepEqual(result, []);
  });

  it("returns empty array when allowed is empty", () => {
    const result = filterAllowedSources(["amazon-br"], []);
    assert.deepEqual(result, []);
  });
});

// ---------------------------------------------------------------------------
// calculateTotalCost
// ---------------------------------------------------------------------------
describe("calculateTotalCost", () => {
  it("sums price + shipping", () => {
    assert.equal(calculateTotalCost({ price: 100, shipping_estimate: 15 }), 115);
  });

  it("treats null shipping_estimate as 0", () => {
    assert.equal(calculateTotalCost({ price: 100, shipping_estimate: null }), 100);
  });

  it("subtracts coupon_discount", () => {
    assert.equal(calculateTotalCost({ price: 100, shipping_estimate: 10, coupon_discount: 20 }), 90);
  });

  it("floors at 0 (cannot be negative)", () => {
    assert.equal(calculateTotalCost({ price: 10, shipping_estimate: 0, coupon_discount: 999 }), 0);
  });

  it("treats undefined coupon_discount as 0", () => {
    assert.equal(calculateTotalCost({ price: 50, shipping_estimate: 5 }), 55);
  });

  it("handles all zeros", () => {
    assert.equal(calculateTotalCost({ price: 0, shipping_estimate: 0, coupon_discount: 0 }), 0);
  });
});