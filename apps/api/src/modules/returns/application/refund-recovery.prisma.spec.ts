import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ProcessRefundUseCase } from "./use-cases/process-refund.use-case.js";
import { PrismaReturnRepository } from "../infrastructure/repositories/prisma-return.repository.js";

test("human refund recovery: durable claim, concurrency, timeout and eligibility", { skip: !process.env.RETURNS_DATABASE_TEST }, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, process.env.RETURNS_DATABASE_TEST_PORT); assert.equal(url.pathname, "/returns_qa");
  const db = new PrismaClient(), merchantId = `qa_recovery_${randomUUID()}`;
  await db.merchant.create({ data: { id: merchantId, name: "Disposable local refund recovery" } });
  t.after(async () => { await db.return.deleteMany({ where: { merchantId } }); await db.merchant.delete({ where: { id: merchantId } }); await db.$disconnect(); });
  let posts = 0, reads = 0, eligible = true;
  const repo = new PrismaReturnRepository(db);
  const service = {
    prepareOrderRefund: async (input: any) => ({ refunded: false, amountCents: input.amountCents, paymentIntentId: "pay_original",
      providerRequest: { merchantId, provider: "stripe", providerPaymentId: "pi_original", amountCents: input.amountCents,
        stripeConnectAccountId: "acct_original", stripeChargeMode: "direct_v2", idempotencyKey: input.idempotencyKey } }),
    canRecoverPreparedRefund: async () => { reads++; return eligible; },
    refundPreparedPayment: async (input: any) => {
      posts++;
      const returnId = input.providerRequest.idempotencyKey.slice("return:".length);
      const row = await db.return.findUniqueOrThrow({ where: { id: returnId } });
      assert.equal((row.resolution as any).refundRecovery.idempotencyKey, `return:${returnId}`);
      assert.equal(input.amountCents, 3089);
      await new Promise(resolve => setTimeout(resolve, 50));
      return { refunded: false, amountCents: 3089, paymentIntentId: "pay_original", reason: "provider_refund_unknown" };
    },
    reconcileRefundPayment: async () => ({ state: "unknown" }),
  };
  const useCase = new ProcessRefundUseCase(repo, service as any, undefined, undefined, db);
  const create = async (ageMs = 120000, providerRefundId?: string) => db.return.create({ data: {
    merchantId, buyerId: "qa-buyer", orderId: `order_${randomUUID()}`, reason: "OTHER", status: "REFUND_PROCESSING",
    refund: { create: { status: "PENDING", amountInCents: 3089, paymentIntentId: "pay_original", providerRefundId, createdAt: new Date(Date.now() - ageMs) } },
  } });
  await t.test("four simultaneous confirmations send only once and a lost response cannot be resubmitted", async () => {
    const row = await create();
    await Promise.all(Array.from({ length: 4 }, () => useCase.recover(merchantId, row.id, 3089)));
    assert.equal(posts, 1); assert.ok(reads >= 1);
    await useCase.recover(merchantId, row.id, 3089); await useCase.execute(merchantId, row.id);
    assert.equal(posts, 1); assert.equal((await repo.findById(merchantId, row.id))!.refund!.status, "PENDING");
  });
  await t.test("old, future, fresh, differently priced and known-provider attempts cannot create claims", async () => {
    for (const age of [23 * 3600000, -1000, 5000]) {
      const row = await create(age);
      await assert.rejects(useCase.recover(merchantId, row.id, 3089), /refund_recovery_window_unavailable/);
      assert.equal((await db.return.findUniqueOrThrow({ where: { id: row.id } })).resolution, null);
    }
    const amount = await create(); await assert.rejects(useCase.recover(merchantId, amount.id, 3000), /refund_preview_changed/);
    const known = await create(120000, "re_known"); await assert.rejects(useCase.recover(merchantId, known.id, 3089), /refund_recovery_requires_unconfirmed_attempt/);
    assert.equal(posts, 1);
  });
  await t.test("missing provider proof and another tenant cannot reach submission", async () => {
    const row = await create(); eligible = false;
    await assert.rejects(useCase.recover(merchantId, row.id, 3089), /refund_recovery_original_payment_unproven/);
    await assert.rejects(useCase.recover("another-merchant", row.id, 3089), /return_not_found/);
    assert.equal(posts, 1); assert.equal((await db.return.findUniqueOrThrow({ where: { id: row.id } })).resolution, null);
  });
});
