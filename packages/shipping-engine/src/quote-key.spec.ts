import test from "node:test";
import assert from "node:assert/strict";
import {
  buildQuoteKey,
  computeQuoteExpiry,
  isQuoteExpired,
  DEFAULT_QUOTE_TTL_SECONDS
} from "./quote-key.js";

test("buildQuoteKey is deterministic regardless of item order and zip formatting", () => {
  const a = buildQuoteKey({
    merchantId: "MRC_1",
    destinationZip: "01310-100",
    cartTotalCents: 15000,
    items: [
      { sku: "B", quantity: 1 },
      { sku: "A", quantity: 2 }
    ]
  });
  const b = buildQuoteKey({
    merchantId: "mrc_1 ",
    destinationZip: "01310100",
    cartTotalCents: 15000,
    items: [
      { sku: "A", quantity: 2 },
      { sku: "B", quantity: 1 }
    ]
  });
  assert.equal(a, b);
});

test("buildQuoteKey differs when cart total or destination changes", () => {
  const base = { merchantId: "m", destinationZip: "01310100", cartTotalCents: 15000 };
  assert.notEqual(buildQuoteKey(base), buildQuoteKey({ ...base, cartTotalCents: 16000 }));
  assert.notEqual(buildQuoteKey(base), buildQuoteKey({ ...base, destinationZip: "20040002" }));
});

test("computeQuoteExpiry applies default TTL and clamps invalid TTL", () => {
  const created = new Date("2026-06-13T00:00:00.000Z");
  const def = computeQuoteExpiry(created);
  assert.equal(def.getTime() - created.getTime(), DEFAULT_QUOTE_TTL_SECONDS * 1000);

  const clamped = computeQuoteExpiry(created, -5);
  assert.equal(clamped.getTime() - created.getTime(), DEFAULT_QUOTE_TTL_SECONDS * 1000);

  const custom = computeQuoteExpiry(created, 60);
  assert.equal(custom.getTime() - created.getTime(), 60_000);
});

test("isQuoteExpired returns true at or after expiry", () => {
  const expiresAt = new Date("2026-06-13T00:30:00.000Z");
  assert.equal(isQuoteExpired(expiresAt, new Date("2026-06-13T00:29:59.999Z")), false);
  assert.equal(isQuoteExpired(expiresAt, new Date("2026-06-13T00:30:00.000Z")), true);
  assert.equal(isQuoteExpired(expiresAt, new Date("2026-06-13T00:30:00.001Z")), true);
});
