import test from "node:test";
import assert from "node:assert/strict";
import { buildCatalog, categoryFor, getTemplateDefinition } from "./template-catalog.js";
import { WHATSAPP_TEMPLATE_TYPES } from "./template-types.js";

test("catalog covers every declared type", () => {
  const cat = buildCatalog();
  for (const t of WHATSAPP_TEMPLATE_TYPES) {
    assert.ok(cat[t], `missing catalog def for ${t}`);
  }
});

test("every def has positional metaBody + coherent variableMap", () => {
  const cat = buildCatalog("Loja X");
  for (const t of WHATSAPP_TEMPLATE_TYPES) {
    const def = cat[t];
    assert.doesNotMatch(def.metaBody, /\{\{[a-zA-Z]/, `${t} metaBody has named placeholder`);
    const positions = [...def.metaBody.matchAll(/\{\{(\d+)\}\}/g)].map((m) => m[1]);
    for (const p of positions) {
      assert.ok(def.variableMap[p], `${t} variableMap missing pos ${p}`);
      assert.ok(def.sampleVariables[p] !== undefined, `${t} sampleVariables missing pos ${p}`);
    }
    // storeName is inlined, never a positional variable
    assert.ok(!Object.values(def.variableMap).includes("storeName"));
  }
});

test("categories: only cross_sell/win_back/cart_recovery are MARKETING", () => {
  assert.equal(categoryFor("cross_sell"), "MARKETING");
  assert.equal(categoryFor("win_back"), "MARKETING");
  assert.equal(categoryFor("cart_recovery"), "MARKETING");
  assert.equal(categoryFor("follow_up"), "UTILITY");
  assert.equal(categoryFor("order_confirmation"), "UTILITY");
  assert.equal(categoryFor("nps"), "UTILITY");
});

test("coupon-bearing types expose a couponBlock variable", () => {
  const cat = buildCatalog();
  for (const t of ["cross_sell", "win_back", "loyalty", "reorder", "cart_recovery"] as const) {
    assert.ok(Object.values(cat[t].variableMap).includes("couponBlock"), `${t} should have couponBlock`);
  }
  for (const t of ["follow_up", "review_request", "nps", "order_confirmation"] as const) {
    assert.ok(!Object.values(cat[t].variableMap).includes("couponBlock"), `${t} should NOT have couponBlock`);
  }
});

test("order templates surface orderId; shipped surfaces trackingCode", () => {
  const cat = buildCatalog();
  assert.ok(Object.values(cat.order_confirmation.variableMap).includes("orderId"));
  assert.ok(Object.values(cat.order_shipped.variableMap).includes("trackingCode"));
});

test("getTemplateDefinition inlines storeName", () => {
  const def = getTemplateDefinition("follow_up", "Minha Loja");
  assert.match(def.metaBody, /Minha Loja/);
});
