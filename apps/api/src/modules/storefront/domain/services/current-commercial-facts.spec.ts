import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentCommercialFacts, type CurrentCommercialFactsInput } from "./current-commercial-facts.js";
import { validateStorefrontMessage } from "../tools/safety-validator.js";

const input: CurrentCommercialFactsInput = { intent: "NEGOTIATE_PRICE", requiresTool: true, productDiscovery: false,
  hasWriteAttempt: false, toolsUsed: ["list_promotions", "get_daily_deals"], now: new Date("2026-10-30T17:40:00Z"),
  allowStackDiscountAndFreeShipping: false, toolResults: {
    list_promotions: { promotions: [], coupons: [], progressive: { maxPercent: 10, description: "PRIVATE_UNGRANTED_CEILING" } },
    get_daily_deals: { deals: [{ id: "complete", name: "Kit Completo", price: 9000, originalPrice: 10000,
      inStock: true, discountPercent: 10, expiresAt: "2026-10-30T21:00:00Z", expiresAtFormatted: "30/10/2026, 18:00 (horário de Brasília)" }] },
  } };

test("current facts show canonical cents, reference and timezone, but no granted benefit or progressive ceiling", () => {
  const result = buildCurrentCommercialFacts(input)!;
  assert.match(result, /Kit Completo/); assert.match(result, /90,00/); assert.match(result, /100,00/);
  assert.match(result, /18:00 \(horário de Brasília\)/); assert.match(result, /não permite acumular/);
  assert.match(result, /não aplica benefícios nem altera/); assert.match(result, /Seleção limitada/);
  assert.doesNotMatch(result, /PRIVATE_UNGRANTED_CEILING|10%|frete grátis|benefício aplicado|dentro do orçamento/);
  assert.equal(validateStorefrontMessage(result, { toolResults: input.toolResults }).safe, true);
});

for (const patch of [{ intent: "ADD_CART" }, { requiresTool: false }, { productDiscovery: true },
  { hasWriteAttempt: true }, { toolsUsed: ["get_daily_deals"] }, { toolsUsed: ["list_promotions"] },
  { toolsUsed: [...input.toolsUsed, "create_question"] }, { toolsUsed: [...input.toolsUsed, "apply_coupon"] },
  { toolsUsed: [...input.toolsUsed, "unknown_tool"] }]) {
  test(`facts cannot replace another intent, discovery, missing reads or a write: ${JSON.stringify(patch)}`, () => {
    assert.equal(buildCurrentCommercialFacts({ ...input, ...patch }), undefined);
  });
}

for (const result of [undefined, {}, { error: "unavailable", deals: [] }, { ok: false, deals: [] },
  { success: false, deals: [] }, { deals: [{ id: "invalid" }] }]) {
  test(`a failed or malformed current read stays unconfirmed: ${JSON.stringify(result)}`, () => {
    assert.equal(buildCurrentCommercialFacts({ ...input, toolResults: { ...input.toolResults, get_daily_deals: result } }), undefined);
  });
}

test("both current reads are required even when deals alone look usable", () => {
  assert.equal(buildCurrentCommercialFacts({ ...input,
    toolResults: { ...input.toolResults, list_promotions: { error: "unavailable", promotions: [], coupons: [] } } }), undefined);
});

test("a failed supplemental product read cannot become a general offer answer", () => {
  assert.equal(buildCurrentCommercialFacts({ ...input, toolsUsed: [...input.toolsUsed, "get_product_details"],
    toolResults: { ...input.toolResults, get_product_details: { error: "product_not_found" } } }), undefined);
});

test("true or absent stacking policy grants no joint eligibility or false denial", () => {
  for (const policy of [undefined, true]) {
    const result = buildCurrentCommercialFacts({ ...input, allowStackDiscountAndFreeShipping: policy })!;
    assert.match(result, /não confirma a elegibilidade conjunta/); assert.doesNotMatch(result, /não permite acumular|podem ser acumulados/);
  }
});

test("expired facts are omitted instead of repeating stale prices or claiming global absence", () => {
  const result = buildCurrentCommercialFacts({ ...input, now: new Date("2026-10-31T00:00:00Z") })!;
  assert.doesNotMatch(result, /Kit Completo|90,00|18:00/);
  assert.match(result, /Esta consulta não retornou/); assert.doesNotMatch(result, /não existe oferta/);
});

test("only three current prices are shown and the bounded selection remains explicit", () => {
  const deals = Array.from({ length: 4 }, (_, index) => ({ id: `p${index}`, name: `Produto ${index}`, price: 1000 + index, inStock: true }));
  const result = buildCurrentCommercialFacts({ ...input,
    toolResults: { ...input.toolResults, get_daily_deals: { deals } } })!;
  assert.match(result, /Produto 0/); assert.match(result, /Produto 2/); assert.doesNotMatch(result, /Produto 3/);
  assert.match(result, /pode haver outras opções/);
});
