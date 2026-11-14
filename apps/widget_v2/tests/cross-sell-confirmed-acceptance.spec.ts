import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const quote = () => normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion", sessionVersion: 2,
  contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "merchant",
    targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 2,
      originalUnitPriceCents: 2500, maximumUnitPriceCents: 2250, selectedOptionItemIds: ["large"], variantId: "variant", productId: "product", sku: "sku", source: "cross_sell" }],
    items: [{ variantId: "variant", productId: "product", sku: "sku", quantity: 2, baseUnitPriceCents: 2500, unitPriceCents: 2250,
      selectedOptions: [{ groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 500 }] }],
    originalSubtotalCents: 5000, preservedSavingsCents: 0, allocatedSavingsCents: 500, promotionDiscountCents: 500,
    cartDiscountCents: 0, merchandiseSubtotalCents: 4500, payableMerchandiseCents: 4500, remainingDiscountCents: 500 } });
const variant = JSON.stringify(["variant", ["large"]]);
const experience = { items: [{ sku: "sku", name: "Synthetic", quantity: 2, unit_price: 22.5, variant }],
  totals: { subtotal: 45, discount: 0, shipping: 0, total: 45, service_fee: 0, total_to_pay: 45 } };
function response() { return { acknowledgement: { version: 1, status: "accepted", merchantId: "merchant", sessionId: "session", suggestionId: "suggestion",
  persistenceVersion: 3, quoteHash: createHash("sha256").update(JSON.stringify(quote())).digest("hex") }, projection_status: "available",
  experience, cart: { currency: "BRL", total: 45, currentDiscount: 0, items: [{ sku: "sku", name: "Synthetic", variantId: "variant", product_id: "product",
    quantity: 2, price: 22.5, originalPrice: 25, variant }] } }; }
async function fixture(body: unknown) {
  const calls: unknown[] = [];
  globalThis.fetch = async (_input, init) => { const value = JSON.parse(String(init?.body)); calls.push(value);
    return Response.json(calls.length === 1 ? { session_id: "session", experience: { items: [], totals: { subtotal: 0, discount: 0, total: 0 } } } : body); };
  const api = new CheckoutSession({ merchantId: "merchant", embedToken: "signed", apiBaseUrl: "https://fixture.invalid" });
  await api.start(); return { api, calls, before: await api.fetchCart() };
}
test("accept sends the exact displayed quote once and validates matching financial ACK before caching", async () => {
  const f = await fixture(response()), expected = quote();
  const result = await f.api.acceptCrossSell("suggestion", "sku", expected);
  assert.equal(result.projection_status, "available"); assert.deepEqual(f.calls[1], { session_id: "session", suggestion_id: "suggestion", accepted_skus: ["sku"], expected_quote: expected });
  assert.equal((await f.api.fetchCart()).total, 45); assert.equal(f.calls.length, 2);
});

for(const [productType,fulfillmentStrategy]of [["physical","carrier"],["food","local_delivery"],["digital","digital"],["service","service"]]as const)
  test(`confirmed ${productType} canonical cart metadata reaches the SDK cache even when legacy experience omits it`,async()=>{
    const body=structuredClone(response());Object.assign(body.cart.items[0]!,{productType,fulfillmentStrategy});
    const f=await fixture(body);await f.api.acceptCrossSell("suggestion","sku",quote());
    const line=(await f.api.fetchCart()).items[0]!;
    assert.equal(line.productType,productType);assert.equal(line.fulfillmentStrategy,fulfillmentStrategy);
    assert.equal(f.calls.length,2);
  });

for(const invalid of ["incoherent","scheduled","experience_conflict"]as const)
  test(`invalid ${invalid} canonical fulfillment cannot enter the accepted SDK cache`,async()=>{
    const body=structuredClone(response());Object.assign(body.cart.items[0]!,{productType:"digital",fulfillmentStrategy:"digital"});
    if(invalid==="incoherent")Object.assign(body.cart.items[0]!,{productType:"physical"});
    if(invalid==="scheduled")Object.assign(body.cart.items[0]!,{productType:"service",fulfillmentStrategy:"scheduled_service"});
    if(invalid==="experience_conflict")Object.assign(body.experience.items[0]!,{productType:"physical",fulfillmentStrategy:"carrier"});
    const f=await fixture(body);await assert.rejects(f.api.acceptCrossSell("suggestion","sku",quote()));
    assert.deepEqual(await f.api.fetchCart(),f.before);assert.equal(f.calls.length,2);
  });
