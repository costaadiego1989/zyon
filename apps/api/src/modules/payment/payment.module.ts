import { forwardRef, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { EmbedTokenService } from "../embed/domain/embed-token.service.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { BuyerAccountRepositoryModule } from "../buyer-account/buyer-account-repository.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CreatePaymentIntentUseCase } from "./application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "./application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "./application/confirm-stripe-payment.use-case.js";
import { GetPaymentIntentStatusUseCase } from "./application/get-payment-intent-status.use-case.js";
import { HandleAsaasWebhookUseCase } from "./application/handle-asaas-webhook.use-case.js";
import { HandleStripeWebhookUseCase } from "./application/handle-stripe-webhook.use-case.js";
import { HandleMercadoPagoWebhookUseCase } from "./application/handle-mercadopago-webhook.use-case.js";
import { ReconcilePaymentIntentsUseCase } from "./application/reconcile-payment-intents.use-case.js";
import { PAYMENT_REPOSITORY } from "./domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "./domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT } from "./domain/ports/checkout-payment.port.js";
import { PrismaPaymentRepository } from "./infrastructure/prisma-payment.repository.js";
import { AsaasPaymentAdapter } from "./infrastructure/asaas-payment.adapter.js";
import { StripePaymentAdapter } from "./infrastructure/stripe-payment.adapter.js";
import { MercadoPagoPaymentAdapter } from "./infrastructure/mercadopago-payment.adapter.js";
import { resolvePaymentProvider } from "./infrastructure/e2e-payment-provider.js";
import { EvmCryptoPaymentAdapter } from "./infrastructure/evm-crypto-payment.adapter.js";
import { CheckoutPaymentAdapter } from "./infrastructure/checkout-payment.adapter.js";
import { PaymentHttpController } from "./presentation/http/payment.controller.js";
import { CryptoPaymentController } from "./presentation/http/crypto-payment.controller.js";
import { CryptoQuoteController } from "./presentation/http/crypto-quote.controller.js";
import { CryptoQuoteService } from "./infrastructure/crypto-quote.service.js";
import { StripePaymentController } from "./presentation/http/stripe-payment.controller.js";
import { AsaasWebhookController } from "./presentation/http/asaas-webhook.controller.js";
import { StripeWebhookController } from "./presentation/http/stripe-webhook.controller.js";
import { MercadoPagoWebhookController } from "./presentation/http/mercadopago-webhook.controller.js";
import { CRYPTO_VERIFIER } from "./domain/ports/crypto-verifier.port.js";
import { EvmCryptoVerifier } from "./infrastructure/evm-crypto-verifier.js";
import { HttpClientService } from "../../shared/http/http-client.service.js";
import { readAsaasConnection, isAsaasConfigured } from "./infrastructure/asaas-env.js";
import { readStripeConnection, isStripeConfigured } from "./infrastructure/stripe-env.js";
import { ReconcilePaymentIntentsScheduler, ReconcilePaymentIntentsWorker } from "./infrastructure/reconciliation-payment-intents.job.js";
import { PaymentEventPublisher } from "./infrastructure/payment-event-publisher.js";
import { PaymentWebSocketGateway } from "./infrastructure/payment-ws.gateway.js";
import { readMercadoPagoConnection, isMercadoPagoConfigured } from "./infrastructure/mercadopago-env.js";
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
import { PaymentDispatchService } from "./application/services/payment-dispatch.service.js";
import { BillingPlanMeteringService } from "./domain/billing-plan-guard.js";
import { BILLING_TRIAL_JOB_QUEUE } from "./domain/ports/billing-trial-job-queue.port.js";
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
  PaymentPlatformController,
  MerchantPaymentConnectionsController,
} from "./presentation/http/payment-platform.controller.js";
import {
  MercadoPagoOAuthController,
  MerchantMercadoPagoController,
} from "./presentation/http/mercadopago-oauth.controller.js";
import {
  CreateMercadoPagoOAuthLinkUseCase,
  HandleMercadoPagoOAuthCallbackUseCase,
  SyncMercadoPagoConnectionUseCase,
  RefreshMercadoPagoTokenUseCase,
  DeleteMercadoPagoConnectionUseCase,
} from "./application/mercadopago-platform.use-cases.js";

