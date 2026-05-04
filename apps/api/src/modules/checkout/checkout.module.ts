import { Module } from "@nestjs/common";
import { AgentRulesModule } from "../agent-rules/agent-rules.module.js";
import { BuyerPurchaseHistoryModule } from "../buyer-purchase-history/buyer-purchase-history.module.js";
import { CheckoutSettingsModule } from "../checkout-settings/checkout-settings.module.js";
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
import { COMMERCE_OFFER_PORT } from "./domain/ports/commerce-offer.port.js";
import { CHECKOUT_REPOSITORY } from "./domain/ports/checkout-repository.port.js";
import { AGENT_CONTEXT_PORT } from "./domain/ports/agent-context.port.js";
import { CHECKOUT_SETTINGS_PORT } from "./domain/ports/checkout-settings.port.js";
import { CHECKOUT_INTERVENTION_LEDGER } from "./domain/ports/checkout-intervention-ledger.port.js";
import { CONVERSATION_PORT } from "./domain/ports/conversation.port.js";
import { PURCHASE_HISTORY_PORT } from "./domain/ports/purchase-history.port.js";
import { AgentRulesContextAdapter } from "./infrastructure/adapters/agent-rules-context.adapter.js";
import { BuyerPurchaseHistoryAdapter } from "./infrastructure/adapters/buyer-purchase-history.adapter.js";
import { CheckoutSettingsAdapter } from "./infrastructure/adapters/checkout-settings.adapter.js";
import { OpenAiConversationAdapter } from "./infrastructure/adapters/openai-conversation.adapter.js";
import { ShopifyCommerceOfferAdapter } from "./infrastructure/adapters/shopify-commerce-offer.adapter.js";
import { createPrismaClient } from "./infrastructure/prisma/prisma-client.js";
import { PrismaCheckoutRepository } from "./infrastructure/prisma/prisma-checkout.repository.js";
import { InMemoryCheckoutRepository } from "./infrastructure/repositories/in-memory-checkout.repository.js";
import { InMemoryInterventionLedger } from "./infrastructure/in-memory-intervention-ledger.js";
import { PrismaInterventionLedgerRepository } from "./infrastructure/prisma-intervention-ledger.repository.js";
import { CheckoutController } from "./presentation/http/checkout.controller.js";

@Module({
  imports: [AgentRulesModule, CheckoutSettingsModule, BuyerPurchaseHistoryModule],
  controllers: [CheckoutController],
  providers: [
    StartCheckoutUseCase,
    TrackCheckoutEventUseCase,
    GetCheckoutSessionUseCase,
    GetDecisionUseCase,
    SendChatMessageUseCase,
    InMemoryInterventionLedger,
    {
      provide: CHECKOUT_INTERVENTION_LEDGER,
      useFactory: (memory: InMemoryInterventionLedger) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaInterventionLedgerRepository(createPrismaClient());
        }
        return memory;
      },
      inject: [InMemoryInterventionLedger]
    },
    EvaluateShippingUseCase,
    AcceptCheckoutOfferUseCase,
    ApplyOfferUseCase,
    CompleteOrderUseCase,
    GetDashboardOverviewUseCase,
    GetMerchantRulesUseCase,
    UpdateMerchantRulesUseCase,
    InMemoryCheckoutRepository,
    AgentRulesContextAdapter,
    BuyerPurchaseHistoryAdapter,
    CheckoutSettingsAdapter,
    OpenAiConversationAdapter,
    ShopifyCommerceOfferAdapter,
    {
      provide: CHECKOUT_REPOSITORY,
      useFactory: (inMemory: InMemoryCheckoutRepository) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaCheckoutRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemoryCheckoutRepository]
    },
    { provide: AGENT_CONTEXT_PORT, useExisting: AgentRulesContextAdapter },
    { provide: CHECKOUT_SETTINGS_PORT, useExisting: CheckoutSettingsAdapter },
    { provide: PURCHASE_HISTORY_PORT, useExisting: BuyerPurchaseHistoryAdapter },
    { provide: CONVERSATION_PORT, useExisting: OpenAiConversationAdapter },
    { provide: COMMERCE_OFFER_PORT, useExisting: ShopifyCommerceOfferAdapter }
  ],
  exports: [
    CHECKOUT_REPOSITORY,
    CompleteOrderUseCase,
    StartCheckoutUseCase,
    TrackCheckoutEventUseCase,
    SendChatMessageUseCase,
    ApplyOfferUseCase,
    AcceptCheckoutOfferUseCase
  ]
})
export class CheckoutModule {}
