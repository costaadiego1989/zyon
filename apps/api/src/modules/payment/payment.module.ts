import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { MerchantModule } from "../merchant/merchant.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { CreatePaymentIntentUseCase } from "./application/create-payment-intent.use-case.js";
import { ConfirmCryptoPaymentUseCase } from "./application/confirm-crypto-payment.use-case.js";
import { ConfirmStripePaymentUseCase } from "./application/confirm-stripe-payment.use-case.js";
import { HandleAsaasWebhookUseCase } from "./application/handle-asaas-webhook.use-case.js";
import { HandleStripeWebhookUseCase } from "./application/handle-stripe-webhook.use-case.js";
import { ReconcilePaymentIntentsUseCase } from "./application/reconcile-payment-intents.use-case.js";
import { PAYMENT_REPOSITORY } from "./domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "./domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT } from "./domain/ports/checkout-payment.port.js";
import { PrismaPaymentRepository } from "./infrastructure/prisma-payment.repository.js";
import { FakePaymentProvider } from "./infrastructure/fake-payment-provider.js";
import { AsaasPaymentAdapter } from "./infrastructure/asaas-payment.adapter.js";
import { StripePaymentAdapter } from "./infrastructure/stripe-payment.adapter.js";
import { RoutingPaymentAdapter } from "./infrastructure/routing-payment.adapter.js";
import { EvmCryptoPaymentAdapter } from "./infrastructure/evm-crypto-payment.adapter.js";
import { CheckoutPaymentAdapter } from "./infrastructure/checkout-payment.adapter.js";
import { PaymentHttpController } from "./presentation/http/payment.controller.js";
import { CryptoPaymentController } from "./presentation/http/crypto-payment.controller.js";
import { StripePaymentController } from "./presentation/http/stripe-payment.controller.js";
import { AsaasWebhookController } from "./presentation/http/asaas-webhook.controller.js";
import { StripeWebhookController } from "./presentation/http/stripe-webhook.controller.js";
import { isAsaasConfigured, readAsaasConnection } from "./infrastructure/asaas-env.js";
import { isStripeConfigured, readStripeConnection } from "./infrastructure/stripe-env.js";
import { StripeConnectProvisioner } from "./infrastructure/stripe-connect.provisioner.js";
import { HttpClientService } from "../../shared/http/http-client.service.js";

function shouldForceFakePaymentProvider(): boolean {
  return process.env.PAYMENT_PROVIDER === "fake" || process.env.E2E_SEED_ENABLED === "true";
}

@Module({
  imports: [CheckoutModule, CommerceModule, MerchantModule],
  controllers: [PaymentHttpController, CryptoPaymentController, StripePaymentController, AsaasWebhookController, StripeWebhookController],
  providers: [
    CreatePaymentIntentUseCase,
    ConfirmCryptoPaymentUseCase,
    ConfirmStripePaymentUseCase,
    HandleAsaasWebhookUseCase,
    HandleStripeWebhookUseCase,
    StripeConnectProvisioner,
    ReconcilePaymentIntentsUseCase,
    FakePaymentProvider,
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
        return new StripePaymentAdapter(secretKey ?? "__missing__", publishableKey ?? "");
      }
    },
    {
      provide: PAYMENT_PROVIDER_PORT,
      useFactory: (fake: FakePaymentProvider, asaas: AsaasPaymentAdapter, stripe: StripePaymentAdapter, evmCrypto: EvmCryptoPaymentAdapter) => {
        if (shouldForceFakePaymentProvider()) return fake;
        return new RoutingPaymentAdapter(
          isStripeConfigured() ? stripe : null,
          isAsaasConfigured() ? asaas : null,
          evmCrypto,
          fake
        );
      },
      inject: [FakePaymentProvider, AsaasPaymentAdapter, StripePaymentAdapter, EvmCryptoPaymentAdapter]
    },
    {
      provide: PAYMENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPaymentRepository(prisma),
      inject: [PRISMA_CLIENT]
    }
  ],
  exports: [CreatePaymentIntentUseCase, ConfirmCryptoPaymentUseCase, ConfirmStripePaymentUseCase, StripeConnectProvisioner]
})
export class PaymentModule {}
