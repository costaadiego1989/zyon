import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CreatePaymentIntentUseCase } from "./application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "./application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "./application/confirm-stripe-payment.use-case.js";
import { GetPaymentIntentStatusUseCase } from "./application/get-payment-intent-status.use-case.js";
import { HandleAsaasWebhookUseCase } from "./application/handle-asaas-webhook.use-case.js";
import { HandleStripeWebhookUseCase } from "./application/handle-stripe-webhook.use-case.js";
import { ReconcilePaymentIntentsUseCase } from "./application/reconcile-payment-intents.use-case.js";
import { PaymentDispatchService } from "./application/services/payment-dispatch.service.js";
import { PAYMENT_REPOSITORY } from "./domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "./domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT } from "./domain/ports/checkout-payment.port.js";
import { PrismaPaymentRepository } from "./infrastructure/prisma-payment.repository.js";
import { AsaasPaymentAdapter } from "./infrastructure/asaas-payment.adapter.js";
import { StripePaymentAdapter } from "./infrastructure/stripe-payment.adapter.js";
import { resolvePaymentProvider } from "./infrastructure/e2e-payment-provider.js";
import { EvmCryptoPaymentAdapter } from "./infrastructure/evm-crypto-payment.adapter.js";
import { CheckoutPaymentAdapter } from "./infrastructure/checkout-payment.adapter.js";
import { PaymentHttpController } from "./presentation/http/payment.controller.js";
import { CryptoPaymentController } from "./presentation/http/crypto-payment.controller.js";
import { StripePaymentController } from "./presentation/http/stripe-payment.controller.js";
import { AsaasWebhookController } from "./presentation/http/asaas-webhook.controller.js";
import { StripeWebhookController } from "./presentation/http/stripe-webhook.controller.js";
import { isAsaasConfigured, readAsaasConnection } from "./infrastructure/asaas-env.js";
import { isStripeConfigured, readStripeConnection } from "./infrastructure/stripe-env.js";
import { HttpClientService } from "../../shared/http/http-client.service.js";
import {
  ASAAS_PLATFORM_PORT,
  BILLING_CONFIG_PORT,
  PAYMENT_PLATFORM_ENVIRONMENT,
  STRIPE_PLATFORM_PORT,
} from "./domain/ports/payment-platform-provider.port.js";
import { PAYMENT_PLATFORM_REPOSITORY } from "./domain/ports/payment-platform-repository.port.js";
import { PrismaPaymentPlatformRepository } from "./infrastructure/prisma-payment-platform.repository.js";
import { StripePlatformAdapter } from "./infrastructure/stripe-platform.adapter.js";
import { AsaasPlatformAdapter } from "./infrastructure/asaas-platform.adapter.js";
import { EnvironmentBillingConfig } from "./infrastructure/billing-env.js";
import {
  CreateAsaasSubaccountUseCase,
  CreateBillingCheckoutUseCase,
  CreateBillingPortalUseCase,
  CreateStripeConnectOnboardingLinkUseCase,
  DeletePaymentConnectionUseCase,
  GetAsaasOnboardingLinkUseCase,
  GetBillingSubscriptionUseCase,
  GetPaymentConnectionsUseCase,
  HandleStripePlatformEventUseCase,
  SaveAsaasConnectionConfigUseCase,
  SyncAsaasSubaccountUseCase,
  SyncStripeConnectUseCase,
} from "./application/payment-platform.use-cases.js";
import {
  BillingController,
  MerchantPaymentConnectionsController,
  PaymentPlatformController,
} from "./presentation/http/payment-platform.controller.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "./domain/billing-plan-guard.js";

