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
