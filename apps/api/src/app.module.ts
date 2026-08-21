import { Module } from "@nestjs/common";
import { LoggerModule } from "nestjs-pino";
import { TenantModule } from "./shared/tenant/tenant.module.js";
import { ObservabilityModule } from "./shared/observability/observability.module.js";
import { HttpModule } from "./shared/http/http.module.js";
import { PersistenceModule } from "./shared/persistence/persistence.module.js";
import { DataRetentionModule } from "./shared/retention/data-retention.module.js";
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
import { CatalogModule } from "./modules/catalog/catalog.module.js";
import { StoreSettingsModule } from "./modules/store-settings/store-settings.module.js";
import { ReturnsModule } from "./modules/returns/returns.module.js";
import { StoreAnalyticsModule } from "./modules/store-analytics/store-analytics.module.js";
import { TeamModule } from "./modules/team/team.module.js";
import { DomainsModule } from "./modules/domains/domains.module.js";
import { NotificationsModule } from "./modules/notifications/notifications.module.js";
import { StorefrontModule } from "./modules/storefront/storefront.module.js";
import { StorageModule } from "./shared/storage/storage.module.js";
import { StoriesModule } from "./modules/stories/stories.module.js";
import { ExperimentsModule } from "./modules/experiments/experiments.module.js";
import { MarketplaceModule } from "./modules/marketplace/marketplace.module.js";
import { DashboardMarketplaceModule } from "./modules/dashboard/dashboard-marketplace.module.js";
import { RevenueManagerModule } from "./modules/revenue-manager/revenue-manager.module.js";
import { RevenueLiftModule } from "./modules/revenue-lift/revenue-lift.module.js";
import { CartRecoveryModule } from "./modules/cart-recovery/cart-recovery.module.js";
import { IntentMemoryModule } from "./modules/intent-memory/intent-memory.module.js";
import { CouponsModule } from "./modules/coupons/coupons.module.js";
// import { PublicApiModule } from "./modules/public-api/public-api.module.js"; // TODO: fix DI (AuthenticateMerchantApiKeyService)

const REDACTED_LOG_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['asaas-access-token']",
  "req.headers['stripe-signature']",
  "req.body.password",
  "req.body.creditCard",
  "req.body.cvv",
  "req.body.ccv",
  "req.body.email",
  "req.body.cpf",
  "req.body.phone",
  "req.body.customer.email",
  "req.body.customer.cpf",
  "req.body.customer.phone",
  "req.body.customer.fullName",
  "req.body.customer.address",
  "req.body.address",
  "req.body.display_name",
  "req.body.mobile_phone",
  "req.body.cpf_cnpj",
  "res.body.access_token",
  "res.body.email",
  "res.body.cpf",
  "res.body.phone",
  "res.body.customer",
];

@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        autoLogging: true,
        quietReqLogger: true,
        redact: { paths: REDACTED_LOG_PATHS, censor: "[redacted]" },
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
    DataRetentionModule,
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
    OperationsModule,
    StoriesModule,
    CatalogModule,
    StoreSettingsModule,
    ReturnsModule,
    StoreAnalyticsModule,
    TeamModule,
    DomainsModule,
    NotificationsModule,
    StorefrontModule,
    StorageModule,
    ExperimentsModule,
    RevenueManagerModule,
    RevenueLiftModule,
    MarketplaceModule,
    DashboardMarketplaceModule,
    CartRecoveryModule,
    IntentMemoryModule,
    CouponsModule,
    // PublicApiModule, // TODO: fix DI (CommerceV1Controller, InstallationsModule)
  ]
})
export class AppModule {}
