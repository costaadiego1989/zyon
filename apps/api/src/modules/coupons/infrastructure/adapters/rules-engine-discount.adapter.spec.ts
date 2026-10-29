import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { RulesEngineDiscountAdapter } from "./rules-engine-discount.adapter.js";
import { DEFAULT_MERCHANT_RULES } from "@zyon/shared-types";
import type { Cart, MerchantRules } from "@zyon/shared-types";
import { evaluateDiscountOffer } from "@zyon/rules-engine";

const adapter = new RulesEngineDiscountAdapter();

const BASE_CART: Cart = {
  items: [{ sku: "SKU-A", price: 200, cost: 100, quantity: 1, name: "Item A" }],
  total: 200,
  currency: "BRL"
};

describe("RulesEngineDiscountAdapter", () => {
  for(const scale of [1,100])it(`preserves exact fixed cents without a percent roundtrip at scale ${scale}`,()=>{
    const cart:Cart={currency:"BRL",total:47/scale,currentDiscount:0,
      items:[{sku:"SKU",name:"Synthetic",price:47/scale,quantity:1}],
      discountBudget:{version:1,originalSubtotalCents:5000/scale,promotionDiscountCents:300/scale}};
    const result=adapter.authorizeDiscount(cart,{...DEFAULT_MERCHANT_RULES,maxDiscountPercent:20},1/scale,"fixed");
    assert.equal(result.approved,true);assert.equal(result.authorizedDiscount,1/scale);
  });
  it("fixed cents still consume only the remaining combined P+D ceiling",()=>{
    const cart:Cart={currency:"BRL",total:47,currentDiscount:0,items:[{sku:"SKU",name:"Synthetic",price:47,quantity:1}],
      discountBudget:{version:1,originalSubtotalCents:5000,promotionDiscountCents:300}};
    const result=adapter.authorizeDiscount(cart,{...DEFAULT_MERCHANT_RULES,maxDiscountPercent:20},10,"fixed");
    assert.equal(result.approved,true);assert.equal(result.authorizedDiscount,7);
  });
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

  it("preserves the company ceiling when informational margin is negative", () => {
    // Cart = 200, explicit product cost = 100.
    // margin before discount = 200 - 100 - (200*0.04 fees) = 92 / 200 = 46%
    // requesting 90% discount → subsidy = 180, margin = (200-100-8-180)/200 = negative
    const rules: MerchantRules = { ...DEFAULT_MERCHANT_RULES, maxDiscountPercent: 90, minimumMarginPercent: 38 };
    const result = adapter.authorizeDiscount(BASE_CART, rules, 90, "percent");
    // Approved user policy: cost/margin is diagnostic, never grant authority.
    assert.equal(result.approved, true);
    assert.equal(result.authorizedDiscount, 90);
    assert.equal(result.authorizedDiscount, rules.maxDiscountPercent);
    const diagnostic = evaluateDiscountOffer(BASE_CART, rules, 90);
    assert.ok(diagnostic.marginAfterOffer < 0);
    const capped = adapter.authorizeDiscount(BASE_CART, { ...rules, maxDiscountPercent: 10, minimumMarginPercent: 99 }, 90, "percent");
    assert.equal(capped.approved, true);
    assert.equal(capped.authorizedDiscount, 10);
    assert.ok(capped.reason.includes("capped"));
  });

  it("handles fixed discount directly in exact cents", () => {
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
