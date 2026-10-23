import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";

for (const phase of ["new", "first-send"] as const) for (const source of ["checkout", "storefront"] as const) {
  for (const [index, value] of [undefined, null, "PRIVATE_WIDGET_CANARY", { origin: "widget_checkout" }].entries()) {
    test(`widget receipt blocks ${phase} payment before coupon capture/journal: ${source}/${index}`, async () => {
      const intent = PaymentIntentEntity.create({ merchantId: "synthetic", sessionId: "session", idempotencyKey: "key",
        amountCents: 100, currency: "BRL", method: "pix" });
      intent.prepareCreation({ merchantId: "synthetic", sessionId: "session", intentId: intent.id, amountCents: 100, currency: "BRL", method: "pix" });
      if (phase === "first-send") { intent.persisted(1); intent.claimCreation("lease", new Date(0)); }
      let captures = 0, writes = 0;
      const tx = {
        $queryRaw: async () => [],
        checkoutSession: { findUnique: async () => ({ cart: { source, cart_ref: "synthetic-cart", _widgetCrossSellAcceptance: value } }) },
        paymentIntent: { findUnique: async () => phase === "first-send"
          ? { creation: { ...intent.snapshot().creation, state: "ready", firstAttemptAt: undefined }, providerPaymentId: null } : null,
          create: async () => { writes++; throw new Error("unexpected_create"); },
          updateMany: async () => { writes++; throw new Error("unexpected_update"); } },
      };
      const client = { $transaction: async <T>(work: (value: typeof tx) => Promise<T>) => work(tx) };
      const repo = new PrismaPaymentRepository(client as unknown as PrismaClient, async () => { captures++; throw new Error("unexpected_capture"); });
      await assert.rejects(repo.saveIntent({ intent }), (error: unknown) => {
        assert.ok(error instanceof Error); assert.equal(error.message, "cross_sell_quote_review_required");
        assert.equal("cause" in error, false); assert.equal(String(error.stack).includes("PRIVATE_WIDGET_CANARY"), false); return true;
      });
      assert.equal(captures, 0); assert.equal(writes, 0);
      assert.equal(intent.snapshot().version, phase === "new" ? 0 : 1);
    });
  }
}

test("widget receipt does not block recording an already-attempted uncertain payment recovery", async () => {
  const intent = PaymentIntentEntity.create({ merchantId: "synthetic", sessionId: "session", idempotencyKey: "key",
    amountCents: 100, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId: "synthetic", sessionId: "session", intentId: intent.id, amountCents: 100, currency: "BRL", method: "pix" });
  intent.claimCreation("first", new Date(0)); intent.markCreationUncertain("first", "synthetic_uncertain"); intent.persisted(1);
  const previous = intent.snapshot();
  assert.equal(intent.claimCreation("recovery", new Date(100_000)), "recover");
  let writes = 0;
  const tx = { $queryRaw: async () => [],
    checkoutSession: { findUnique: async () => ({ cart: { _widgetCrossSellAcceptance: "PRIVATE_WIDGET_CANARY" } }) },
    paymentIntent: { findUnique: async () => ({ ...previous, approvedAmountCents: null, providerPaymentId: null,
      acceptedOfferId: null, commerceOrderId: null, buyerFacing: null, amountBreakdown: null }),
      updateMany: async () => { writes++; return { count: 1 }; } },
    strategyIncentiveAssignment: { findUnique: async () => null },
  };
  const client = { $transaction: async <T>(work: (value: typeof tx) => Promise<T>) => work(tx) };
  await new PrismaPaymentRepository(client as unknown as PrismaClient).saveIntent({ intent });
  assert.equal(writes, 1); assert.equal(intent.snapshot().version, 2);
  assert.equal(intent.snapshot().creation?.firstAttemptAt, new Date(0).toISOString());
});
