import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RulesEngineDiscountAdapter } from "./rules-engine-discount.adapter.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { Cart, MerchantRules } from "@zyon/shared-types";

const adapter = new RulesEngineDiscountAdapter();

const BASE_CART: Cart = {
  items: [{ sku: "SKU-A", price: 200, quantity: 1, name: "Item A" }],
  total: 200,
  currency: "BRL"
};

describe("RulesEngineDiscountAdapter", () => {
  it("approves percent discount within limits", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 15, minimumMarginPercent: 0 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 10, "percent");
    assert.equal(result.approved, true);
    assert.equal(result.authorizedDiscount, 10);
  });

  it("caps percent discount to maxDiscountPercent", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 5, minimumMarginPercent: 0 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 20, "percent");
    assert.equal(result.approved, true);
    assert.equal(result.authorizedDiscount, 5);
    assert.ok(result.reason.includes("capped"));
  });

  it("rejects when minimum margin is violated", () => {
    // Cart = 200, no cost info so default cost = 50% = 100.
    // margin before discount = 200 - 100 - (200*0.04 fees) = 92 / 200 = 46%
    // requesting 90% discount → subsidy = 180, margin = (200-100-8-180)/200 = negative
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 90, minimumMarginPercent: 38 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 90, "percent");
    assert.equal(result.approved, false);
    assert.equal(result.authorizedDiscount, 0);
  });

  it("handles fixed discount by converting to percent internally", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 15, minimumMarginPercent: 0 };
    // 20 fixed on 200 cart = 10% → allowed (max is 15%)
    const result = adapter.authorizeDiscount(BASE_CART, rules, 20, "fixed");
    assert.equal(result.approved, true);
    // Authorized in fixed-back: 10% → 200*10/100 = 20
    assert.equal(result.authorizedDiscount, 20);
  });

  it("caps fixed discount: 40 on 200 cart = 20%, capped by maxDiscountPercent=10%", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 10, minimumMarginPercent: 0 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 40, "fixed");
    assert.equal(result.approved, true);
    // Engine caps to 10%, converted back to fixed: 200 * (10/100) = 20
    assert.equal(result.authorizedDiscount, 20);
  });

  it("rejects zero-value discount (not requested)", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 0, minimumMarginPercent: 0 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 0, "percent");
    assert.equal(result.approved, false);
  });

  it("handles zero cart total gracefully", () => {
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 10, minimumMarginPercent: 0 };
    const zeroCart: Cart = { items: [], total: 0, currency: "BRL" };
    const result = adapter.authorizeDiscount(zeroCart, rules, 10, "fixed");
    // 10 fixed on 0 cart = 0% effective → engine says not requested (0%)
    assert.equal(result.approved, false);
  });
});