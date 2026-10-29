import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateColumnMapping } from "./validate-column-mapping.js";

describe("validateColumnMapping", () => {
  const detectedHeaders = ["Product Name", "SKU", "Price", "Stock Quantity"];

  describe("Valid mappings", () => {
    it("should accept valid mapping with required fields", () => {
      const raw = {
        "Product Name": "name",
        SKU: "sku",
        Price: "price",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.deepStrictEqual(result.mapping, {
          "Product Name": "name",
          SKU: "sku",
          Price: "price",
        });
      }
    });

    it("should accept mapping with all canonical fields", () => {
      const raw = {
        "Product Name": "name",
        SKU: "sku",
        Price: "price",
        "Stock Quantity": "stock",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(Object.keys(result.mapping).length, 4);
      }
    });
  });

  describe("Invalid input types", () => {
    it("should reject string input", () => {
      const result = validateColumnMapping("not an object", detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "not_an_object");
      }
    });

    it("should reject number input", () => {
      const result = validateColumnMapping(123, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "not_an_object");
      }
    });

    it("should reject null input", () => {
      const result = validateColumnMapping(null, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "not_an_object");
      }
    });

    it("should reject array input", () => {
      const result = validateColumnMapping(["name", "sku"], detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "not_an_object");
      }
    });
  });

  describe("Unknown header keys", () => {
    it("should drop unknown header keys and keep valid entries", () => {
      const raw = {
        "Product Name": "name",
        "Unknown Header": "sku",
        SKU: "sku",
        Price: "price",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("Unknown Header" in result.mapping, false);
        assert.strictEqual(result.mapping.SKU, "sku");
      }
    });

    it("should handle case-insensitive header matching and normalize to detected header", () => {
      const raw = {
        "product name": "name", // lowercase, should match "Product Name"
        sku: "sku", // lowercase, should match "SKU"
        PRICE: "price", // uppercase, should match "Price"
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(result.mapping["Product Name"], "name");
        assert.strictEqual(result.mapping.SKU, "sku");
        assert.strictEqual(result.mapping.Price, "price");
      }
    });
  });

  describe("Invalid canonical field values", () => {
    it("should drop entries with non-canonical field values", () => {
      const raw = {
        "Product Name": "name",
        SKU: "Camiseta Azul", // row value, not canonical
        Price: "price",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("SKU" in result.mapping, false);
        assert.strictEqual(result.mapping["Product Name"], "name");
      }
    });

    it("should drop entries with numeric values", () => {
      const raw = {
        "Product Name": "name",
        Price: 9999, // number, not canonical
        "Stock Quantity": "stock",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual("Price" in result.mapping, false);
        assert.strictEqual(result.mapping["Stock Quantity"], "stock");
      }
    });
  });

  describe("Missing required fields", () => {
    it("should reject when name, sku, and price are all absent", () => {
      const raw = {
        "Stock Quantity": "stock",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "no_usable_columns");
      }
    });

    it("should accept when at least one of name, sku, price is present", () => {
      const raw = {
        "Product Name": "name",
        "Stock Quantity": "stock",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
    });

    it("should accept when all non-essential fields are present and at least one essential field", () => {
      const raw = {
        Price: "price",
        "Stock Quantity": "stock",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
    });
  });

  describe("Duplicate canonical targets", () => {
    it("should keep first header mapping to same canonical field and drop rest", () => {
      const raw = {
        "Product Name": "name",
        SKU: "name", // duplicate target
        Price: "price",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        const namesCount = Object.values(result.mapping).filter((v) => v === "name").length;
        assert.strictEqual(namesCount, 1);
        assert.strictEqual(result.mapping["Product Name"], "name");
        assert.strictEqual("SKU" in result.mapping, false);
      }
    });
  });

  describe("LLM row-value corruption scenarios", () => {
    it("should reject when all entries are row values posing as canonical", () => {
      const raw = {
        "Product Name": "Camiseta Azul",
        SKU: "SKU12345",
        Price: "R$99.90",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "no_usable_columns");
      }
    });

    it("should handle mixed valid and corrupt entries", () => {
      const raw = {
        "Product Name": "name",
        SKU: "Camiseta Azul", // corruption
        Price: "price",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, true);
      if (result.ok) {
        assert.strictEqual(Object.keys(result.mapping).length, 2);
        assert.strictEqual("SKU" in result.mapping, false);
      }
    });
  });

  describe("Empty and edge cases", () => {
    it("should reject empty object", () => {
      const result = validateColumnMapping({}, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "no_usable_columns");
      }
    });

    it("should reject object with only invalid fields after filtering", () => {
      const raw = {
        "Unknown Col": "unknown_field",
      };
      const result = validateColumnMapping(raw, detectedHeaders);
      assert.strictEqual(result.ok, false);
      if (!result.ok) {
        assert.strictEqual(result.reason, "no_usable_columns");
      }
    });
  });
});
