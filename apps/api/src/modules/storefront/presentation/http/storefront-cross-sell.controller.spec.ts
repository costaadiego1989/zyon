import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeCapabilityService } from "../../../../shared/auth/realtime-capability.js";
import { StorefrontCrossSellController } from "./storefront-cross-sell.controller.js";
import { StorefrontCartSnapshotConflictError } from "../../domain/errors/storefront-cart-snapshot-conflict.error.js";

const origin = "https://store.fixture.invalid";
function fixture() {
  const capabilities = new RealtimeCapabilityService("synthetic-cross-sell-secret-at-least-32-characters");
  const calls: unknown[] = [];
  const controller = new StorefrontCrossSellController(capabilities, {
    async quote(scope: { merchantId: string; cartId: string }, selection: unknown) { calls.push(["quote", scope, selection]); throw new Error("synthetic_authority_reached"); },
    async accept(scope: { merchantId: string; cartId: string }, input: unknown) { calls.push(["accept", scope, input]); return { version: 1, status: "accepted", ...scope }; },
  } as never);
  const issued = capabilities.issue({ purpose: "storefront-conversation", merchantId: "store", resourceId: "cart", origin });
  const request = { headers: { authorization: `Bearer ${issued.token}`, origin } };
  return { controller, capabilities, calls, request };
}
const selection = { variantId: "variant", promotionId: "promotion", quantity: 1 };
function quote() {
  return { version: 1 as const, merchantId: "store", cartId: "cart", ...selection, productId: "product", sku: "sku",
    promotionUpdatedAt: "2026-10-19T00:00:00.000Z", originalUnitPriceCents: 10000, maximumUnitPriceCents: 9000,
    cartBasis: { items: [], total: 0, discount: 0, couponCode: null, freeShipping: false },
    quote: { currency: "BRL", originalSubtotalCents: 10000, promotionDiscountCents: 1000, subtotalCents: 9000, merchandiseTotalCents: 9000,
      items: [{ variantId: "variant", productId: "product", quantity: 1, baseUnitPriceCents: 10000, unitPriceCents: 9000 }] } };
}

test("cross-sell quote reaches only the authenticated merchant/cart authority with strict selection", async () => {
  const f = fixture();
  await assert.rejects(f.controller.quote("store", "cart", selection, f.request), /synthetic_authority_reached/);
  assert.deepEqual(f.calls, [["quote", { merchantId: "store", cartId: "cart" }, selection]]);
});
test("cross-sell controller never substitutes another option selection returned by a financial port", async () => {
  const f = fixture();
  const controller = new StorefrontCrossSellController(f.capabilities, { async quote() { return quote(); } } as never);
  await assert.rejects(controller.quote("store", "cart", { ...selection, selectedOptionItemIds: ["size"] }, f.request));
});
for (const [label, mutate] of [
  ["unsigned", (r: any) => delete r.headers.authorization],
  ["wrong origin", (r: any) => r.headers.origin = "https://foreign.fixture.invalid"],
  ["forged proxy origin", (r: any) => { r.headers.origin = "https://foreign.fixture.invalid"; r.headers["x-trusted-storefront-origin"] = origin; }],
] as const) test(`cross-sell rejects ${label} before authority`, async () => {
  const f = fixture(); mutate(f.request);
  await assert.rejects(f.controller.quote("store", "cart", selection, f.request));
  await assert.rejects(f.controller.accept("store", "cart", {}, f.request));
  assert.equal(f.calls.length, 0);
});
test("cross-sell route cannot remap a signed cart to another cart or tenant", async () => {
  const f = fixture();
  for (const [merchantId, cartId] of [["other", "cart"], ["store", "other"]]) {
    await assert.rejects(f.controller.quote(merchantId, cartId, selection, f.request));
    await assert.rejects(f.controller.accept(merchantId, cartId, {}, f.request));
  }
  assert.equal(f.calls.length, 0);
});
test("cross-sell invalid or extra fields never reach the financial port", async () => {
  const f = fixture();
  for (const body of [{ ...selection, quantity: 0 }, { ...selection, quantity: 100 }, { ...selection, price: 1 },
    { ...selection, merchantId: "other" }, null]) {
    await assert.rejects(f.controller.quote("store", "cart", body, f.request));
  }
  await assert.rejects(f.controller.accept("store", "cart", { expectedQuote: selection }, f.request));
  assert.equal(f.calls.length, 0);
});
test("cross-sell non-conversation capabilities cannot authorize cart grants", async () => {
  const f = fixture();
  const issued = f.capabilities.issue({ purpose: "support-ticket", merchantId: "store", resourceId: "cart", origin });
  f.request.headers.authorization = `Bearer ${issued.token}`;
  await assert.rejects(f.controller.quote("store", "cart", selection, f.request));
  assert.equal(f.calls.length, 0);
});

test("cross-sell valid displayed quote reaches one accept and returns only the scoped commit acknowledgement", async () => {
  const f = fixture(), expectedQuote = quote();
  assert.deepEqual(await f.controller.accept("store", "cart", { expectedQuote }, f.request),
    { version: 1, status: "accepted", merchantId: "store", cartId: "cart" });
  assert.deepEqual(f.calls, [["accept", { merchantId: "store", cartId: "cart" }, { expectedQuote }]]);
});

test("cross-sell cannot accept a valid quote belonging to a different capability scope", async () => {
  const f = fixture();
  await assert.rejects(f.controller.accept("store", "cart", { expectedQuote: { ...quote(), merchantId: "foreign" } }, f.request));
  await assert.rejects(f.controller.accept("store", "cart", { expectedQuote: { ...quote(), cartId: "foreign" } }, f.request));
  assert.equal(f.calls.length, 0);
});

test("cross-sell stale basis returns a fixed conflict while unknown commit errors keep their identity", async () => {
  const f = fixture(), unknown = new Error("synthetic_commit_outcome_unknown");
  const port = { async accept() { throw new StorefrontCartSnapshotConflictError(); } };
  const controller = new StorefrontCrossSellController(f.capabilities, port as never);
  await assert.rejects(controller.accept("store", "cart", { expectedQuote: quote() }, f.request),
    (error: any) => error.getStatus() === 409 && error.getResponse().code === "storefront_cart_snapshot_conflict");
  port.accept = async () => { throw unknown; };
  await assert.rejects(controller.accept("store", "cart", { expectedQuote: quote() }, f.request), error => error === unknown);
});

test("cross-sell authenticated proxy origin works but an expired capability cannot reach the port", async () => {
  const f = fixture(), previous = process.env.INTERNAL_SERVICE_TOKEN;
  process.env.INTERNAL_SERVICE_TOKEN = "synthetic-cross-sell-internal";
  try {
    const request = { headers: { ...f.request.headers, origin: "https://api.fixture.invalid", "x-trusted-storefront-origin": origin,
      "x-internal-service-token": "synthetic-cross-sell-internal" } };
    await assert.rejects(f.controller.quote("store", "cart", selection, request), /synthetic_authority_reached/);
    const expired = f.capabilities.issue({ purpose: "storefront-conversation", merchantId: "store", resourceId: "cart", origin }, Math.floor(Date.now() / 1000) - 4000);
    request.headers.authorization = `Bearer ${expired.token}`;
    await assert.rejects(f.controller.quote("store", "cart", selection, request));
    assert.equal(f.calls.length, 1);
  } finally { if (previous === undefined) delete process.env.INTERNAL_SERVICE_TOKEN; else process.env.INTERNAL_SERVICE_TOKEN = previous; }
});
