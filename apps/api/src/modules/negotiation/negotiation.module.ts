import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { createPrismaClient } from "../checkout/infrastructure/prisma/prisma-client.js";
import { EvaluateNegotiationUseCase } from "./application/evaluate-negotiation.use-case.js";
import {
  GetMerchantNegotiationPolicyUseCase,
  UpsertMerchantNegotiationPolicyUseCase
} from "./application/merchant-negotiation-policy.use-cases.js";
import {
  GetBuyerAgentPreferencesUseCase,
  UpsertBuyerAgentPreferencesUseCase
} from "./application/buyer-agent-preferences.use-cases.js";
import { RecordNegotiationSessionUseCase } from "./application/record-negotiation-session.use-case.js";
import { ApplyNegotiationAgreementToCheckoutUseCase } from "./application/apply-negotiation-agreement-to-checkout.use-case.js";
import { NEGOTIATION_STORE } from "./domain/ports/negotiation-store.port.js";
import { InMemoryNegotiationStore } from "./infrastructure/in-memory-negotiation.store.js";
import { PrismaNegotiationStore } from "./infrastructure/prisma-negotiation.store.js";
import { NegotiationController } from "./presentation/http/negotiation.controller.js";
import { MerchantNegotiationPolicyController } from "./presentation/http/merchant-negotiation-policy.controller.js";
import { BuyerAgentNegotiationPreferencesController } from "./presentation/http/buyer-agent-negotiation-preferences.controller.js";

@Module({
  imports: [AuthModule, CheckoutModule],
  controllers: [
    NegotiationController,
    MerchantNegotiationPolicyController,
    BuyerAgentNegotiationPreferencesController
  ],
  providers: [
    EvaluateNegotiationUseCase,
    GetMerchantNegotiationPolicyUseCase,
    UpsertMerchantNegotiationPolicyUseCase,
    GetBuyerAgentPreferencesUseCase,
    UpsertBuyerAgentPreferencesUseCase,
    RecordNegotiationSessionUseCase,
    ApplyNegotiationAgreementToCheckoutUseCase,
    InMemoryNegotiationStore,
    {
      provide: NEGOTIATION_STORE,
      useFactory: (mem: InMemoryNegotiationStore) => {
        if (process.env.NEGOTIATION_REPOSITORY === "prisma" && process.env.DATABASE_URL) {
          return new PrismaNegotiationStore(createPrismaClient());
        }
        return mem;
      },
      inject: [InMemoryNegotiationStore]
    }
  ]
})
export class NegotiationModule {}