@Module({
  imports: [
    CheckoutModule,
    CommerceModule,
    MerchantModule,
    IntegrationsModule,
  ],
  controllers: [
    PaymentHttpController,
    CryptoPaymentController,
    StripePaymentController,
    AsaasWebhookController,
    StripeWebhookController,
    PaymentPlatformController,
    MerchantPaymentConnectionsController,
    BillingController,
  ],
  providers: [
    PaymentDispatchService,
    BillingPlanMeteringService,
    PlanLimitGuard,
    CreatePaymentIntentUseCase,
    ConfirmCryptoPaymentUseCase,
    ConfirmStripePaymentUseCase,
    GetPaymentIntentStatusUseCase,
    HandleAsaasWebhookUseCase,
    HandleStripeWebhookUseCase,
    ReconcilePaymentIntentsUseCase,
    GetPaymentConnectionsUseCase,
    CreateStripeConnectOnboardingLinkUseCase,
    SyncStripeConnectUseCase,
    SaveAsaasConnectionConfigUseCase,
    DeletePaymentConnectionUseCase,
    CreateAsaasSubaccountUseCase,
    GetAsaasOnboardingLinkUseCase,
    SyncAsaasSubaccountUseCase,
    GetBillingSubscriptionUseCase,
    CreateBillingCheckoutUseCase,
    CreateBillingPortalUseCase,
    HandleStripePlatformEventUseCase,
    EvmCryptoPaymentAdapter,
    CheckoutPaymentAdapter,
    { provide: CHECKOUT_PAYMENT_PORT, useExisting: CheckoutPaymentAdapter },
    {
      provide: AsaasPaymentAdapter,
      useFactory: (http: HttpClientService) => {
        const { apiKey, baseUrl } = readAsaasConnection();
        return new AsaasPaymentAdapter(baseUrl, apiKey ?? "__missing_api_key__", http.toFetch());
      },
      inject: [HttpClientService]
    },
    {
      provide: StripePaymentAdapter,
      useFactory: () => {
        const { secretKey, publishableKey } = readStripeConnection();
        if (!secretKey) {
          throw new Error(
            "STRIPE_SECRET_KEY is not configured. Stripe payment adapter cannot start without it."
          );
        }
        return new StripePaymentAdapter(secretKey, publishableKey ?? "");
      }
    },
    {
      provide: PAYMENT_PROVIDER_PORT,
      useFactory: (
        asaas: AsaasPaymentAdapter,
        stripe: StripePaymentAdapter,
        evmCrypto: EvmCryptoPaymentAdapter,
        platformConnections: import("./domain/ports/payment-platform-repository.port.js").PaymentPlatformRepository,
        http: HttpClientService,
      ) => {
        const { baseUrl } = readAsaasConnection();
        return resolvePaymentProvider({
          stripe: isStripeConfigured() ? stripe : null,
          asaas: isAsaasConfigured() ? asaas : null,
          evmCrypto,
          platformConnections,
          asaasBaseUrl: baseUrl,
          fetchImpl: http.toFetch(),
        });
      },
      inject: [
        AsaasPaymentAdapter,
        StripePaymentAdapter,
        EvmCryptoPaymentAdapter,
        PAYMENT_PLATFORM_REPOSITORY,
        HttpClientService,
      ]
    },
    {
      provide: PAYMENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPaymentRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: PAYMENT_PLATFORM_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaPaymentPlatformRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: STRIPE_PLATFORM_PORT,
      useFactory: () => {
        const { secretKey } = readStripeConnection();
        if (!secretKey) {
          throw new Error(
            "STRIPE_SECRET_KEY is not configured. Stripe platform adapter cannot start without it."
          );
        }
        return new StripePlatformAdapter(secretKey);
      },
    },
    {
      provide: ASAAS_PLATFORM_PORT,
      useFactory: (http: HttpClientService) => {
        const { apiKey, baseUrl } = readAsaasConnection();
        return new AsaasPlatformAdapter(
          baseUrl,
          apiKey ?? "__missing__",
          http.toFetch(),
        );
      },
      inject: [HttpClientService],
    },
    {
      provide: PAYMENT_PLATFORM_ENVIRONMENT,
      useFactory: () => {
        const stripe = readStripeConnection();
        const asaas = readAsaasConnection();
        return {
          stripe: stripe.secretKey?.startsWith("sk_live_")
            ? "live"
            : "test",
          asaas: asaas.sandbox ? "test" : "live",
        };
      },
    },
    {
      provide: BILLING_CONFIG_PORT,
      useClass: EnvironmentBillingConfig,
    },
  ],
  exports: [
    CreatePaymentIntentUseCase,
    ConfirmCryptoPaymentUseCase,
    ConfirmStripePaymentUseCase,
    GetPaymentIntentStatusUseCase,
    PAYMENT_PLATFORM_REPOSITORY,
    BillingPlanMeteringService,
    PlanLimitGuard,
  ]
})
export class PaymentModule {}
