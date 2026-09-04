import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  resolveCrossSellCartItem,
  resolveCrossSellProduct,
} from "./cross-sell-product-resolver.js";

describe("cross-sell-product-resolver", () => {
  describe("resolveCrossSellProduct", () => {
    it("returns catalog metadata for a known SKU", () => {
      const result = resolveCrossSellProduct("NECS-001");
      assert.equal(result.sku, "NECS-001");
      assert.equal(result.name, "Necessaire Executiva");
      assert.equal(result.unit_price, 49.9);
      assert.equal(result.category, "acessorios");
      assert.equal(result.variant, "preta");
    });

    it("returns Zyon hoodie metadata for the production cross-sell SKU", () => {
      const result = resolveCrossSellProduct("ZYON-HOOD-001");
      assert.equal(result.sku, "ZYON-HOOD-001");
      assert.equal(result.name, "Hoodie Agentic Checkout");
      assert.equal(result.unit_price, 199.9);
      assert.equal(result.category, "vestuario");
    });

    it("propagates the suggestion_id when provided", () => {
      const result = resolveCrossSellProduct("NECS-001", "sugg_xyz");
      assert.equal(result.suggestion_id, "sugg_xyz");
    });

    it("leaves suggestion_id undefined when not provided", () => {
      const result = resolveCrossSellProduct("NECS-001");
      assert.equal(result.suggestion_id, undefined);
    });

    it("falls back to humanized default product for unknown SKUs", () => {
      const result = resolveCrossSellProduct("UNKNOWN-SKU-99");
      assert.equal(result.sku, "UNKNOWN-SKU-99");
      assert.equal(result.name, "Unknown Sku 99");
      assert.equal(result.category, "complemento");
      assert.equal(result.unit_price, 59.9);
    });

    it("humanizes underscore-separated SKUs", () => {
      const result = resolveCrossSellProduct("CART_Slim_RFID");
      assert.equal(result.name, "Cart Slim Rfid");
    });
  });

  describe("resolveCrossSellCartItem", () => {
    it("returns catalog cart item with default quantity=1 for known SKU", () => {
      const item = resolveCrossSellCartItem("CART-COE-01");
      assert.equal(item.sku, "CART-COE-01");
      assert.equal(item.name, "Carteira Slim RFID");
      assert.equal(item.price, 89.9);
      assert.equal(item.cost, 34);
      assert.equal(item.quantity, 1);
      assert.equal(item.category, "acessorios");
      assert.equal(item.variant, "couro");
    });

    it("returns fallback cart item for unknown SKU", () => {
      const item = resolveCrossSellCartItem("ZZZ-NEW");
      assert.equal(item.sku, "ZZZ-NEW");
      assert.equal(item.name, "Zzz New");
      assert.equal(item.price, 59.9);
      assert.equal(item.cost, 24);
      assert.equal(item.quantity, 1);
      assert.equal(item.category, "complemento");
    });

    it("humanizes SKU for empty string fallback", () => {
      const item = resolveCrossSellCartItem("");
      assert.equal(item.name, "Produto complementar");
    });
  });
});