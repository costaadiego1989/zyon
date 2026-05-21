import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { PaymentIntentEntity } from "../domain/payment-intent.entity.js";
import { PrismaPaymentRepository } from "./prisma-payment.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaPaymentRepository idempotência, buyerFacing persistido e eventos webhook",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaPaymentRepository(prisma);
    const merchantId = `mrc_pay_${crypto.randomUUID().replace(/-/g, "")}`;
    const evtId = `evt_${crypto.randomUUID().replace(/-/g, "")}`;

    const intent = PaymentIntentEntity.create({
      merchantId,
      sessionId: "sess_1",
      idempotencyKey: "idem_px",
      amountCents: 500,
      currency: "BRL",
      method: "pix",
      acceptedOfferId: "off_1",
      commerceOrderId: "draft_prisma_1"
    });
    intent.markRequiresAction({ providerPaymentId: "pay_prisma_x" });

    try {
      await repository.saveIntent({ intent });

      const later = PaymentIntentEntity.rehydrate((await repository.getIntentById(intent.id))!.snapshot());
      later.setBuyerFacingPayload({ invoiceUrl: "https://invoice.test/a" });
      await repository.saveIntent({ intent: later });

      const approved = PaymentIntentEntity.rehydrate(later.snapshot());
      approved.markApproved({ providerPaymentId: "pay_prisma_x", approvedAmountCents: 500 });
      await repository.saveIntent({ intent: approved });

      const reloadedSame = await repository.getByIdempotency(merchantId, "sess_1", "idem_px");
      assert.ok(reloadedSame);
      assert.equal(reloadedSame.snapshot().status, "approved");
      assert.equal(reloadedSame.snapshot().buyerFacing?.invoiceUrl, "https://invoice.test/a");
      assert.equal(reloadedSame.snapshot().commerceOrderId, "draft_prisma_1");

      assert.equal(await repository.hasProcessedProviderEvent(evtId), false);
      assert.equal(await repository.recordProcessedProviderEvent(evtId), true);
      assert.equal(await repository.recordProcessedProviderEvent(evtId), false);
      assert.equal(await repository.hasProcessedProviderEvent(evtId), true);
    } finally {
      await prisma.paymentProviderEvent.deleteMany({ where: { id: evtId } });
      await prisma.paymentIntent.deleteMany({ where: { merchantId } });
      await prisma.$disconnect();
    }
  }
);
