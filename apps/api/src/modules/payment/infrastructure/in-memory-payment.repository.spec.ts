import test from "node:test";
import assert from "node:assert/strict";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { InMemoryPaymentRepository } from "./in-memory-payment.repository.js";

test("tenant isolation on idempotency key (same sessionId/key, different merchants)", async () => {
  const repo = new InMemoryPaymentRepository();
  const a = PaymentIntentEntity.create({
    merchantId: "m1",
    sessionId: "s_shared",
    idempotencyKey: "idem_dup",
    amountCents: 100,
    currency: "BRL",
    method: "pix"
  });
  const b = PaymentIntentEntity.create({
    merchantId: "m2",
    sessionId: "s_shared",
    idempotencyKey: "idem_dup",
    amountCents: 200,
    currency: "BRL",
    method: "pix"
  });

  await repo.saveIntent({ intent: a });
  await repo.saveIntent({ intent: b });

  const la = await repo.getByIdempotency("m1", "s_shared", "idem_dup");
  const rb = await repo.getByIdempotency("m2", "s_shared", "idem_dup");

  assert.ok(la);
  assert.ok(rb);
  assert.equal(la.id, a.id);
  assert.equal(rb.id, b.id);
  assert.equal(la.snapshot().amountCents, 100);
  assert.equal(rb.snapshot().amountCents, 200);
});

test("getByProviderPaymentId scopes by merchant", async () => {
  const repo = new InMemoryPaymentRepository();
  const p = PaymentIntentEntity.create({
    merchantId: "m9",
    sessionId: "s1",
    idempotencyKey: "ik1",
    amountCents: 300,
    currency: "BRL",
    method: "pix"
  });
  p.markApproved({ providerPaymentId: "asaas_same_id", approvedAmountCents: 300 });
  await repo.saveIntent({ intent: p });

  const found = await repo.getByProviderPaymentId("m9", "asaas_same_id");
  assert.ok(found);
  assert.equal(found.snapshot().providerPaymentId, "asaas_same_id");

  const alien = await repo.getByProviderPaymentId("other_m", "asaas_same_id");
  assert.equal(alien, null);
});
