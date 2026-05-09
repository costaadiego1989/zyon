import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorizedOffer } from "@aacp/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { AcceptCheckoutOfferUseCase } from "../../application/use-cases/accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "../../application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "../../application/use-cases/complete-order.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "../../application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "../../application/use-cases/evaluate-shipping.use-case.js";
import { GetCheckoutSessionUseCase } from "../../application/use-cases/get-checkout-session.use-case.js";
import { GetDecisionUseCase } from "../../application/use-cases/get-decision.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "../../application/use-cases/track-checkout-event.use-case.js";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaCheckoutRepository } from "../../infrastructure/prisma/prisma-checkout.repository.js";
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

class FakeConversationPort implements ConversationPort {
  async reply(input: { authorizedOffer?: AuthorizedOffer }) {
    return {
      message: input.authorizedOffer?.approved ? "Oferta autorizada." : "Posso ajudar com seguranca.",
      objection: "shipping_cost" as const
    };
  }
}

class FakeCommerceOfferPort implements CommerceOfferPort {
  async apply(offer: AuthorizedOffer) {
    return {
      success: true,
      discount_code: offer.discountCode,
      apply_url: `https://shop.example/discount/${offer.discountCode}`
    };
  }
}

test(
  "Prisma checkout e2e flow starts, tracks, applies an offer, and completes an order",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma e2e tests." },
  async () => {
    const prisma = createPrismaClient();
    const repository = new PrismaCheckoutRepository(prisma);
    const acceptOffer = new AcceptCheckoutOfferUseCase(repository);
    const custService = new CheckoutCustomerService(repository);
    const shipService = new CheckoutShippingService(repository, custService);
    const offerService = new CheckoutOfferService(repository);
    const controller = new CheckoutController(
      new StartCheckoutUseCase(repository),
      new TrackCheckoutEventUseCase(repository),
      new GetCheckoutSessionUseCase(repository),
      new GetDecisionUseCase(repository),
      new SendChatMessageUseCase(repository, new FakeConversationPort(), custService, shipService, offerService),
      new EvaluateShippingUseCase(repository),
      new ApplyOfferUseCase(repository, new FakeCommerceOfferPort(), acceptOffer),
      new CompleteOrderUseCase(repository),
      new GetDashboardOverviewUseCase(repository),
      new GetMerchantRulesUseCase(repository),
      new UpdateMerchantRulesUseCase(repository)
    );
    const merchantId = `mrc_e2e_${crypto.randomUUID()}`;
    const sessionId = `chk_${crypto.randomUUID()}`;

    try {
      const started = await controller.start({
        merchant_id: merchantId,
        session_id: sessionId,
        customer: { email: "buyer@example.com" },
        cart: {
          currency: "BRL",
          total: 300,
          items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }]
        },
        shipping: { customerPrice: 35, realCost: 37, region: "SP" }
      });
      const tracked = await controller.track({
        merchant_id: merchantId,
        session_id: started.session_id,
        event: "shipping_objection_detected"
      });
      const shipping = await controller.shipping({
        merchant_id: merchantId,
        session_id: started.session_id,
        abandonment_score: Math.max(tracked.abandonment_score, 0.7)
      });
      const applied = await controller.offer({
        merchant_id: merchantId,
        session_id: started.session_id,
        offer_id: shipping.offer!.id
      });
      const completed = await controller.complete({
        merchant_id: merchantId,
        session_id: started.session_id,
        external_order_id: `ord_${crypto.randomUUID()}`,
        order_total: 300,
        currency: "BRL",
        accepted_offer_id: shipping.offer!.id
      });

      assert.equal((await controller.session(merchantId, sessionId)).sessionId, sessionId);
      assert.equal(shipping.approved, true);
      assert.equal(applied.success, true);
      assert.equal(completed.recorded, true);
      assert.equal((await repository.listOutbox(merchantId)).some((event) => event.event_type === "order.completed"), true);
    } finally {
      await cleanupMerchant(prisma, merchantId);
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
