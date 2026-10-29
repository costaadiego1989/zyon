import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import type { Cart } from "@zyon/shared-types";
import { checkoutSession, merchantRules } from "../../../modules/checkout/__tests__/checkout-test-fixtures.js";
import { paymentCartFingerprint } from "../../../modules/checkout/domain/services/payment-cart-fingerprint.js";
import { readStorefrontCouponForCheckout, captureStorefrontCouponForPayment } from "./admission.js";
import { releaseBoundCheckoutCouponForEdit } from "./generation-release.js";
import type { PaymentIntentSnapshot } from "../../../modules/payment/domain/payment-intent.entity.js";

// Explicit delegate doubles. No SQL isolation/provider/public auth proof.
function fixture({ paidOptions = false, mixed = false } = {}) {
  const scope = { merchantId: "mrc_1", checkoutSessionId: "chk_1", cartId: "cart_1", buyerId: "usr_1" };
  const option = { groupId: "size", groupName: "Tamanho", itemId: "large", itemName: "Grande", priceModifierInCents: 1000 };
  const ids = paidOptions ? ["large"] : [];
  const quantity = mixed ? 1 : 2;
  const source = { id: "source-row", merchantId: scope.merchantId, sessionId: scope.cartId, couponCode: "SAVE10", discount: 1000,
    freeShipping: false, total: mixed ? 14000 : 18000, updatedAt: new Date(0), expiresAt: new Date("2050-01-01"),
    items: [{ variantId: "v_1", productId: "p_1", sku: "SKU", name: "Saved", unitPriceCents: 9000, quantity,
      ...(paidOptions ? { selectedOptions: [option] } : {}) },
    ...(mixed ? [{ variantId: "v_2", productId: "p_2", sku: "OTHER", name: "Other", unitPriceCents: 5000, quantity: 1 }] : [])] };
  const cart: Cart = { currency: "BRL", source: "storefront", cart_ref: scope.cartId, total: mixed ? 135 : 180, currentDiscount: 10,
    commercialNudge: { kind: "coupon", title: "Cupom aplicado", message: "Synthetic source", couponCode: "SAVE10" },
    discountBudget: { version: 1, originalSubtotalCents: mixed ? 15000 : 20000, promotionDiscountCents: mixed ? 1500 : 2000 },
    items: [{ variantId: "v_1", product_id: "p_1", sku: "SKU", name: "Saved", quantity, price: 90, originalPrice: 100,
      variant: JSON.stringify(["v_1", ids]), ...(paidOptions ? { selected_options: [{ group_name: option.groupName, item_name: option.itemName, price_modifier: 10 }] } : {}) },
    ...(mixed ? [{ variantId: "v_2", product_id: "p_2", sku: "OTHER", name: "Other", quantity: 1, price: 45, originalPrice: 50,
      variant: JSON.stringify(["v_2", []]) }] : [])] };
  const session = checkoutSession({ cart, persistenceVersion: 3, customer: { email: "test@example.invalid", email_verified: true },
    shipping: { customerPrice: 5, realCost: 5, region: "SP" } });
  const row = { ...session, id: "checkout-row", version: 3, cart: session.cart as unknown as Record<string, unknown>,
    createdAt: new Date(0), updatedAt: new Date(0), customer: session.customer ?? null, shipping: session.shipping ?? null };
  const coupon = { id: "coupon_1", merchantId: scope.merchantId, code: "SAVE10", discountType: "fixed", discountValue: new Prisma.Decimal(10),
    minCartTotal: null, maxUsages: 100, maxPerBuyer: null, usagesCount: 0, status: "active", startsAt: new Date(0), endsAt: null,
    allowedSkus: [], blockedSkus: [], allowedRegions: [], blockedRegions: [], createdAt: new Date(0), updatedAt: new Date(0), strategyIncentiveExecutionId: null };
  const reservation = { id: "redemption", merchantId: scope.merchantId, sessionId: scope.cartId, couponId: coupon.id,
    buyerGlobalUserId: null, status: "applied", orderId: null, discountApplied: new Prisma.Decimal(10) };
  const rules = { merchantId: scope.merchantId, ...merchantRules({ maxDiscountPercent: 20 }) };
  const catalog = [{ id: "v_1", productId: "p_1", sku: "SKU", isActive: true,
    product: { id: "p_1", merchantId: scope.merchantId, isActive: true, deletedAt: null, metadata: paidOptions
      ? { optionGroups: [{ id: "size", name: "Tamanho", required: false, selectionType: "single", items: [{ id: "large", name: "Grande", priceModifierInCents: 1000 }] }] } : {} },
    price: { variantId: "v_1", basePriceInCents: paidOptions ? 9000 : 10000, currency: "BRL" } },
  ...(mixed ? [{ id: "v_2", productId: "p_2", sku: "OTHER", isActive: true,
    product: { id: "p_2", merchantId: scope.merchantId, isActive: true, deletedAt: null, metadata: {} },
    price: { variantId: "v_2", basePriceInCents: 5000, currency: "BRL" } }] : [])];
  const amountCents = Math.round(cart.total * 100) - 1000 + 500 + 99;
  const snapshot: PaymentIntentSnapshot = { id: "payment", merchantId: scope.merchantId, sessionId: scope.checkoutSessionId,
    idempotencyKey: "key", version: 0, method: "pix", status: "pending", currency: "BRL", amountCents, statusHistory: [],
    amountBreakdown: { version: 1, currency: "BRL", itemsSubtotalCents: Math.round(cart.total * 100), discountCents: 1000, shippingCents: 500,
      platformFeeCents: 99, totalCents: amountCents, cartFingerprint: paymentCartFingerprint(session) },
    creation: { state: "ready", input: { intentId: "payment", merchantId: scope.merchantId, sessionId: scope.checkoutSessionId, method: "pix", currency: "BRL", amountCents } } };
  const binding = { version: 1, bindingId: "11111111-1111-4111-8111-111111111111", ...scope, reservationBuyerId: null,
    couponId: coupon.id, redemptionId: reservation.id, discountCents: 1000, basisHash: paymentCartFingerprint(session), state: "active" };
  const { state: _state, ...identity } = binding;
  const payments: Record<string, unknown>[] = [{ id: "payment", merchantId: scope.merchantId, sessionId: scope.checkoutSessionId,
    currency: "BRL", method: "pix", amountCents, status: "failed", providerPaymentId: null, approvedAmountCents: null,
    creation: { state: "complete", couponAuthority: identity, input: snapshot.creation!.input, reason: "mercadopago_pix_key_required" } }];
  const writes: string[] = [], receipts: Record<string, unknown>[] = [], catalogCalls: unknown[] = [];
  const databaseError = new Error("synthetic_catalog_failure");
  let failCatalog = false, paid = false;
  const tx = {
    async $executeRaw() { return 1; },
    async $queryRaw(parts: TemplateStringsArray) { return parts.join("?").includes("current_setting") ? [{ isolation: "read committed", candidates: [] }] : [{ id: coupon.id }]; },
    checkoutSession: { async findUnique() { return row; }, async updateMany(args: { data: { cart: Record<string, unknown> } }) {
      writes.push("binding"); row.cart = args.data.cart; return { count: 1 }; } },
    storefrontCart: { async findUnique() { return source; }, async updateMany(args: { data: Record<string, unknown> }) {
      writes.push("source"); Object.assign(source, args.data); return { count: 1 }; } },
    productVariant: { async findMany(args: unknown) { catalogCalls.push(args); if (failCatalog) throw databaseError; return catalog; } },
    merchantRule: { async findUnique() { return rules; } }, coupon: { async findFirst() { return coupon; } },
    couponRedemption: { async findMany() { return [reservation]; }, async findFirst() { return reservation; }, async count() { return 1; },
      async updateMany(args: { data: Record<string, unknown> }) { writes.push("reservation"); Object.assign(reservation, args.data); return { count: 1 }; } },
    completedOrder: { async findFirst() { return paid ? { id: "order" } : null; } },
    paymentIntent: { async findFirst() { return null; }, async findMany() { return payments; } }, checkoutChatRequest: { async findFirst() { return null; } },
    outboxMessage: { async findFirst() { return receipts[0] ?? null; }, async upsert(args: { create: Record<string, unknown> }) { writes.push("receipt"); receipts.push(args.create); return args.create; } },
  };
  return { scope, source, cart: session.cart, session, row, coupon, reservation, rules, catalog, snapshot, binding, payments, writes, catalogCalls,
    tx: tx as unknown as Prisma.TransactionClient, failCatalog: () => { failCatalog = true; }, databaseError, paid: () => { paid = true; } };
}
const conflict = (error: unknown) => error instanceof Error && error.message === "checkout_coupon_binding_conflict";
for (const entry of ["read", "capture"] as const) {
  const run = (f: ReturnType<typeof fixture>) => entry === "read" ? readStorefrontCouponForCheckout(f.tx, f.session)
    : captureStorefrontCouponForPayment(f.tx, f.snapshot, f.scope);
  for (const shape of [{}, { paidOptions: true }, { mixed: true }, { paidOptions: true, mixed: true }]) {
    test(`${entry} matches B/S/T historical source ${JSON.stringify(shape)} without double promotion`, async () => {
      const f = fixture(shape), before = structuredClone(f.source), result = await run(f);
      assert.equal(result?.discountCents, 1000); assert.equal(result?.cartId, "cart_1"); assert.equal(result?.checkoutSessionId, "chk_1");
      assert.deepEqual(f.source, before); assert.ok(f.catalogCalls.length > 0);
      assert.ok(f.catalogCalls.every(args => !JSON.stringify(args).includes("costInCents") && !JSON.stringify(args).includes("minimumMarginPercent")));
      assert.equal(f.writes.filter(value => value === "binding").length, entry === "capture" ? 1 : 0);
    });
  }
  for (const changed of ["original", "coherent inflated hints", "budget", "missing budget", "quantity", "options", "p2", "subtotal", "foreign catalog", "catalog price", "catalog currency", "missing catalog"] as const) {
    test(`${entry} rejects historical ${changed} before any binding/source write`, async () => {
      const f = fixture();
      if (changed === "original") f.cart.items[0]!.originalPrice = 110;
      if (changed === "coherent inflated hints") { f.cart.items[0]!.originalPrice = 110; f.cart.discountBudget!.originalSubtotalCents = 22000;
        f.cart.discountBudget!.promotionDiscountCents = 4000; }
      if (changed === "budget") f.cart.discountBudget!.promotionDiscountCents++;
      if (changed === "missing budget") delete f.cart.discountBudget;
      if (changed === "quantity") f.cart.items[0]!.quantity++;
      if (changed === "options") f.cart.items[0]!.variant = JSON.stringify(["v_1", ["foreign"]]);
      if (changed === "p2") { f.cart.items[0]!.price = 89; f.cart.total = 178; f.cart.discountBudget!.promotionDiscountCents = 2200; }
      if (changed === "subtotal") f.source.total--;
      if (changed === "foreign catalog") f.catalog[0]!.product.merchantId = "foreign";
      if (changed === "catalog price") f.catalog[0]!.price.basePriceInCents++;
      if (changed === "catalog currency") f.catalog[0]!.price.currency = "USD";
      if (changed === "missing catalog") f.catalog.splice(0);
      await assert.rejects(run(f), conflict); assert.deepEqual(f.writes, []);
    });
  }
  test(`${entry} propagates actual catalog failure without nominal fallback`, async () => {
    const f = fixture(); f.failCatalog(); await assert.rejects(run(f), error => error === f.databaseError); assert.deepEqual(f.writes, []);
  });
  test(`${entry} rejects a forged paid-option modifier despite matching ids and coherent total hints`, async () => {
    const f = fixture({ paidOptions: true });
    f.source.items[0]!.selectedOptions![0]!.priceModifierInCents = 1999;
    await assert.rejects(run(f), conflict); assert.deepEqual(f.writes, []);
  });
  test(`${entry} does not read analytic cost getters as price authority`, async () => {
    const f = fixture(); Object.defineProperty(f.catalog[0]!.price, "costInCents", { enumerable: true,
      get: () => assert.fail("analytic_cost_getter_must_not_run") });
    assert.equal((await run(f))?.discountCents, 1000);
  });
}
test("historical source above company cap remains a typed review with exact reservation preserved", async () => {
  const f = fixture(), before = structuredClone(f.source); f.rules.maxDiscountPercent = 5;
  await assert.rejects(readStorefrontCouponForCheckout(f.tx, f.session), error => error instanceof Error
    && error.name === "StorefrontCouponEligibilityReviewRequired");
  assert.deepEqual(f.source, before); assert.equal(f.reservation.status, "applied"); assert.deepEqual(f.writes, []);
});
for (const shape of [{}, { paidOptions: true }, { mixed: true }]) test(`bound release uses captured B/S/T after catalog drift ${JSON.stringify(shape)}`, async () => {
  const f = fixture(shape); f.row.cart = { ...f.cart, _storefrontCouponBinding: f.binding }; f.failCatalog();
  const before = structuredClone(f.source.items);
  await releaseBoundCheckoutCouponForEdit(f.tx, f.row, "address");
  assert.equal(f.reservation.status, "cancelled"); assert.equal(f.source.couponCode, null); assert.equal(f.source.discount, 0);
  assert.deepEqual(f.source.items, before); assert.equal(f.catalogCalls.length, 0); assert.deepEqual(f.writes, ["reservation", "source", "receipt"]);
});
for (const changed of ["unknown payment", "paid order", "source price", "D", "quantity"] as const) test(`bound historical release refuses ${changed}`, async () => {
  const f = fixture(); f.row.cart = { ...f.cart, _storefrontCouponBinding: f.binding };
  if (changed === "unknown payment") f.payments[0]!.status = "pending";
  if (changed === "paid order") f.paid();
  if (changed === "source price") f.source.items[0]!.unitPriceCents++;
  if (changed === "D") f.source.discount--;
  if (changed === "quantity") f.source.items[0]!.quantity++;
  await assert.rejects(releaseBoundCheckoutCouponForEdit(f.tx, f.row, "address")); assert.deepEqual(f.writes, []);
});
