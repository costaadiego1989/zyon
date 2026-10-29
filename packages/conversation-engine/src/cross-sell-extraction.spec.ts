import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractSuggestedSkus, stripSuggestMarker } from "./cross-sell-extraction.js";

describe("extractSuggestedSkus", () => {
  it("extracts SKUs from [SUGGEST:sku1,sku2] marker in LLM output", () => {
    const text = "Para complementar seu look, recomendo o cinto reversível. [SUGGEST:lux_cinto_01,lux_carteira_01]";
    assert.deepEqual(extractSuggestedSkus(text), ["lux_cinto_01", "lux_carteira_01"]);
  });

  it("returns empty array when no marker present", () => {
    const text = "Ótima escolha! Vou finalizar seu pedido.";
    assert.deepEqual(extractSuggestedSkus(text), []);
  });

  it("handles single SKU", () => {
    const text = "Recomendo o cinto. [SUGGEST:lux_cinto_01] Vamos continuar?";
    assert.deepEqual(extractSuggestedSkus(text), ["lux_cinto_01"]);
  });

  it("uses first marker only when multiple present", () => {
    const text = "[SUGGEST:sku_a] texto [SUGGEST:sku_b]";
    assert.deepEqual(extractSuggestedSkus(text), ["sku_a"]);
  });

  it("trims whitespace from SKUs", () => {
    const text = "[SUGGEST: tech_hub_01 , tech_fone_01 ]";
    assert.deepEqual(extractSuggestedSkus(text), ["tech_hub_01", "tech_fone_01"]);
  });

  it("ignores empty SKUs", () => {
    const text = "[SUGGEST:sku_a,,sku_b,]";
    assert.deepEqual(extractSuggestedSkus(text), ["sku_a", "sku_b"]);
  });
});

describe("stripSuggestMarker", () => {
  it("removes [SUGGEST:...] from message text", () => {
    const text = "Recomendo o cinto. [SUGGEST:lux_cinto_01] Vamos continuar?";
    assert.equal(stripSuggestMarker(text), "Recomendo o cinto.  Vamos continuar?");
  });

  it("returns original text when no marker", () => {
    assert.equal(stripSuggestMarker("Sem marcador"), "Sem marcador");
  });
});
