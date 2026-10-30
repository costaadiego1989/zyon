import test from "node:test";
import assert from "node:assert/strict";
import { storefrontIntentOutputSchema, isConsistentStorefrontIntent } from "./storefront-intent.schemas.js";
import { storefrontIntentPromptV1 } from "../prompts/storefront-intent.v1.js";

const allowed = { schemaVersion: 2, domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH",
  confidence: 0.95, requiresTool: true, needsProductDiscovery: true };

for (const domain of ["STORE_COMMERCE", "STORE_SUPPORT", "OUT_OF_SCOPE", "UNCLEAR"]) {
  test(`V2 schema accepts domain independently from the nine-intent vocabulary: ${domain}`, () => {
    const terminal = domain === "OUT_OF_SCOPE" || domain === "UNCLEAR";
    const result = storefrontIntentOutputSchema.safeParse({ ...allowed, domain,
      ...(terminal ? { intent: "COMPLEX_QUESTION", requiresTool: false, needsProductDiscovery: false } : {}) });
    assert.equal(result.success, true);
    if (result.success) assert.equal(isConsistentStorefrontIntent(result.data), true);
  });
}

for (const value of [
  { ...allowed, schemaVersion: 1 }, { ...allowed, domain: undefined }, { ...allowed, domain: null },
  { ...allowed, domain: "OTHER" }, { ...allowed, domain: "STORE_COMMERCE " },
  { ...allowed, intent: "OUT_OF_SCOPE" }, { ...allowed, confidence: "0.95" },
  { ...allowed, merchantId: "foreign" }, { ...allowed, message: "invented answer" },
]) test(`V2 schema rejects obsolete, unknown or extra classification data: ${JSON.stringify(value)}`, () => {
  assert.equal(storefrontIntentOutputSchema.safeParse(value).success, false);
});

for (const domain of ["OUT_OF_SCOPE", "UNCLEAR"]) for (const inconsistent of [
  { intent: "PRODUCT_SEARCH", requiresTool: false, needsProductDiscovery: false },
  { intent: "COMPLEX_QUESTION", requiresTool: true, needsProductDiscovery: false },
  { intent: "COMPLEX_QUESTION", requiresTool: false, needsProductDiscovery: true },
]) test(`V2 terminal domain cannot carry an executable intent or discovery: ${domain}/${JSON.stringify(inconsistent)}`, () => {
  const parsed = storefrontIntentOutputSchema.safeParse({ ...allowed, domain, ...inconsistent });
  assert.equal(parsed.success && isConsistentStorefrontIntent(parsed.data), false);
});

test("V2 prompt distinguishes an academic topic from a product title and store support", () => {
  assert.equal(storefrontIntentPromptV1.version, 2);
  const examples = storefrontIntentPromptV1.examples;
  const domains = new Set(examples.map(example => {
    const parsed = storefrontIntentOutputSchema.safeParse(example.output);
    assert.equal(parsed.success, true);
    if (!parsed.success) throw new Error("invalid_versioned_prompt_example");
    assert.equal(isConsistentStorefrontIntent(parsed.data), true);
    return Reflect.get(parsed.data, "domain");
  }));
  assert.deepEqual(domains, new Set(["STORE_COMMERCE", "STORE_SUPPORT", "OUT_OF_SCOPE", "UNCLEAR"]));
  assert.ok(examples.some(example => example.input === "Explique a sequência de Fibonacci"));
  assert.ok(examples.some(example => example.input === "Vocês vendem o livro Fibonacci?"));
});

test("contextual sales objections remain commerce without authorizing tools or product discovery", () => {
  const objections = new Map([
    ["Está caro para mim.", "NEGOTIATE_PRICE"],
    ["Meu orçamento não chega a esse valor.", "NEGOTIATE_PRICE"],
    ["Ainda não tenho certeza se vale a pena.", "COMPLEX_QUESTION"],
    ["Vou deixar para outra hora, obrigado.", "COMPLEX_QUESTION"],
  ]);
  const contextual = storefrontIntentPromptV1.examples.filter(example => objections.has(example.input));
  assert.equal(contextual.length, objections.size);
  assert.deepEqual(new Set(contextual.map(example => example.input)), new Set(objections.keys()));
  for (const example of contextual) {
    assert.equal("history" in example, true);
    const parsed = storefrontIntentOutputSchema.parse(example.output);
    assert.equal(parsed.domain, "STORE_COMMERCE");
    assert.equal(parsed.intent, objections.get(example.input));
    assert.equal(parsed.requiresTool, false);
    assert.equal(parsed.needsProductDiscovery, false);
    assert.equal(isConsistentStorefrontIntent(parsed), true);
  }
  assert.match(storefrontIntentPromptV1.rules.join(" "), /Sem contexto comercial suficiente, preserve UNCLEAR/);
});

test("contextual factual offer questions require current evidence without product discovery", () => {
  const questions = new Set([
    "Em outra loja vi esse mesmo item por um valor menor. O que vocês têm de diferente e qual condição está valendo aqui?",
    "Essa condição ainda está valendo?",
  ]);
  const contextual = storefrontIntentPromptV1.examples.filter(example => questions.has(example.input));
  assert.equal(contextual.length, questions.size);
  assert.deepEqual(new Set(contextual.map(example => example.input)), questions);
  for (const example of contextual) {
    assert.equal("history" in example, true);
    const parsed = storefrontIntentOutputSchema.parse(example.output);
    assert.equal(parsed.domain, "STORE_COMMERCE");
    assert.equal(parsed.intent, "NEGOTIATE_PRICE");
    assert.equal(parsed.requiresTool, true);
    assert.equal(parsed.needsProductDiscovery, false);
    assert.equal(isConsistentStorefrontIntent(parsed), true);
  }
});
