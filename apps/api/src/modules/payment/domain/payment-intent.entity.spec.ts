import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "./payment-intent.entity.js";

describe("PaymentIntentEntity", () => {
  it("starts in pending", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "idem_1",
      amountCents: 1000,
      currency: "BRL",
      method: "pix"
    });
    assert.equal(p.status, "pending");
  });

  it("cannot approve twice with different totals", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "idem_1",
      amountCents: 1000,
      currency: "BRL",
      method: "pix"
    });
    p.markApproved({ providerPaymentId: "asaas_1", approvedAmountCents: 1000 });
    assert.throws(
      () => p.markApproved({ providerPaymentId: "asaas_2", approvedAmountCents: 999 }),
      /illegal_transition/
    );
  });

  it("rejects persisting raw card fields", () => {
    assert.throws(
      () =>
        PaymentIntentEntity.create({
          merchantId: "m1",
          sessionId: "s1",
          idempotencyKey: "idem_1",
          amountCents: 100,
          currency: "BRL",
          method: "card",
          unsafeRawCardPan: "4111"
        } as never),
      /raw_card_forbidden/
    );
  });

  it("allows requires_action then approve", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "k1",
      amountCents: 500,
      currency: "BRL",
      method: "pix"
    });
    p.markRequiresAction();
    assert.equal(p.status, "requires_action");
    p.markApproved({ providerPaymentId: "pr_1", approvedAmountCents: 500 });
    assert.equal(p.status, "approved");
  });

  it("allows pending then failed", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "k2",
      amountCents: 100,
      currency: "BRL",
      method: "pix"
    });
    p.markFailed();
    assert.equal(p.status, "failed");
  });

  it("allows cancel from pending", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "k3",
      amountCents: 100,
      currency: "BRL",
      method: "boleto"
    });
    p.markCancelled();
    assert.equal(p.status, "cancelled");
  });

  it("allows refund only from approved", () => {
    const p = PaymentIntentEntity.create({
      merchantId: "m1",
      sessionId: "s1",
      idempotencyKey: "k4",
      amountCents: 200,
      currency: "BRL",
      method: "pix"
    });
    assert.throws(() => p.markRefunded(), /illegal_transition/);
    p.markApproved({ providerPaymentId: "x", approvedAmountCents: 200 });
    p.markRefunded();
    assert.equal(p.status, "refunded");
  });
});