test("missing displayed quote refuses before dispatch rather than silently obtaining a new price", async () => {
  const f = await fixture(response()); await assert.rejects(f.api.acceptCrossSell("suggestion", "sku")); assert.equal(f.calls.length, 1);
});
for (const changed of ["merchantId", "sessionId", "suggestionId", "quoteHash", "persistenceVersion"] as const)
  test(`ACK ${changed} mismatch does not mutate the cached cart or claim acceptance`, async () => {
    const body = response(); Object.assign(body.acknowledgement, { [changed]: changed === "persistenceVersion" ? 4 : "wrong" });
    const f = await fixture(body); await assert.rejects(f.api.acceptCrossSell("suggestion", "sku", quote()));
    assert.deepEqual(await f.api.fetchCart(), f.before); assert.equal(f.calls.length, 2);
  });
test("postcommit projection review is explicit and retains cached cart rather than inventing success money", async () => {
  const body = response(), f = await fixture({ acknowledgement: body.acknowledgement, projection_status: "requires_review" });
  const result = await f.api.acceptCrossSell("suggestion", "sku", quote());
  assert.equal(result.projection_status, "requires_review"); assert.deepEqual(await f.api.fetchCart(), f.before); assert.equal(f.calls.length, 2);
  await assert.rejects(f.api.acceptCrossSell("suggestion", "sku", quote()), /cross_sell_reconciliation_required/);
  await assert.rejects(f.api.createPaymentIntent("pix"), /cross_sell_reconciliation_required/); assert.equal(f.calls.length, 2);
});
test("navigation/reset guard is checked again after asynchronous hashing, before dispatching acceptance", async () => {
  const f = await fixture(response());
  await assert.rejects(f.api.acceptCrossSell("suggestion", "sku", quote(), () => false), /cross_sell_quote_invalid/);
  assert.equal(f.calls.length, 1); assert.deepEqual(await f.api.fetchCart(), f.before);
});
for (const command of ["quantity", "remove", "coupon", "shipping", "shipping quote", "offer", "customer", "chat"] as const)
  test(`committed review blocks stale ${command} mutation before any dispatch/cache replacement`, async () => {
    const body = response(), f = await fixture({ acknowledgement: body.acknowledgement, projection_status: "requires_review" });
    await f.api.acceptCrossSell("suggestion", "sku", quote()); const before = await f.api.fetchCart();
    const run = () => command === "quantity" ? f.api.updateCartItemQty("old", 1)
      : command === "remove" ? f.api.updateCart([]) : command === "coupon" ? f.api.applyCoupon("SAVE", { items: [], total: 0 })
        : command === "shipping" ? f.api.selectShipping("old") : command === "shipping quote" ? f.api.fetchShippingQuote("01310100")
          : command === "offer" ? f.api.applyOffer("old") : command === "customer" ? f.api.updateCustomer({ name: "Synthetic" }) : f.api.chat("Adicionar produto");
    await assert.rejects(run(), /cross_sell_reconciliation_required/); assert.equal(f.calls.length, 2); assert.deepEqual(await f.api.fetchCart(), before);
  });
for (const corrupt of ["missing ACK", "cart money", "experience money", "quantity", "foreign product", "foreign request"] as const)
  test(`malformed or divergent ${corrupt} fails closed without alternate operations`, async () => {
    const body = response(); if (corrupt === "missing ACK") delete (body as { acknowledgement?: unknown }).acknowledgement;
    if (corrupt === "cart money") body.cart.total++;
    if (corrupt === "experience money") body.experience.totals.subtotal++;
    if (corrupt === "quantity") body.cart.items[0]!.quantity++;
    if (corrupt === "foreign product") body.cart.items[0]!.product_id = "foreign";
    const f = await fixture(body), expected = quote(); if (corrupt === "foreign request") expected.merchantId = "foreign";
    await assert.rejects(f.api.acceptCrossSell("suggestion", "sku", expected)); assert.deepEqual(await f.api.fetchCart(), f.before);
    assert.equal(f.calls.length, corrupt === "foreign request" ? 1 : 2);
  });
