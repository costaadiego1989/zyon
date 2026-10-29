import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "@prisma/client";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";

for (const phase of ["new", "first-send"] as const) {
  for (const privateValue of [null, undefined, "PRIVATE_CANARY", { state: "active" }]) {
    test(`payment ${phase} refuses canonical private presence (${typeof privateValue}) before journal or provider dispatch`, async () => {
      const intent = PaymentIntentEntity.create({ merchantId: "synthetic", sessionId: "session", idempotencyKey: "key",
        amountCents: 100, currency: "BRL", method: "pix" });
      intent.prepareCreation({ merchantId: "synthetic", sessionId: "session", intentId: intent.id, amountCents: 100, currency: "BRL", method: "pix" });
      if (phase === "first-send") { intent.persisted(1); intent.claimCreation("lease", new Date(0)); }
      const locks: string[] = []; let writes = 0, reads = 0, journalReads = 0;
      const tx = {
        async $queryRaw(sql: TemplateStringsArray) { locks.push(sql.join("?")); return []; },
        checkoutSession: { async findUnique(input: unknown) {
          reads++;
          assert.deepEqual(input, { where: { merchantId_sessionId: { merchantId: "synthetic", sessionId: "session" } },
            select: { merchantId: true, sessionId: true, cart: true, customer: true, shipping: true } });
          return { cart: { _storefrontCouponBinding: privateValue } };
        } },
        paymentIntent: { async findUnique() {
          journalReads++;
          return phase === "first-send" ? { creation: { ...intent.snapshot().creation, state: "ready", firstAttemptAt: undefined }, providerPaymentId: null } : null;
        }, async create() { writes++; throw new Error("unexpected_journal_write"); },
        async updateMany() { writes++; throw new Error("unexpected_journal_write"); } },
      };
      const client = { async $transaction<T>(work: (value: typeof tx) => Promise<T>) { return work(tx); } };
      await assert.rejects(new PrismaPaymentRepository(client as unknown as PrismaClient).saveIntent({ intent }), (error: unknown) => {
        assert.ok(error instanceof Error); assert.equal(error.message, "checkout_coupon_binding_conflict");
        assert.equal("cause" in error, false); assert.equal(String(error).includes("PRIVATE_CANARY"), false); return true;
      });
      assert.equal(reads, 1); assert.equal(journalReads, 1); assert.equal(writes, 0);
      assert.match(locks[0]!, /merchants.*FOR UPDATE/);
      assert.match(locks[1]!, /merchant_rules.*FOR UPDATE/);
      assert.match(locks[2]!, /own_delivery_configs.*FOR SHARE/);
      assert.match(locks[3]!, /pg_advisory_xact_lock/);
      assert.match(locks[4]!, /pg_advisory_xact_lock/);
      assert.match(locks[5]!, /checkout_sessions.*FOR UPDATE/);
      assert.equal(intent.snapshot().version ?? 0, phase === "new" ? 0 : 1);
    });
  }
}

test("uncertain already-attempted creation can record recovery without reentering bound-cart admission", async () => {
  const intent = PaymentIntentEntity.create({ merchantId: "synthetic", sessionId: "session", idempotencyKey: "key",
    amountCents: 100, currency: "BRL", method: "pix" });
  intent.prepareCreation({ merchantId: "synthetic", sessionId: "session", intentId: intent.id, amountCents: 100, currency: "BRL", method: "pix" });
  intent.claimCreation("first", new Date(0)); intent.markCreationUncertain("first", "synthetic_uncertain"); intent.persisted(1);
  const previous = intent.snapshot();
  assert.equal(intent.claimCreation("recovery", new Date(100_000)), "recover");
  let writes = 0;
  const tx = {
    async $queryRaw() { return []; },
    checkoutSession: { async findUnique() { return { cart: { _storefrontCouponBinding: "PRIVATE_CANARY" } }; } },
    paymentIntent: { async findUnique() { return { ...previous, approvedAmountCents: null, providerPaymentId: null,
      acceptedOfferId: null, commerceOrderId: null, buyerFacing: null, amountBreakdown: null }; },
    async updateMany(input: { where: { id: string; merchantId: string; version: number } }) {
      assert.deepEqual(input.where, { id: intent.id, merchantId: "synthetic", version: 1 }); writes++; return { count: 1 };
    } },
    strategyIncentiveAssignment: { async findUnique() { return null; } },
  };
  const client = { async $transaction<T>(work: (value: typeof tx) => Promise<T>) { return work(tx); } };
  await new PrismaPaymentRepository(client as unknown as PrismaClient).saveIntent({ intent });
  assert.equal(writes, 1); assert.equal(intent.snapshot().version, 2);
  assert.equal(intent.snapshot().creation?.firstAttemptAt, new Date(0).toISOString());
});
