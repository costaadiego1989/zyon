import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { normalCheckoutCrossSellQuoteSchema } from "@zyon/contracts";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { useCheckoutStore, CROSS_SELL_COMMITTED_REVIEW_MESSAGE } from "../src/store/checkout-store.js";
const initial = useCheckoutStore.getInitialState();
afterEach(() => { useCheckoutStore.getState().stopPolling(); useCheckoutStore.setState(initial, true); });
function fixture() {
  const quote = normalCheckoutCrossSellQuoteSchema.parse({ version: 1, merchantId: "merchant", sessionId: "session", suggestionId: "suggestion", sessionVersion: 2,
    contextHash: "a".repeat(64), basisHash: "b".repeat(64), pricing: { kind: "quote_candidate", version: 1, merchantId: "merchant",
      targets: [{ version: 1, promotionId: "promo", promotionUpdatedAt: "2026-10-20T12:00:00Z", acceptedQuantity: 1,
        originalUnitPriceCents: 1000, maximumUnitPriceCents: 900, variantId: "variant", productId: "product", sku: "sku", source: "cross_sell" }],
      items: [{ variantId: "variant", productId: "product", sku: "sku", quantity: 1, baseUnitPriceCents: 1000, unitPriceCents: 900 }],
      originalSubtotalCents: 1000, preservedSavingsCents: 0, allocatedSavingsCents: 100, promotionDiscountCents: 100,
      cartDiscountCents: 0, merchandiseSubtotalCents: 900, payableMerchandiseCents: 900, remainingDiscountCents: 100 } });
  const api = new CheckoutSession({ merchantId: "merchant", embedToken: "signed", apiBaseUrl: "https://fixture.invalid" });
  // Deliberate transport doubles, not authenticated HTTP/server authority.
  Object.defineProperty(api, "currentSessionId", { get: () => "session" });
  const calls: unknown[][] = [];
  api.quoteCrossSell = async (...args) => { calls.push(["quote", ...args]); return quote; };
  api.acceptCrossSell = async (...args) => { calls.push(["accept", ...args]); return { acknowledgement: { version: 1, status: "accepted", merchantId: "merchant",
    sessionId: "session", suggestionId: "suggestion", persistenceVersion: 3, quoteHash: "a".repeat(64) }, projection_status: "requires_review" }; };
  api.createPaymentIntent = async () => { calls.push(["payment"]); throw Error("unexpected_payment"); };
  useCheckoutStore.setState({ api, sessionId: "session", status: "active", cart: { items: [{ sku: "old", name: "Existing", quantity: 1, price: 12 }],
    total: 12, discount: 0, serviceFee: 0, status: "ready_to_pay" }, paymentIntent: { intent_id: "existing", method: "pix", status: "pending" },
    messages: [{ id: "before", role: "agent", text: "Existing", timestamp: 1 }] });
  const prepare = () => useCheckoutStore.getState().prepareCrossSell("suggestion", [{ sku: "sku", variant_id: "variant", quantity: 1 }]);
  return { api, calls, quote, prepare };
}
const financial = () => { const s = useCheckoutStore.getState(); return structuredClone({ cart: s.cart, payment: s.paymentIntent, messages: s.messages }); };

