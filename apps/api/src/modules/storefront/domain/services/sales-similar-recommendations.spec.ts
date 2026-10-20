import test from "node:test";
import assert from "node:assert/strict";
import { contextualSearchGroups } from "../../../catalog/domain/services/contextual-product-search.js";
import { createSalesSearchPolicy } from "./sales-search-policy.js";
import { normalizeSalesText, salesRecommendationContext } from "./sales-recommendation-intent.js";

// Unlike the former all-products fixture, this obeys the actual SQL's AND of
// lexical synonym groups. The catalog intentionally has no "pele oleosa" text.
const catalog = [
  { id: "serum", name: "Sérum de Barreira", description: "Hidratação leve, ceramidas e niacinamida, sem fragrância adicionada.", price: 12990, inStock: true },
  { id: "bruma", name: "Bruma de Hidratação", description: "Bruma facial de hidratação leve.", price: 7990, inStock: true },
  { id: "sunscreen", name: "Protetor FPS 50", description: "Protetor facial de uso diário.", price: 9990, inStock: true },
  { id: "running", name: "Tênis de corrida", description: "Running para correr, cor preta, tamanho 42.", price: 18990, inStock: true },
  { id: "casual", name: "Tênis casual verde", description: "Tênis para passeio, tamanho 42.", price: 9990, inStock: true },
  { id: "hair", name: "Sérum capilar", description: "Cuidado do cabelo, ceramidas, hidratação e controle da oleosidade.", price: 3990, inStock: true },
  { id: "qa", name: "QA comida", description: "Teste de pedido.", price: 500, inStock: true },
];
function fixture(message: string, history: Array<{ role: "user" | "assistant"; content: string }> = [], products = catalog) {
  const calls: any[] = [];
  const policy = createSalesSearchPolicy(message, history);
  const [tool] = policy.wrap([{ name: "search_products", execute: async args => {
    calls.push(args);
    const groups = contextualSearchGroups(String(args.query));
    return { ok: true, data: { products: products.filter(product => product.inStock
      && (args.maxPrice === undefined || product.price <= Number(args.maxPrice))
      && groups.length > 0 && groups.every(group => group.some(term => normalizeSalesText(`${product.name} ${product.description}`).includes(term))))
      .slice(0, Number(args.limit)) } };
  } }]);
  return { policy, calls, search: async (query: string) => (await tool!.execute({ query, limit: 20 }) as any).data };
}

test("oily skin finds disclosed related skincare without inventing oil-control suitability", async () => {
  const f = fixture("Oleosa", [{ role: "user", content: "Quero um produto para pele" }, { role: "assistant", content: "Como é sua pele?" }]);
  const result = await f.search("pele oleosa");
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].query, /oleosa/);
  assert.doesNotMatch(f.calls[1].query, /oleosa/);
  assert.ok(result.products.length > 0 && result.products.length <= 3);
  assert.ok(result.products.every((p: any) => !["hair", "qa", "running", "casual"].includes(p.id)));
  assert.equal(result.recommendationMatch.type, "similar");
  assert.match(f.policy.recommendationMessage!, /não confirma indicação para pele oleosa/);
  await f.search("*");
  assert.equal(f.calls.length, 2, "confirmed alternatives are reused, not paid for again");
});

test("a no-match answer does not erase skin context on an old quick-reply selection", async () => {
  const f = fixture("Controle da oleosidade", [
    { role: "user", content: "Quero um produto para pele" }, { role: "assistant", content: "Como é sua pele?" },
    { role: "user", content: "Oleosa" }, { role: "assistant", content: "Qual seu objetivo?" },
    { role: "user", content: "Cuidar da pele" }, { role: "assistant", content: "Não encontrei uma correspondência confirmada." },
  ]);
  const result = await f.search("controle da oleosidade");
  assert.ok(result.products.length > 0);
  assert.match(f.policy.recommendationMessage!, /controle da oleosidade/);
  assert.ok(result.products.every((p: any) => p.id !== "hair"));
});

