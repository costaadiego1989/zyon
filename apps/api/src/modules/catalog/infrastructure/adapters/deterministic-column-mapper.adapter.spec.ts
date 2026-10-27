import assert from "node:assert/strict";
import test from "node:test";
import { DeterministicColumnMapper } from "./deterministic-column-mapper.adapter.js";

test("maps pt-BR headers with accents/parens to canonical fields", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["Nome do Produto", "Código", "Preço (R$)", "Estoque"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, {
    "Nome do Produto": "name",
    "Código": "sku",
    "Preço (R$)": "price",
    "Estoque": "stock",
  });
});

test("maps en headers to canonical fields", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["Name", "SKU", "Price", "Stock", "Weight (g)"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, {
    Name: "name",
    SKU: "sku",
    Price: "price",
    Stock: "stock",
    "Weight (g)": "weight_grams",
  });
});

test("maps 'Peso (kg)' to weight_grams and infers weightInKg unit hint", async () => {
  // Regression: a real merchant CSV had "Peso (kg)" which previously did not map,
  // causing every physical-product row to fail (physical_product_requires_weight).
  const mapper = new DeterministicColumnMapper();
  const headers = ["Produto", "SKU", "Preço (R$)", "Peso (kg)", "Altura (cm)", "Largura (cm)", "Comprimento (cm)"];
  const result = await mapper.mapColumns(headers, []);
  assert.equal(result.mapping["Produto"], "name");
  assert.equal(result.mapping["Peso (kg)"], "weight_grams");
  assert.equal(result.mapping["Altura (cm)"], "height_cm");
  assert.equal(result.mapping["Largura (cm)"], "width_cm");
  assert.equal(result.mapping["Comprimento (cm)"], "length_cm");
  assert.equal(result.unitHints?.weightInKg, true, "kg header must set weightInKg so the normalizer converts to grams");
});

test("grams header does NOT set weightInKg", async () => {
  const mapper = new DeterministicColumnMapper();
  const result = await mapper.mapColumns(["Nome", "Peso (g)"], []);
  assert.equal(result.mapping["Peso (g)"], "weight_grams");
  assert.equal(result.unitHints?.weightInKg, false);
});

test("case-insensitive matching preserves the original header as key", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["NOME", "sku", "PrEcO"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, {
    NOME: "name",
    sku: "sku",
    PrEcO: "price",
  });
});

test("unknown headers are omitted from mapping", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["name", "foo bar", "sku", "baz"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, { name: "name", sku: "sku" });
});

test("maps dimensional aliases (comprimento/largura/altura)", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["Comprimento (cm)", "Largura", "Altura"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, {
    "Comprimento (cm)": "length_cm",
    Largura: "width_cm",
    Altura: "height_cm",
  });
});

test("maps description and category aliases", async () => {
  const mapper = new DeterministicColumnMapper();
  const headers = ["Descrição", "Categoria"];
  const result = await mapper.mapColumns(headers, []);
  assert.deepEqual(result.mapping, {
    Descrição: "description",
    Categoria: "category",
  });
});
