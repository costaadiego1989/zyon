import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorizedOffer, CheckoutTriggerName } from "@aacp/shared-types";
import type { CheckoutSettingsPort } from "../../domain/ports/checkout-settings.port.js";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
import { PrismaInterventionLedgerRepository } from "../../infrastructure/prisma-intervention-ledger.repository.js";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
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
import { CheckoutController } from "./checkout.controller.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

const ALL_LEDGER_TEST_TRIGGERS: CheckoutTriggerName[] = [
  "shipping_objection_detected",
  "coupon_field_clicked",
  "payment_failed",
  "exit_intent_detected",
  "idle_30_seconds"
];

class LedgerCheckoutSettings implements CheckoutSettingsPort {
  async getContext(merchantId: string) {
    return {
      merchant_id: merchantId,
      checkout_settings: {
        mode: "silent_until_trigger" as const,
        open_widget_on_trigger: true,
        minimum_abandonment_score: 0,
        cooldown_seconds: 0,
        max_interventions_per_session: 2,
        enabled_triggers: ALL_LEDGER_TEST_TRIGGERS,
        handoff_enabled: true
      },
      operational_constraints: []
    };
  }
}

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
  "Prisma: intervention ledger caps trigger_agent after max interventions (Prisma ledger)",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantId = `mrc_led_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;

    try {
      const repository = new InMemoryCheckoutRepository();
      const settings = new LedgerCheckoutSettings();
      const ledger = new PrismaInterventionLedgerRepository(prisma);
      const acceptOffer = new AcceptCheckoutOfferUseCase(repository, repository, repository);
      const custService = new CheckoutCustomerService(repository);
      const shipService = new CheckoutShippingService(repository, custService);
      const offerService = new CheckoutOfferService(repository);

      const controller = new CheckoutController(
        new StartCheckoutUseCase(repository, repository, repository, undefined, repository),
        new TrackCheckoutEventUseCase(repository, repository, settings, undefined, ledger),
        new GetCheckoutSessionUseCase(repository),
        new GetDecisionUseCase(repository, settings, ledger),
        new SendChatMessageUseCase(repository, new FakeConversationPort(), custService, shipService, offerService),
        new EvaluateShippingUseCase(repository, repository, repository),
        new ApplyOfferUseCase(repository, repository, new FakeCommerceOfferPort(), acceptOffer),
        new CompleteOrderUseCase(repository, repository, repository),
        new GetDashboardOverviewUseCase(repository),
        new GetMerchantRulesUseCase(repository),
        new UpdateMerchantRulesUseCase(repository)
      );

      const started = await controller.start({
        merchant_id: merchantId,
        session_id: `chk_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`,
        customer: { email: "buyer@example.com" },
        cart: {
          currency: "BRL",
          total: 300,
          items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }]
        },
        shipping: { customerPrice: 35, realCost: 37, region: "SP" }
      });

      const sessionId = started.session_id;

      // First event — below abandonment threshold, no ledger record
      const rPayment = await controller.track({
        merchant_id: merchantId,
        session_id: sessionId,
        event: "payment_failed"
      });
      assert.equal(rPayment.trigger_agent, false);
      assert.equal(await ledger.countForSession(merchantId, sessionId), 0);

      // Second event — crosses threshold, ledger persisted to Prisma
      const rShip = await controller.track({
        merchant_id: merchantId,
        session_id: sessionId,
        event: "shipping_objection_detected"
      });
      assert.equal(rShip.abandonment_score >= 0.55, true);
      assert.equal(rShip.trigger_agent, true);
      assert.equal(await ledger.countForSession(merchantId, sessionId), 1);

      // Third event — second intervention
      const rCoupon = await controller.track({
        merchant_id: merchantId,
        session_id: sessionId,
        event: "coupon_field_clicked"
      });
      assert.equal(rCoupon.trigger_agent, true);
      assert.equal(await ledger.countForSession(merchantId, sessionId), 2);

      // Fourth event — capped (max_interventions_per_session = 2)
      const cap = await controller.track({
        merchant_id: merchantId,
        session_id: sessionId,
        event: "exit_intent_detected"
      });
      assert.equal(cap.trigger_agent, false);
      assert.equal(await ledger.countForSession(merchantId, sessionId), 2);

      // Decision confirms ledger cap reason
      const decision = await controller.decision({
        merchant_id: merchantId,
        session_id: sessionId,
        context: { event: "idle_30_seconds" }
      });
      assert.equal(decision.action, "stay_silent");
      assert.equal(decision.reason, "intervention_ledger_max_interventions");
    } finally {
      await prisma.checkoutIntervention.deleteMany({ where: { merchantId } });
      await prisma.$disconnect();
    }
  }
);