@Module({
  imports: [
    forwardRef(() => CheckoutModule),
    CommerceModule,
    MerchantModule,
    IntegrationsModule,
    BuyerAccountRepositoryModule,
  ],
  controllers: [
    PaymentHttpController,
    CryptoPaymentController,
    CryptoQuoteController,
    StripePaymentController,
    AsaasWebhookController,
    StripeWebhookController,
    MercadoPagoWebhookController,
    PaymentPlatformController,
    MerchantPaymentConnectionsController,
    BillingController,
    MercadoPagoOAuthController,
    MerchantMercadoPagoController,
  ],
  providers: [
    CreatePaymentIntentUseCase,
    ConfirmCryptoPaymentUseCase,
    ConfirmStripePaymentUseCase,
    GetPaymentIntentStatusUseCase,
    HandleAsaasWebhookUseCase,
    HandleStripeWebhookUseCase,
    HandleMercadoPagoWebhookUseCase,
    ReconcilePaymentIntentsUseCase,
    PaymentDispatchService,
    BillingPlanMeteringService,
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
    CreateMercadoPagoOAuthLinkUseCase,
    HandleMercadoPagoOAuthCallbackUseCase,
    SyncMercadoPagoConnectionUseCase,
    RefreshMercadoPagoTokenUseCase,
    DeleteMercadoPagoConnectionUseCase,
    EvmCryptoPaymentAdapter,
    CryptoQuoteService,
    CheckoutPaymentAdapter,
    PaymentEventPublisher,
    PaymentWebSocketGateway,
    EmbedTokenService,
    // Background job: reconcile stale payment intents (every 15 minutes)
    ReconcilePaymentIntentsScheduler,
    ReconcilePaymentIntentsWorker,
    { provide: CHECKOUT_PAYMENT_PORT, useExisting: CheckoutPaymentAdapter },
    { provide: CRYPTO_VERIFIER, useClass: EvmCryptoVerifier },
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
        return new StripePaymentAdapter(secretKey, publishableKey);
      }
    },
    {
      provide: MercadoPagoPaymentAdapter,
      useFactory: (http: HttpClientService) => {
        const { accessToken, publicKey, baseUrl } = readMercadoPagoConnection();
        return new MercadoPagoPaymentAdapter(
          baseUrl,
          accessToken ?? "__missing_access_token__",
          publicKey ?? undefined,
          http.toFetch()
        );
      },
      inject: [HttpClientService]
    },
    {
      provide: PAYMENT_PROVIDER_PORT,
      useFactory: (
        asaas: AsaasPaymentAdapter,
        stripe: StripePaymentAdapter,
        mercadopago: MercadoPagoPaymentAdapter,
        evmCrypto: EvmCryptoPaymentAdapter,
        platformConnections: import("./domain/ports/payment-platform-repository.port.js").PaymentPlatformRepository,
        http: HttpClientService,
      ) => {
        const { baseUrl: asaasBaseUrl } = readAsaasConnection();
        const { baseUrl: mercadopagoBaseUrl } = readMercadoPagoConnection();
        return resolvePaymentProvider({
          stripe: isStripeConfigured() ? stripe : null,
          asaas: isAsaasConfigured() ? asaas : null,
          mercadopago: isMercadoPagoConfigured() ? mercadopago : null,
          evmCrypto,
          platformConnections,
          asaasBaseUrl,
          mercadopagoBaseUrl,
          fetchImpl: http.toFetch(),
        });
      },
      inject: [
        AsaasPaymentAdapter,
        StripePaymentAdapter,
        MercadoPagoPaymentAdapter,
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
    PaymentEventPublisher,
  ]
})
export class PaymentModule {}
