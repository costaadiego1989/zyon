import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
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
import {
  ListM2MAgentsUseCase,
  CreateM2MAgentUseCase,
  SuspendM2MAgentUseCase,
  GetProtocolConfigUseCase,
  UpsertProtocolConfigUseCase,
  M2M_MANAGEMENT_STORE,
} from "./application/m2m-management.use-cases.js";
import { NEGOTIATION_STORE } from "./domain/ports/negotiation-store.port.js";
import { PrismaNegotiationStore } from "./infrastructure/prisma-negotiation.store.js";
import { PrismaM2MManagementStore } from "./infrastructure/prisma-m2m-management.store.js";
import { M2MWebhookDispatcherService } from "./infrastructure/m2m-webhook-dispatcher.service.js";
import { NegotiationController } from "./presentation/http/negotiation.controller.js";
import { MerchantNegotiationPolicyController } from "./presentation/http/merchant-negotiation-policy.controller.js";
import { BuyerAgentNegotiationPreferencesController } from "./presentation/http/buyer-agent-negotiation-preferences.controller.js";
import { M2mController } from "./presentation/http/m2m.controller.js";
import { M2MManagementController } from "./presentation/http/m2m-management.controller.js";
import { M2mHmacGuard } from "./presentation/http/m2m-hmac.guard.js";
import { M2mDualAuthGuard } from "./presentation/http/m2m-dual-auth.guard.js";
import { ShippingModule } from "../shipping/shipping.module.js";
import { PaymentModule } from "../payment/payment.module.js";

@Module({
  imports: [AuthModule, CheckoutModule, MerchantModule, ShippingModule, PaymentModule],
  controllers: [
    NegotiationController,
    MerchantNegotiationPolicyController,
    BuyerAgentNegotiationPreferencesController,
    M2mController,
    M2MManagementController,
  ],
  providers: [
    EvaluateNegotiationUseCase,
    GetMerchantNegotiationPolicyUseCase,
    UpsertMerchantNegotiationPolicyUseCase,
    GetBuyerAgentPreferencesUseCase,
    UpsertBuyerAgentPreferencesUseCase,
    RecordNegotiationSessionUseCase,
    ApplyNegotiationAgreementToCheckoutUseCase,
    ListM2MAgentsUseCase,
    CreateM2MAgentUseCase,
    SuspendM2MAgentUseCase,
    GetProtocolConfigUseCase,
    UpsertProtocolConfigUseCase,
    M2MWebhookDispatcherService,
    M2mHmacGuard,
    M2mDualAuthGuard,
    {
      provide: NEGOTIATION_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaNegotiationStore(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: M2M_MANAGEMENT_STORE,
      useFactory: (prisma: PrismaClient) => new PrismaM2MManagementStore(prisma),
      inject: [PRISMA_CLIENT]
    },
  ]
})
export class NegotiationModule {}
