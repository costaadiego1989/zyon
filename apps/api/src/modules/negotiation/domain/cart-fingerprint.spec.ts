import test from "node:test";
import assert from "node:assert/strict";
import { negotiationCartFingerprint, checkoutCartFingerprint } from "./cart-fingerprint.js";
import type { Cart } from "@aacp/shared-types";

test("negotiation fingerprint ignores category and matches checkout cart order", () => {
  const neg = {
    total: 200,
    items: [
      { sku: "b", categoryId: "c1", price: 50, quantity: 2 },
      { sku: "a", price: 100, quantity: 1 }
    ]
  };
  const cart: Cart = {
    currency: "BRL",
    total: 200,
    items: [
      { sku: "a", name: "A", price: 100, quantity: 1 },
      { sku: "b", name: "B", price: 50, quantity: 2 }
    ]
  };
  assert.equal(negotiationCartFingerprint(neg), checkoutCartFingerprint(cart));
});
