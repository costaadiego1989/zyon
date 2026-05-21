import { Module } from "@nestjs/common";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { CreatePaymentIntentUseCase } from "./application/create-payment-intent.use-case.js";
import { HandleAsaasWebhookUseCase } from "./application/handle-asaas-webhook.use-case.js";
import { HandleStripeWebhookUseCase } from "./application/handle-stripe-webhook.use-case.js";
import { PAYMENT_REPOSITORY } from "./domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "./domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT } from "./domain/ports/checkout-payment.port.js";
import { InMemoryPaymentRepository } from "./infrastructure/in-memory-payment.repository.js";
import { PrismaPaymentRepository } from "./infrastructure/prisma-payment.repository.js";
import { FakePaymentProvider } from "./infrastructure/fake-payment-provider.js";
import { AsaasPaymentAdapter } from "./infrastructure/asaas-payment.adapter.js";
import { StripePaymentAdapter } from "./infrastructure/stripe-payment.adapter.js";
import { RoutingPaymentAdapter } from "./infrastructure/routing-payment.adapter.js";
import { CheckoutPaymentAdapter } from "./infrastructure/checkout-payment.adapter.js";
import { PaymentHttpController } from "./presentation/http/payment.controller.js";
import { AsaasWebhookController } from "./presentation/http/asaas-webhook.controller.js";
import { StripeWebhookController } from "./presentation/http/stripe-webhook.controller.js";
import { isAsaasConfigured, readAsaasConnection } from "./infrastructure/asaas-env.js";
import { isStripeConfigured, readStripeConnection } from "./infrastructure/stripe-env.js";
import { HttpClientService } from "../../shared/http/http-client.service.js";

function shouldForceFakePaymentProvider(): boolean {
  return process.env.PAYMENT_PROVIDER === "fake" || process.env.E2E_SEED_ENABLED === "true";
}

@Module({
  imports: [CheckoutModule, CommerceModule],
  controllers: [PaymentHttpController, AsaasWebhookController, StripeWebhookController],
  providers: [
    CreatePaymentIntentUseCase,
    HandleAsaasWebhookUseCase,
    HandleStripeWebhookUseCase,
    InMemoryPaymentRepository,
    FakePaymentProvider,
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
      useFactory: (fake: FakePaymentProvider, asaas: AsaasPaymentAdapter, stripe: StripePaymentAdapter) => {
        if (shouldForceFakePaymentProvider()) return fake;
        return new RoutingPaymentAdapter(
          isStripeConfigured() ? stripe : null,
          isAsaasConfigured() ? asaas : null,
          fake
        );
      },
      inject: [FakePaymentProvider, AsaasPaymentAdapter, StripePaymentAdapter]
    },
    {
      provide: PAYMENT_REPOSITORY,
      useFactory: (memory: InMemoryPaymentRepository) => {
        if (process.env.CHECKOUT_REPOSITORY === "prisma") {
          return new PrismaPaymentRepository(createPrismaClient());
        }
        return memory;
      },
      inject: [InMemoryPaymentRepository]
    }
  ],
  exports: [CreatePaymentIntentUseCase]
})
export class PaymentModule {}
