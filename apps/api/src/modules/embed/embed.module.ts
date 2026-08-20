import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PaymentModule } from "../payment/payment.module.js";
import { MessagingModule } from "../../shared/messaging/messaging.module.js";
import { IntentMemoryModule } from "../intent-memory/intent-memory.module.js";
import { EmbedTokenService } from "./domain/embed-token.service.js";
import { AgentSessionTokenService } from "./domain/agent-session-token.service.js";
import { AgentCheckoutStateService } from "./domain/agent-checkout-state.service.js";
import { IssueEmbedSessionUseCase } from "./application/issue-embed-session.use-case.js";
import { UpdateEmbedCustomerUseCase } from "./application/update-embed-customer.use-case.js";
import { StartProtocolSessionUseCase } from "./application/start-protocol-session.use-case.js";
import { TransitionProtocolStateUseCase } from "./application/transition-protocol-state.use-case.js";
import { GetProtocolStateUseCase } from "./application/get-protocol-state.use-case.js";
import { EmbedSessionsController } from "./presentation/http/embed-sessions.controller.js";
import { EmbedSessionIssuerGuard } from "./presentation/http/embed-session-issuer.guard.js";
import { EmbedAuthGuard } from "./presentation/http/embed-auth.guard.js";
import { EmbedCheckoutController, EmbedCheckoutGuardHelper } from "./presentation/http/embed-checkout.controller.js";
import { EmbedConsentController } from "./presentation/http/embed-consent.controller.js";
import { ProtocolAgentController } from "./presentation/http/protocol-agent.controller.js";
import { WidgetCatalogController } from "../catalog/presentation/http/widget-catalog.controller.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { InstallationsModule } from "../installations/installations.module.js";
import { PrismaProtocolSessionRepository, PROTOCOL_SESSION_REPOSITORY } from "./infrastructure/protocol-session.repository.js";
import { ProtocolWebhookPublisher } from "./infrastructure/protocol-webhook-publisher.js";
import { ProtocolSessionExpiryReaper } from "./infrastructure/protocol-session-expiry-reaper.js";

@Module({
  imports: [
    AuthModule,
    CheckoutModule,
    MerchantModule,
    PaymentModule,
    IntegrationsModule,
    CatalogModule,
    InstallationsModule,
    MessagingModule,
    IntentMemoryModule,
  ],
  controllers: [
    EmbedSessionsController,
    EmbedCheckoutController,
    EmbedConsentController,
    ProtocolAgentController,
    WidgetCatalogController,
  ],
  providers: [
    EmbedTokenService,
    AgentSessionTokenService,
    AgentCheckoutStateService,
    IssueEmbedSessionUseCase,
    UpdateEmbedCustomerUseCase,
    StartProtocolSessionUseCase,
    TransitionProtocolStateUseCase,
    GetProtocolStateUseCase,
    {
      provide: PROTOCOL_SESSION_REPOSITORY,
      useClass: PrismaProtocolSessionRepository,
    },
    EmbedAuthGuard,
    EmbedSessionIssuerGuard,
    EmbedCheckoutGuardHelper,
    ProtocolWebhookPublisher,
    ProtocolSessionExpiryReaper,
  ],
  exports: [
    EmbedTokenService,
    AgentSessionTokenService,
    EmbedAuthGuard,
    EmbedCheckoutGuardHelper,
  ],
})
export class EmbedModule {}
