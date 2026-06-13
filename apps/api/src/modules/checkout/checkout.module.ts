import { forwardRef, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AgentRulesModule } from "../agent-rules/agent-rules.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { CheckoutSettingsModule } from "../checkout-settings/checkout-settings.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { CrossSellModule } from "../cross-sell/cross-sell.module.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { AcceptCheckoutOfferUseCase } from "./application/use-cases/accept-checkout-offer.use-case.js";
import { ApplyOfferUseCase } from "./application/use-cases/apply-offer.use-case.js";
import { CompleteOrderUseCase } from "./application/use-cases/complete-order.use-case.js";
import {
  GetDashboardOverviewUseCase,
  GetMerchantRulesUseCase,
  UpdateMerchantRulesUseCase
} from "./application/use-cases/dashboard.use-cases.js";
import { EvaluateShippingUseCase } from "./application/use-cases/evaluate-shipping.use-case.js";
import { GetDecisionUseCase } from "./application/use-cases/get-decision.use-case.js";
import { GetCheckoutSessionUseCase } from "./application/use-cases/get-checkout-session.use-case.js";
import { SendChatMessageUseCase } from "./application/use-cases/send-chat-message.use-case.js";
import { StartCheckoutUseCase } from "./application/use-cases/start-checkout.use-case.js";
import { TrackCheckoutEventUseCase } from "./application/use-cases/track-checkout-event.use-case.js";
import { UpdateOrderTrackingUseCase } from "./application/use-cases/update-order-tracking.use-case.js";
import { CheckoutCustomerService } from "./application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "./application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "./application/services/checkout-offer.service.js";
import { COMMERCE_OFFER_PORT } from "./domain/ports/commerce-offer.port.js";
import { CHECKOUT_REPOSITORY } from "./domain/ports/checkout-repository.port.js";
import { CHECKOUT_SESSION_REPOSITORY } from "./domain/ports/checkout-session.repository.port.js";
import { OFFER_REPOSITORY } from "./domain/ports/offer.repository.port.js";
import { ORDER_REPOSITORY } from "./domain/ports/order.repository.port.js";
import { DASHBOARD_READ_MODEL } from "./domain/ports/dashboard-read-model.port.js";
import { AGENT_CONTEXT_PORT } from "./domain/ports/agent-context.port.js";
import { CHECKOUT_SETTINGS_PORT } from "./domain/ports/checkout-settings.port.js";
import { CHECKOUT_INTERVENTION_LEDGER } from "./domain/ports/checkout-intervention-ledger.port.js";
import { CONVERSATION_PORT } from "./domain/ports/conversation.port.js";
import { PURCHASE_HISTORY_PORT } from "./domain/ports/purchase-history.port.js";
import { AgentRulesContextAdapter } from "./infrastructure/adapters/agent-rules-context.adapter.js";
import { BuyerPurchaseHistoryAdapter } from "./infrastructure/adapters/buyer-purchase-history.adapter.js";
import { CheckoutSettingsAdapter } from "./infrastructure/adapters/checkout-settings.adapter.js";
import { DeterministicConversationAdapter } from "./infrastructure/adapters/deterministic-conversation.adapter.js";
import { BrevoBuyerEmailNotifier } from "./infrastructure/brevo-buyer-email.notifier.js";
import { ShopifyCommerceOfferAdapter } from "./infrastructure/adapters/shopify-commerce-offer.adapter.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { PrismaCheckoutRepository } from "./infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryCheckoutRepository } from "./infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryInterventionLedger } from "./infrastructure/in-memory-intervention-ledger.js";
import { PrismaInterventionLedgerRepository } from "./infrastructure/prisma-intervention-ledger.repository.js";
import { CheckoutController } from "./presentation/http/checkout.controller.js";
import { PaymentApprovedHandler } from "./application/handlers/payment-approved.handler.js";

@Module({
  imports: [
    AgentRulesModule,
    CheckoutSettingsModule,
    BuyerPurchaseHistoryModule,
    MerchantModule,
    CrossSellModule,
    forwardRef(() => ShippingModule)
  ],
  controllers: [CheckoutController],
  providers: [
    StartCheckoutUseCase,
    TrackCheckoutEventUseCase,
    GetCheckoutSessionUseCase,
    GetDecisionUseCase,
    SendChatMessageUseCase,
    CheckoutCustomerService,
    CheckoutShippingService,
    CheckoutOfferService,
    InMemoryInterventionLedger,
    {
      provide: CHECKOUT_INTERVENTION_LEDGER,
      useFactory: (memory: InMemoryInterventionLedger, prisma: PrismaClient) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaInterventionLedgerRepository(prisma);
        }
        return memory;
      },
      inject: [InMemoryInterventionLedger, PRISMA_CLIENT]
    },
    EvaluateShippingUseCase,
    AcceptCheckoutOfferUseCase,
    ApplyOfferUseCase,
    CompleteOrderUseCase,
    UpdateOrderTrackingUseCase,
    GetDashboardOverviewUseCase,
    GetMerchantRulesUseCase,
    UpdateMerchantRulesUseCase,
    InMemoryCheckoutRepository,
    AgentRulesContextAdapter,
    BuyerPurchaseHistoryAdapter,
    CheckoutSettingsAdapter,
    DeterministicConversationAdapter,
    BrevoBuyerEmailNotifier,
    ShopifyCommerceOfferAdapter,
    {
      provide: CHECKOUT_REPOSITORY,
      useFactory: (inMemory: InMemoryCheckoutRepository, prisma: PrismaClient) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaCheckoutRepository(prisma);
        }
        return inMemory;
      },
      inject: [InMemoryCheckoutRepository, PRISMA_CLIENT]
    },
    { provide: CHECKOUT_SESSION_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: OFFER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: ORDER_REPOSITORY, useExisting: CHECKOUT_REPOSITORY },
    { provide: DASHBOARD_READ_MODEL, useExisting: CHECKOUT_REPOSITORY },
    { provide: AGENT_CONTEXT_PORT, useExisting: AgentRulesContextAdapter },
    { provide: CHECKOUT_SETTINGS_PORT, useExisting: CheckoutSettingsAdapter },
    { provide: PURCHASE_HISTORY_PORT, useExisting: BuyerPurchaseHistoryAdapter },
    { provide: CONVERSATION_PORT, useExisting: DeterministicConversationAdapter },
    { provide: COMMERCE_OFFER_PORT, useExisting: ShopifyCommerceOfferAdapter },
    PaymentApprovedHandler
  ],
  exports: [
    CHECKOUT_REPOSITORY,
    CHECKOUT_SESSION_REPOSITORY,
    OFFER_REPOSITORY,
    ORDER_REPOSITORY,
    DASHBOARD_READ_MODEL,
    CompleteOrderUseCase,
    UpdateOrderTrackingUseCase,
    StartCheckoutUseCase,
    TrackCheckoutEventUseCase,
    SendChatMessageUseCase,
    ApplyOfferUseCase,
    AcceptCheckoutOfferUseCase
  ]
})
export class CheckoutModule {}
