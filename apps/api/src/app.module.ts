import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { TenantModule } from "./shared/tenant/tenant.module.js";
import { ObservabilityModule } from "./shared/observability/observability.module.js";
import { HttpModule } from "./shared/http/http.module.js";
import { PersistenceModule } from "./shared/persistence/persistence.module.js";
import { MessagingModule } from "./shared/messaging/messaging.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AgentRulesModule } from "./modules/agent-rules/agent-rules.module.js";
import { BuyerPurchaseHistoryModule } from "./modules/buyer-purchase-history/buyer-purchase-history.module.js";
import { CheckoutModule } from "./modules/checkout/checkout.module.js";
import { CheckoutSettingsModule } from "./modules/checkout-settings/checkout-settings.module.js";
import { MerchantModule } from "./modules/merchant/merchant.module.js";
import { NegotiationModule } from "./modules/negotiation/negotiation.module.js";
import { EmbedModule } from "./modules/embed/embed.module.js";
import { PaymentModule } from "./modules/payment/payment.module.js";
import { ShippingModule } from "./modules/shipping/shipping.module.js";
import { FulfillmentModule } from "./modules/fulfillment/fulfillment.module.js";
import { IntegrationsModule } from "./modules/integrations/integrations.module.js";
import { SupportModule } from "./modules/support/support.module.js";
import { BuyerAccountModule } from "./modules/buyer-account/buyer-account.module.js";
import { OnboardingModule } from "./modules/onboarding/onboarding.module.js";
import { InstallationsModule } from "./modules/installations/installations.module.js";
import { AuditModule } from "./modules/audit/audit.module.js";
import { OperationsModule } from "./modules/operations/operations.module.js";

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        quietReqLogger: true,
        customProps: (req: import("http").IncomingMessage) => ({
          correlationId:
            (req as import("http").IncomingMessage & { correlationId?: string })
              .correlationId ??
            (req.headers["x-correlation-id"] as string | undefined) ??
            crypto.randomUUID(),
        }),
        transport: process.env.NODE_ENV !== "production"
          ? { target: "pino-pretty", options: { colorize: true, singleLine: true } }
          : undefined,
      },
    }),
    TenantModule,
    ObservabilityModule,
    HttpModule,
    PersistenceModule,
    MessagingModule,
    AuthModule,
    MerchantModule,
    AgentRulesModule,
    CheckoutSettingsModule,
    BuyerPurchaseHistoryModule,
    CheckoutModule,
    NegotiationModule,
    EmbedModule,
    PaymentModule,
    ShippingModule,
    FulfillmentModule,
    IntegrationsModule,
    SupportModule,
    BuyerAccountModule,
    OnboardingModule,
    InstallationsModule,
    AuditModule,
    OperationsModule
  ]
})
export class AppModule {}