for(const kind of ["digital","service","mixed","physical","legacy"]as const)
  test(`confirmed ${kind} acceptance preserves canonical fields and follows only the signed server stage`,async()=>{
    const f=fixture(),virtual=kind==="digital"||kind==="service",productType=virtual?kind:"physical",fulfillmentStrategy=virtual?kind:"carrier";
    const items=[{sku:"sku",name:"Synthetic",variantId:"variant",product_id:"product",quantity:1,price:9,
      ...(kind==="legacy"?{}:{productType,fulfillmentStrategy})}];
    if(kind==="mixed"){
      items.push({sku:"virtual",name:"Virtual",variantId:"virtual",product_id:"virtual-product",quantity:1,price:3,productType:"digital",fulfillmentStrategy:"digital"});
      f.quote.pricing.items.push({sku:"virtual",variantId:"virtual",productId:"virtual-product",quantity:1,baseUnitPriceCents:300,unitPriceCents:300});
      f.quote.pricing.originalSubtotalCents+=300;f.quote.pricing.merchandiseSubtotalCents+=300;f.quote.pricing.payableMerchandiseCents+=300;
    }
    const total=kind==="mixed"?12:9,stage=virtual?"payment":"shipping";
    f.api.acceptCrossSell=async()=>({acknowledgement:{version:1,status:"accepted",merchantId:"merchant",sessionId:"session",suggestionId:"suggestion",persistenceVersion:3,quoteHash:"a".repeat(64)},
      projection_status:"available",cart:{currency:"BRL",total,currentDiscount:0,items},experience:{stage,
        items:items.map(({price,...line})=>({...line,unit_price:price})),totals:{subtotal:total,discount:0,shipping:0,total}}});
    const quote=await f.prepare();assert.equal((await useCheckoutStore.getState().acceptCrossSell("suggestion","sku",quote!)).ok,true);
    const state=useCheckoutStore.getState();assert.equal(state.cart.status,virtual?"ready_to_pay":"awaiting");
    assert.equal(state.checkoutStage,stage);assert.equal(state.cart.shipping,undefined);
    if(kind==="legacy")assert.equal("productType"in state.cart.items[0]!,false);
    else{assert.equal(state.cart.items[0]!.productType,productType);assert.equal(state.cart.items[0]!.fulfillmentStrategy,fulfillmentStrategy);}
    if(kind==="mixed")assert.equal(state.cart.items[1]!.productType,"digital");
  });
test("no presented quote means no accept and no automatic quote or fallback", async () => {
  const f = fixture(), before = financial(); assert.equal((await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku")).ok, false);
  assert.deepEqual(f.calls, []); assert.deepEqual(financial(), before);
});
test("read-only preparation preserves cart/payment; acceptance must use the exact prepared snapshot", async () => {
  const f = fixture(), before = financial(), quote = await f.prepare(); assert.deepEqual(financial(), before);
  assert.equal((await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", structuredClone(quote!))).ok, false);
  assert.equal(f.calls.length, 1); await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!);
  assert.equal(f.calls.length, 2); assert.equal(f.calls[1]![3], quote);
});
test("committed review gives explicit notice and blocks replay/payment while preserving visible historical money", async () => {
  const f = fixture(), before = financial(), quote = await f.prepare();
  assert.deepEqual(await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!),
    { ok: false, error: CROSS_SELL_COMMITTED_REVIEW_MESSAGE, committedRequiresReview: true });
  assert.equal(useCheckoutStore.getState().cartError, CROSS_SELL_COMMITTED_REVIEW_MESSAGE); assert.deepEqual(financial(), before);
  await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!); await useCheckoutStore.getState().pay("pix");
  assert.equal(await f.prepare(), null); assert.equal(f.calls.length, 2);
});
test("unknown acceptance is not replayed by another click or payment creation", async () => {
  const f = fixture(), quote = await f.prepare(), before = financial();
  f.api.acceptCrossSell = async () => { f.calls.push(["accept"]); throw TypeError("synthetic_unknown"); };
  assert.equal((await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!)).ok, false);
  await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!); await useCheckoutStore.getState().pay("pix");
  assert.deepEqual(financial(), before); assert.equal(f.calls.length, 2);
});
test("late quote after reset cannot populate the next session or dispatch an accept", async () => {
  const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  f.api.quoteCrossSell = async () => { await gate; return f.quote; };
  const prepared = f.prepare(); useCheckoutStore.getState().resetSession(); release();
  assert.equal(await prepared, null); assert.deepEqual(useCheckoutStore.getState().preparedCrossSellQuotes, {}); assert.deepEqual(f.calls, []);
});

