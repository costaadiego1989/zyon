import test from "node:test";
import assert from "node:assert/strict";
import type { CommerceCartPort, CommerceOfferPort, CommerceOrderPort, TrustedCartSnapshot } from "./ports.js";

function sampleCart(ref: string): TrustedCartSnapshot {
  return {
    currency: "BRL",
    totalCents: 5000,
    lines: [{ sku: "sku-a", quantity: 2, unitPriceCents: 2500, title: "Item A" }],
    commerceCartRef: ref
  };
}

test("stub CommerceCartPort returns trusted snapshot scoped by ref", async () => {
  const port: CommerceCartPort = {
    async validateCart({ commerceCartRef }) {
      return sampleCart(commerceCartRef);
    }
  };
  const out = await port.validateCart({ merchantId: "m1", commerceCartRef: "cart_1" });
  assert.equal(out.totalCents, 5000);
  assert.equal(out.commerceCartRef, "cart_1");
});

test("stub CommerceOrderPort creates pending then marks paid", async () => {
  const ids: string[] = [];
  const port: CommerceOrderPort = {
    async createPendingOrder({ cart }) {
      ids.push(`ord_${cart.commerceCartRef}`);
      return { commerceOrderId: ids[ids.length - 1]! };
    },
    async markOrderPaid({ commerceOrderId, paymentReference }) {
      ids.push(`${commerceOrderId}:${paymentReference}`);
    }
  };
  const { commerceOrderId } = await port.createPendingOrder({
    merchantId: "m1",
    sessionId: "s1",
    cart: sampleCart("c99")
  });
  await port.markOrderPaid({
    merchantId: "m1",
    commerceOrderId,
    paymentReference: "pay_1"
  });
  assert.equal(commerceOrderId, "ord_c99");
  assert.ok(ids.some((entry) => entry.includes("pay_1")));
});

test("stub CommerceOfferPort returns serializable metadata", async () => {
  const port: CommerceOfferPort = {
    async buildOfferMetadata({ authorizedOfferId, discountCents }) {
      return { authorizedOfferId, discount_cents: discountCents };
    }
  };
  const meta = await port.buildOfferMetadata({ authorizedOfferId: "off_1", discountCents: 500 });
  assert.equal(meta.discount_cents, 500);
});
