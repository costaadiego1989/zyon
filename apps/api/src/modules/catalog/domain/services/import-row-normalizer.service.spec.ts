import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ColumnMapping } from "../ports/column-mapper.port.js";
import { normalizeRow } from "./import-row-normalizer.service.js";

const MERCHANT = "merchant_1";

const FULL_MAPPING: ColumnMapping = {
  Nome: "name",
  SKU: "sku",
  Preco: "price",
  Estoque: "stock",
  Peso: "weight_grams",
  Comprimento: "length_cm",
  Largura: "width_cm",
  Altura: "height_cm",
  Descricao: "description",
  Categoria: "category",
};

function baseRow(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    Nome: "Cadeira",
    SKU: "CAD-001",
    Preco: "99,90",
    Estoque: "5",
    Peso: "1200",
    Comprimento: "40",
    Largura: "45",
    Altura: "90",
    Descricao: "Cadeira confortavel",
    Categoria: "Moveis",
    ...overrides,
  };
}

describe("normalizeRow", () => {
  it("happy path: pt-BR reais 99,90 -> 9990 cents, one product one variant", () => {
    const res = normalizeRow({
      row: baseRow(),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 1,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const input = res.input;
    assert.equal(input.merchantId, MERCHANT);
    assert.equal(input.name, "Cadeira");
    assert.equal(input.description, "Cadeira confortavel");
    assert.equal(input.categoryId, "Moveis");
    assert.equal(input.variants.length, 1);
    const v = input.variants[0];
    assert.equal(v.sku, "CAD-001");
    assert.deepEqual(v.attributes, {});
    assert.equal(v.basePriceInCents, 9990);
    assert.equal(v.currency, "BRL");
    assert.equal(v.stockQuantity, 5);
    assert.equal(v.weightGrams, 1200);
    assert.equal(v.lengthCm, 40);
    assert.equal(v.widthCm, 45);
    assert.equal(v.heightCm, 90);
  });

  it("pt-BR thousands: 1.234,56 -> 123456 cents", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "1.234,56" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 2,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].basePriceInCents, 123456);
  });

  it("en-format thousands: 1,234.56 -> 123456 cents", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "1,234.56" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 3,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].basePriceInCents, 123456);
  });

  it("en-format simple: 99.90 -> 9990 cents", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "99.90" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 4,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].basePriceInCents, 9990);
  });

  it("priceInReais=false treats number as cents directly", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "9990" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 5,
      unitHints: { priceInReais: false },
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].basePriceInCents, 9990);
  });

  it("missing name -> missing_name error", () => {
    const res = normalizeRow({
      row: baseRow({ Nome: "  " }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 6,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "missing_name");
    assert.equal(res.error.row, 6);
  });

  it("missing sku -> missing_sku error (carries no sku)", () => {
    const res = normalizeRow({
      row: baseRow({ SKU: "" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 7,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "missing_sku");
  });

  it("invalid price (non-numeric) -> invalid_price error, sku attached", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "abc" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 8,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "invalid_price");
    assert.equal(res.error.sku, "CAD-001");
  });

  it("zero price -> invalid_price error", () => {
    const res = normalizeRow({
      row: baseRow({ Preco: "0" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 9,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "invalid_price");
  });

  it("physical product missing weight -> physical_product_requires_weight", () => {
    const res = normalizeRow({
      row: baseRow({ Peso: "" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 10,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "physical_product_requires_weight");
  });

  it("physical product zero weight -> physical_product_requires_weight", () => {
    const res = normalizeRow({
      row: baseRow({ Peso: "0" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 11,
    });
    assert.equal(res.ok, false);
    if (res.ok) return;
    assert.equal(res.error.reason, "physical_product_requires_weight");
  });

  it("digital product does not require weight", () => {
    const res = normalizeRow({
      row: baseRow({ Peso: "" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 12,
      productType: "digital",
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.type, "digital");
    assert.equal(res.input.variants[0].weightGrams, undefined);
  });

  it("weightInKg hint: 2 -> 2000 grams", () => {
    const res = normalizeRow({
      row: baseRow({ Peso: "2" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 13,
      unitHints: { weightInKg: true },
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].weightGrams, 2000);
  });

  it("stock defaults to 0 when absent/blank", () => {
    const res = normalizeRow({
      row: baseRow({ Estoque: "" }),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 14,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.variants[0].stockQuantity, 0);
  });

  it("unknown canonical field in mapping is ignored gracefully", () => {
    const mapping = { ...FULL_MAPPING, Bogus: "not_a_field" } as unknown as ColumnMapping;
    const res = normalizeRow({
      row: baseRow({ Bogus: "whatever" }),
      mapping,
      merchantId: MERCHANT,
      rowIndex: 15,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.name, "Cadeira");
  });

  it("defaults product type to physical when productType omitted", () => {
    const res = normalizeRow({
      row: baseRow(),
      mapping: FULL_MAPPING,
      merchantId: MERCHANT,
      rowIndex: 16,
    });
    assert.equal(res.ok, true);
    if (!res.ok) return;
    assert.equal(res.input.type, "physical");
  });
});