test("green running shoes fall back to running shoes, not green casual shoes, with color disclosure", async () => {
  const f = fixture("Quero comprar um tênis de corrida verde até R$ 200");
  const result = await f.search("tênis");
  assert.deepEqual(result.products.map((p: any) => p.id), ["running"]);
  assert.equal(f.calls.length, 2);
  assert.ok(f.calls.every(call => /corrida/.test(call.query) && call.maxPrice === 20000 && call.limit === 3 && call.inStockOnly));
  assert.match(f.policy.recommendationMessage!, /cor verde/);
});

test("an exact match wins without a similarity lookup or misleading no-match notice", async () => {
  const f = fixture("Tênis de corrida preto até R$ 200");
  const result = await f.search("tênis de corrida preto");
  assert.deepEqual(result.products.map((p: any) => p.id), ["running"]);
  assert.equal(f.calls.length, 1);
  assert.equal(result.recommendationMatch, undefined);
  assert.equal(f.policy.recommendationMessage, undefined);
});

test("similar skincare preserves hydration, fragrance exclusion and budget using published synonyms", async () => {
  const f = fixture("Quero hidratante para pele oleosa sem perfume, até R$ 150");
  const result = await f.search("hidratante");
  assert.deepEqual(result.products.map((p: any) => p.id), ["serum"]);
  assert.ok(f.calls.every(call => /sem perfume/.test(call.query) && /hidrat/.test(call.query) && call.maxPrice === 15000));
});

test("mandatory color, medical restrictions, size, material and budget never become optional", async () => {
  for (const message of ["Quero tênis de corrida somente verde", "Quero tênis de corrida verde tamanho 43", "Quero tênis de corrida verde de couro",
    "Quero tênis de corrida verde até R$ 100", "Quero hidratante para pele oleosa, tenho alergia, sem perfume"]) {
    const f = fixture(message);
    const result = await f.search("*");
    assert.deepEqual(result.products, [], message);
    assert.equal(f.policy.recommendationMessage, undefined);
    assert.ok(f.calls.length <= 2);
    assert.ok(f.calls.every(call => call.query !== "*"));
    if (/somente/.test(message)) assert.equal(f.calls.length, 1);
  }
});

test("a different product need drops old skin restrictions and budget, but same-family follow-ups keep them", () => {
  const history = [{ role: "user" as const, content: "Quero hidratante para pele oleosa sem perfume até R$ 80" },
    { role: "assistant" as const, content: "Não encontrei correspondências." }];
  assert.equal(salesRecommendationContext("Quero tênis de corrida verde", history), "Quero tênis de corrida verde");
  assert.match(salesRecommendationContext("Quero hidratação leve", history), /sem perfume até R\$ 80/);
  assert.equal(salesRecommendationContext("Preto", [...history,
    { role: "user", content: "Quero tênis de corrida" }, { role: "assistant", content: "Tem alguma preferência de cor?" },
  ]), "Quero tênis de corrida. Preto");
  assert.match(salesRecommendationContext("Quero hidratação", [
    { role: "user", content: "Quero um produto para meu cabelo cacheado sem perfume" },
    { role: "assistant", content: "Qual cuidado procura?" },
  ]), /cabelo cacheado sem perfume/);
});

test("out-of-stock and over-budget partner products do not fill a similar carousel", async () => {
  const policy = createSalesSearchPolicy("Quero tênis de corrida verde até R$ 200", []);
  let count = 0;
  const [tool] = policy.wrap([{ name: "search_products", execute: async () => ({ ok: true, data: { products: ++count === 1 ? [] : [
    { id: "out", name: "Tênis de corrida", inStock: false, price: 10000 }, { id: "high", name: "Tênis de corrida", inStock: true, price: 21000 },
  ] } }) }]);
  assert.deepEqual((await tool!.execute({ query: "tênis corrida verde" }) as any).data.products, []);
  assert.equal(policy.recommendationMessage, undefined);
});
