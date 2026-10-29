import test from "node:test";
import assert from "node:assert/strict";
import { authorizedOffer, checkoutSession } from "../../__tests__/checkout-test-fixtures.js";
import { createCheckoutEventEnvelope } from "../../domain/events/checkout-domain-event.js";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaCheckoutRepository persists checkout state with tenant isolation and outbox",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaCheckoutRepository(prisma);
    const merchantId = `mrc_prisma_${crypto.randomUUID()}`;
    const sessionId = `chk_${crypto.randomUUID()}`;
    const offerId = `off_${crypto.randomUUID()}`;

    try {
      const firstUser = await repository.resolveGlobalUserId(merchantId, { email: "buyer@example.com" });
      const secondUser = await repository.resolveGlobalUserId(merchantId, { email: " Buyer@Example.com " });
      const otherMerchantUser = await repository.resolveGlobalUserId(`${merchantId}_other`, {
        email: "buyer@example.com"
      });
      assert.equal(firstUser, secondUser);
      assert.notEqual(firstUser, otherMerchantUser);

      await repository.saveSession(checkoutSession({ merchantId, sessionId, globalUserId: firstUser }));
      assert.equal((await repository.getSession(merchantId, sessionId))?.sessionId, sessionId);
      assert.equal(await repository.getSession(`${merchantId}_other`, sessionId), undefined);

      const shippingSessionId = `chk_ship_${crypto.randomUUID()}`;
      await repository.saveSession(checkoutSession({
        merchantId,
        sessionId: shippingSessionId,
        globalUserId: firstUser,
        shipping: undefined,
        shippingOptions: [
          { customerPrice: 18.5, realCost: 18.5, carrier: "correios-pac", method: "PAC", deliveryDays: 5 },
          { customerPrice: 0, realCost: 0, carrier: "free-pac", method: "Frete gratis", deliveryDays: 7 }
        ]
      }));
      const persistedBeforeSelection = await repository.getSession(merchantId, shippingSessionId);
      assert.equal(persistedBeforeSelection?.shipping, undefined);
      assert.equal(persistedBeforeSelection?.shippingOptions?.length, 2);

      await repository.saveSession({
        ...persistedBeforeSelection!,
        shipping: persistedBeforeSelection!.shippingOptions![1],
        updatedAt: new Date().toISOString()
      });
      const persistedAfterSelection = await repository.getSession(merchantId, shippingSessionId);
      assert.equal(persistedAfterSelection?.shipping?.customerPrice, 0);
      assert.equal(persistedAfterSelection?.shipping?.method, "Frete gratis");
      assert.equal(persistedAfterSelection?.shippingOptions?.[0]?.customerPrice, 18.5);

      await repository.recordEvent(merchantId, sessionId, "coupon_field_clicked");
      assert.equal((await repository.getSession(merchantId, sessionId))?.abandonmentScore, 0.22);

      await repository.saveOffer(authorizedOffer({ id: offerId, merchantId, sessionId }));
      assert.equal((await repository.getOffer(merchantId, offerId))?.id, offerId);

      await repository.saveAcceptedOffer({
        merchantId,
        sessionId,
        offerId,
        type: "discount_percent",
        value: 10,
        marginAfterOffer: 0.5,
        acceptedAt: new Date().toISOString(),
        expiresAt: "2999-01-01T00:00:00.000Z"
      });
      assert.equal((await repository.getAcceptedOffer(merchantId, sessionId, offerId))?.offerId, offerId);

      const order = {
        merchantId,
        sessionId,
        externalOrderId: `ord_${crypto.randomUUID()}`,
        orderTotal: 300,
        currency: "BRL" as const,
        acceptedOfferId: offerId,
        completedAt: new Date().toISOString()
      };
      assert.equal((await repository.saveCompletedOrder(order)).idempotent, false);
      assert.equal((await repository.saveCompletedOrder(order)).idempotent, true);
      const trackedOrder = await repository.updateCompletedOrderTracking({
        merchantId,
        sessionId,
        externalOrderId: order.externalOrderId,
        trackingCode: "BR123456789AA"
      });
      assert.equal(trackedOrder?.trackingCode, "BR123456789AA");
      assert.equal(
        (await repository.getCompletedOrder(merchantId, sessionId, order.externalOrderId))?.trackingCode,
        "BR123456789AA"
      );

      await repository.appendOutbox(
        createCheckoutEventEnvelope({
          eventType: "order.completed",
          merchantId,
          payload: { session_id: sessionId, external_order_id: order.externalOrderId }
        })
      );
      assert.equal((await repository.listOutbox(merchantId)).length, 1);
    } finally {
      await cleanupMerchant(prisma, merchantId);
      await cleanupMerchant(prisma, `${merchantId}_other`);
      await prisma.$disconnect();
    }
  }
);

async function cleanupMerchant(prisma: ReturnType<typeof createPrismaClient>, merchantId: string): Promise<void> {
  await prisma.outboxMessage.deleteMany({ where: { merchantId } });
  await prisma.acceptedOffer.deleteMany({ where: { merchantId } });
  await prisma.completedOrder.deleteMany({ where: { merchantId } });
  await prisma.authorizedOffer.deleteMany({ where: { merchantId } });
  await prisma.checkoutEvent.deleteMany({ where: { merchantId } });
  await prisma.checkoutSession.deleteMany({ where: { merchantId } });
  await prisma.buyerIdentity.deleteMany({ where: { merchantId } });
  await prisma.merchantRule.deleteMany({ where: { merchantId } });
}
