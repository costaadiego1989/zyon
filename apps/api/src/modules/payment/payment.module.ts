import { Module } from "@nestjs/common";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { CreatePaymentIntentUseCase } from "./application/create-payment-intent.use-case.js";
import { HandleAsaasWebhookUseCase } from "./application/handle-asaas-webhook.use-case.js";
import { PAYMENT_REPOSITORY } from "./domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "./domain/ports/payment-provider.port.js";
import { CHECKOUT_PAYMENT_PORT } from "./domain/ports/checkout-payment.port.js";
import { InMemoryPaymentRepository } from "./infrastructure/in-memory-payment.repository.js";
import { PrismaPaymentRepository } from "./infrastructure/prisma-payment.repository.js";
import { FakePaymentProvider } from "./infrastructure/fake-payment-provider.js";
import { AsaasPaymentAdapter } from "./infrastructure/asaas-payment.adapter.js";
import { CheckoutPaymentAdapter } from "./infrastructure/checkout-payment.adapter.js";
import { PaymentHttpController } from "./presentation/http/payment.controller.js";
import { AsaasWebhookController } from "./presentation/http/asaas-webhook.controller.js";
import { isAsaasConfigured, readAsaasConnection } from "./infrastructure/asaas-env.js";

@Module({
  imports: [CheckoutModule],
  controllers: [PaymentHttpController, AsaasWebhookController],
  providers: [
    CreatePaymentIntentUseCase,
    HandleAsaasWebhookUseCase,
    InMemoryPaymentRepository,
    FakePaymentProvider,
    CheckoutPaymentAdapter,
    { provide: CHECKOUT_PAYMENT_PORT, useExisting: CheckoutPaymentAdapter },
    {
      provide: PAYMENT_PROVIDER_PORT,
      useFactory: (fake: FakePaymentProvider, asaas: AsaasPaymentAdapter) => {
        return isAsaasConfigured() ? asaas : fake;
      },
      inject: [FakePaymentProvider, AsaasPaymentAdapter]
    },
    {
      provide: AsaasPaymentAdapter,
      useFactory: () => {
        const { apiKey, baseUrl } = readAsaasConnection();
        return new AsaasPaymentAdapter(baseUrl, apiKey ?? "__missing_api_key__", globalThis.fetch.bind(globalThis));
      }
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