test("out-of-order preparation cannot replace the newer displayed selection", async () => {
  const f = fixture(); let first!: (value: typeof f.quote) => void;
  let calls = 0; f.api.quoteCrossSell = async () => ++calls === 1 ? new Promise(resolve => { first = resolve; }) : structuredClone(f.quote);
  const older = f.prepare(), newer = await f.prepare(); first(f.quote);
  assert.equal(await older, null);
  assert.equal(Object.values(useCheckoutStore.getState().preparedCrossSellQuotes)[0], newer);
});
test("separate cards under one suggestion retain independently displayed quotes", async () => {
  const f = fixture(), other = structuredClone(f.quote);
  Object.assign(other.pricing.targets[0]!, { sku: "other-sku", variantId: "other-variant", productId: "other-product" });
  Object.assign(other.pricing.items[0]!, { sku: "other-sku", variantId: "other-variant", productId: "other-product" });
  f.api.quoteCrossSell = async (_suggestion, targets) => { f.calls.push(["quote"]); return targets[0]!.sku === "sku" ? f.quote : other; };
  const first = await f.prepare();
  const second = await useCheckoutStore.getState().prepareCrossSell("suggestion", [{ sku: "other-sku", variant_id: "other-variant", quantity: 1 }]);
  assert.equal(Object.keys(useCheckoutStore.getState().preparedCrossSellQuotes).length, 2);
  assert.equal(first, f.quote); assert.equal(second, other);
  await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", first!);
  assert.equal(f.calls.filter(call => call[0] === "accept").length, 1);
});
test("out-of-order different cards do not cancel each other's read-only preparation", async () => {
  const f = fixture(), other = structuredClone(f.quote); let first!: () => void;
  Object.assign(other.pricing.targets[0]!, { sku: "other-sku", variantId: "other-variant", productId: "other-product" });
  Object.assign(other.pricing.items[0]!, { sku: "other-sku", variantId: "other-variant", productId: "other-product" });
  const gate = new Promise<void>(resolve => { first = resolve; });
  f.api.quoteCrossSell = async (_suggestion, targets) => { if (targets[0]!.sku === "sku") { await gate; return f.quote; } return other; };
  const pending = f.prepare();
  assert.equal(await useCheckoutStore.getState().prepareCrossSell("suggestion", [{ sku: "other-sku", variant_id: "other-variant", quantity: 1 }]), other);
  first(); assert.equal(await pending, f.quote);
  assert.equal(Object.keys(useCheckoutStore.getState().preparedCrossSellQuotes).length, 2);
});
test("a refreshed basis of the same selection invalidates the previously displayed snapshot", async () => {
  const f = fixture(), first = await f.prepare(), newer = structuredClone(f.quote);
  newer.contextHash = "c".repeat(64); newer.basisHash = "d".repeat(64); newer.sessionVersion = 3;
  f.api.quoteCrossSell = async () => newer;
  assert.equal(await f.prepare(), newer);
  assert.equal((await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", first!)).ok, false);
  assert.equal(f.calls.filter(call => call[0] === "accept").length, 0);
  assert.equal(Object.keys(useCheckoutStore.getState().preparedCrossSellQuotes).length, 1);
});
test("unreconciled store blocks quantity/removal/coupon/shipping instead of writing from its historical snapshot", async () => {
  const f = fixture(), quote = await f.prepare(); await useCheckoutStore.getState().acceptCrossSell("suggestion", "sku", quote!);
  f.api.updateCartItemQty = async () => { f.calls.push(["quantity"]); throw Error("unexpected_stale_write"); };
  f.api.selectShipping = async () => { f.calls.push(["shipping"]); throw Error("unexpected_stale_write"); };
  f.api.applyCoupon = async () => { f.calls.push(["coupon"]); throw Error("unexpected_stale_write"); };
  const before = financial(); await useCheckoutStore.getState().updateQty("old", 1); await useCheckoutStore.getState().removeCartItem("old");
  await useCheckoutStore.getState().selectShipping({ key: "old", label: "Old" }); await useCheckoutStore.getState().applyCouponCode("SAVE");
  assert.equal(f.calls.length, 2); assert.deepEqual(financial(), before);
});
