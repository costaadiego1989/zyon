import test from "node:test";
import assert from "node:assert/strict";
import { applyFreeShippingPolicy } from "./free-shipping.policy.js";

const results = [
  { carrier_key: "pac", label: "Correios PAC", price: 1500, eta_days: 5, is_free: false },
  { carrier_key: "loggi", label: "Loggi Express", price: 2500, eta_days: 2, is_free: false },
  { carrier_key: "sedex", label: "Correios Sedex", price: 3000, eta_days: 1, is_free: false }
];

test("applyFreeShippingPolicy returns empty when disabled", () => {
  const out = applyFreeShippingPolicy(results, 1000, {
    enabled: false,
    min_cart_total: 100
  });
  assert.deepEqual(out, []);
});

test("applyFreeShippingPolicy returns empty when cart_total below threshold", () => {
  const out = applyFreeShippingPolicy(results, 50, {
    enabled: true,
    min_cart_total: 100
  });
  assert.deepEqual(out, []);
});

test("applyFreeShippingPolicy returns empty when results empty", () => {
  const out = applyFreeShippingPolicy([], 1000, {
    enabled: true,
    min_cart_total: 100
  });
  assert.deepEqual(out, []);
});

test("applyFreeShippingPolicy returns EXACTLY ONE free entry (cheapest eligible carrier)", () => {
  const out = applyFreeShippingPolicy(results, 200, {
    enabled: true,
    min_cart_total: 100
  });
  assert.equal(out.length, 1, "exactly one free entry per ADR §6.2");
  assert.equal(out[0]!.carrier_key, "pac", "cheapest paid carrier becomes the free one");
  assert.equal(out[0]!.price, 0);
  assert.equal(out[0]!.is_free, true);
  assert.equal(out[0]!.eta_days, 5);
  assert.equal(out[0]!.label, "Correios PAC");
});

test("applyFreeShippingPolicy tie-breaks by soonest eta then alphabetic label (pt-BR)", () => {
  const tied = [
    { carrier_key: "a", label: "Trans A", price: 1000, eta_days: 5, is_free: false },
    { carrier_key: "b", label: "Trans B", price: 1000, eta_days: 5, is_free: false },
    { carrier_key: "c", label: "Ágil C", price: 1000, eta_days: 3, is_free: false } // accented label
  ];
  const out = applyFreeShippingPolicy(tied, 200, {
    enabled: true,
    min_cart_total: 100
  });
  assert.equal(out.length, 1);
  // Soonest eta wins regardless of accent on label
  assert.equal(out[0]!.carrier_key, "c");
  assert.equal(out[0]!.price, 0);
});

test("applyFreeShippingPolicy does not surface paid options as free", () => {
  const out = applyFreeShippingPolicy(results, 200, {
    enabled: true,
    min_cart_total: 100
  });
  assert.ok(out.every((r) => r.is_free === true), "all returned variants must be free");
  assert.ok(out.every((r) => r.price === 0), "all returned variants must be priced at zero");
});

test("applyFreeShippingPolicy satisfies threshold exactly (>=)", () => {
  // cart_total == min_cart_total should qualify (>=)
  const out = applyFreeShippingPolicy(results, 100, {
    enabled: true,
    min_cart_total: 100
  });
  assert.equal(out.length, 1, "exactly-equal cart total qualifies");
  assert.equal(out[0]!.price, 0);
});
