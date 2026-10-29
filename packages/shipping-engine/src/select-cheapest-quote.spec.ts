import test from "node:test";
import assert from "node:assert/strict";
import { selectCheapestQuote } from "./select-cheapest-quote.js";

test("selectCheapestQuote([]) returns null", () => {
  assert.strictEqual(selectCheapestQuote([]), null);
});

test("selectCheapestQuote picks lowest customerPriceCents", () => {
  const chosen = selectCheapestQuote([
    { carrierId: "correios", carrierLabel: "Correios", customerPriceCents: 2500 },
    { carrierId: "fedex_std", carrierLabel: "FedEx Standard", customerPriceCents: 1800 },
    { carrierId: "local_x", carrierLabel: "Local X", customerPriceCents: 5200 }
  ]);
  assert.strictEqual(chosen?.carrierId, "fedex_std");
});
