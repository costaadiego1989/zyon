import test from "node:test";
import assert from "node:assert/strict";
import type { CommerceOrderPort } from "@zyon/commerce-adapters";
import { InMemoryPendingCommerceOrderIndex } from "../infrastructure/in-memory-pending-commerce-order-index.js";
import { SyncPendingOrderUseCase } from "./sync-pending-order.use-case.js";

function sampleCart(overrides: Partial<{ commerceCartRef: string; totalCents: number }> = {}) {
  return {
    currency: "BRL",
    totalCents: overrides.totalCents ?? 9900,
    lines: [{ sku: "k1", quantity: 1, unitPriceCents: 9900, title: "Kit" }],
    commerceCartRef: overrides.commerceCartRef ?? "cref_1"
  };
}

test("first sync creates commerce order exactly once per merchant session", async () => {
  let createCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder({ merchantId }) {
      createCalls += 1;
      return { commerceOrderId: `ord_${merchantId}_${createCalls}` };
    },
    async markOrderPaid() {}
  };
  const index = new InMemoryPendingCommerceOrderIndex();
  const uc = new SyncPendingOrderUseCase(orders, index);

  const cart = sampleCart();
  const first = await uc.execute({ merchantId: " m1 ", sessionId: "s1 ", cart });
  const second = await uc.execute({ merchantId: "m1", sessionId: "s1", cart });

  assert.equal(createCalls, 1);
  assert.equal(first.commerceOrderId, second.commerceOrderId);
});

test("second sync for same session reuses id even when cart snapshot differs", async () => {
  let createCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      createCalls += 1;
      return { commerceOrderId: "ord_stable" };
    },
    async markOrderPaid() {}
  };
  const uc = new SyncPendingOrderUseCase(orders, new InMemoryPendingCommerceOrderIndex());

  const first = await uc.execute({
    merchantId: "m1",
    sessionId: "s1",
    cart: sampleCart({ totalCents: 100, commerceCartRef: "a" })
  });
  const second = await uc.execute({
    merchantId: "m1",
    sessionId: "s1",
    cart: sampleCart({ totalCents: 999_999, commerceCartRef: "b" })
  });

  assert.equal(first.commerceOrderId, second.commerceOrderId);
  assert.equal(createCalls, 1);
});

test("distinct sessions yield distinct commerce orders for same merchant", async () => {
  let createCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      createCalls += 1;
      return { commerceOrderId: `ord_${createCalls}` };
    },
    async markOrderPaid() {}
  };
  const uc = new SyncPendingOrderUseCase(orders, new InMemoryPendingCommerceOrderIndex());
  const cart = sampleCart();

  const a = await uc.execute({ merchantId: "m1", sessionId: "s1", cart });
  const b = await uc.execute({ merchantId: "m1", sessionId: "s2", cart });

  assert.notEqual(a.commerceOrderId, b.commerceOrderId);
  assert.equal(createCalls, 2);
});

test("distinct merchants never share commerce order ids for same session id string", async () => {
  let createCalls = 0;
  const orders: CommerceOrderPort = {
    async createPendingOrder() {
      createCalls += 1;
      return { commerceOrderId: `ord_${createCalls}` };
    },
    async markOrderPaid() {}
  };
  const index = new InMemoryPendingCommerceOrderIndex();
  const uc = new SyncPendingOrderUseCase(orders, index);
  const cart = sampleCart();

  const ma = await uc.execute({ merchantId: "merchant_a", sessionId: "shared_sess", cart });
  const mb = await uc.execute({ merchantId: "merchant_b", sessionId: "shared_sess", cart });

  assert.notEqual(ma.commerceOrderId, mb.commerceOrderId);
  assert.equal(createCalls, 2);
});
