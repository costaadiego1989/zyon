import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { HttpClientService } from "../../shared/http/http-client.service.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { ValidateCartForPaymentUseCase } from "./application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "./application/sync-pending-order.use-case.js";
import { MarkCommerceOrderPaidUseCase } from "./application/mark-commerce-order-paid.use-case.js";
import { COMMERCE_CART_PORT } from "./domain/ports/commerce-cart.port.js";
import { COMMERCE_ORDER_PORT } from "./domain/ports/commerce-order.port.js";
import { COMMERCE_CONNECTION_PORT } from "./domain/ports/commerce-connection.port.js";
import { COMMERCE_PAID_WEBHOOK_DEDUP } from "./domain/ports/commerce-paid-webhook-dedup.port.js";
import { COMMERCE_PENDING_ORDER_INDEX } from "./domain/ports/pending-commerce-order-index.port.js";
import { InMemoryCommercePaidWebhookDedup } from "./infrastructure/in-memory-commerce-paid-webhook-dedup.js";
import { InMemoryPendingCommerceOrderIndex } from "./infrastructure/in-memory-pending-commerce-order-index.js";
import { InMemoryCommerceConnectionRepository } from "./infrastructure/in-memory-commerce-connection.repository.js";
import { PrismaPendingCommerceOrderIndex } from "./infrastructure/prisma-pending-commerce-order-index.repository.js";
import { PrismaCommercePaidWebhookDedup } from "./infrastructure/prisma-commerce-paid-webhook-dedup.repository.js";
import { PrismaCommerceConnectionRepository } from "./infrastructure/prisma-commerce-connection.repository.js";
import { TenantCommerceAdapterFactory } from "./infrastructure/tenant-commerce-adapter.factory.js";

function usePrisma(): boolean {
  return process.env.CHECKOUT_REPOSITORY === "prisma";
}

@Module({
  providers: [
    InMemoryCommercePaidWebhookDedup,
    InMemoryPendingCommerceOrderIndex,
    InMemoryCommerceConnectionRepository,
    TenantCommerceAdapterFactory,
    {
      provide: COMMERCE_CONNECTION_PORT,
      useFactory: (memory: InMemoryCommerceConnectionRepository, prisma: PrismaClient) =>
        usePrisma() ? new PrismaCommerceConnectionRepository(prisma) : memory,
      inject: [InMemoryCommerceConnectionRepository, PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_PENDING_ORDER_INDEX,
      useFactory: (memory: InMemoryPendingCommerceOrderIndex, prisma: PrismaClient) =>
        usePrisma() ? new PrismaPendingCommerceOrderIndex(prisma) : memory,
      inject: [InMemoryPendingCommerceOrderIndex, PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_PAID_WEBHOOK_DEDUP,
      useFactory: (memory: InMemoryCommercePaidWebhookDedup, prisma: PrismaClient) =>
        usePrisma() ? new PrismaCommercePaidWebhookDedup(prisma) : memory,
      inject: [InMemoryCommercePaidWebhookDedup, PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_CART_PORT,
      useExisting: TenantCommerceAdapterFactory
    },
    {
      provide: COMMERCE_ORDER_PORT,
      useExisting: TenantCommerceAdapterFactory
    },
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase
  ],
  exports: [
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase,
    COMMERCE_PENDING_ORDER_INDEX,
    COMMERCE_PAID_WEBHOOK_DEDUP,
    COMMERCE_CONNECTION_PORT
  ]
})
export class CommerceModule {}
