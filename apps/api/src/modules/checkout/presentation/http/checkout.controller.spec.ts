import test from "node:test";
import assert from "node:assert/strict";
import type { AuthorizedOffer } from "@aacp/shared-types";
import type { CommerceOfferPort } from "../../domain/ports/commerce-offer.port.js";
import type { ConversationPort } from "../../domain/ports/conversation.port.js";
import { InMemoryCheckoutRepository } from "../../infrastructure/repositories/in-memory-checkout.repository.js";
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

test("CheckoutController supports the checkout closure flow without crossing tenants", async () => {
  const repository = new InMemoryCheckoutRepository();
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

  const started = await controller.start({
    merchant_id: "mrc_1",
    session_id: "chk_1",
    customer: { email: "buyer@example.com" },
    cart: {
      currency: "BRL",
      total: 300,
      items: [{ sku: "kit", name: "Kit", price: 300, cost: 120, quantity: 1 }]
    },
    shipping: { customerPrice: 35, realCost: 37, region: "SP" }
  });
  const tracked = await controller.track({
    merchant_id: "mrc_1",
    session_id: started.session_id,
    event: "shipping_objection_detected"
  });
  const shipping = await controller.shipping({
    merchant_id: "mrc_1",
    session_id: started.session_id,
    abandonment_score: Math.max(tracked.abandonment_score, 0.7)
  });
  const applied = await controller.offer({
    merchant_id: "mrc_1",
    session_id: started.session_id,
    offer_id: shipping.offer!.id
  });
  const completed = await controller.complete({
    merchant_id: "mrc_1",
    session_id: started.session_id,
    external_order_id: "ord_1",
    order_total: 300,
    currency: "BRL",
    accepted_offer_id: shipping.offer!.id
  });

  assert.equal((await controller.session("mrc_1", started.session_id)).sessionId, "chk_1");
  assert.equal(shipping.approved, true);
  assert.equal(applied.success, true);
  assert.equal(completed.recorded, true);
  assert.equal(repository.listOutbox("mrc_1").some((event) => event.event_type === "order.completed"), true);
});
