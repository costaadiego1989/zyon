import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { ValidateCartForPaymentUseCase } from "./application/validate-cart-for-payment.use-case.js";
import { SyncPendingOrderUseCase } from "./application/sync-pending-order.use-case.js";
import { MarkCommerceOrderPaidUseCase } from "./application/mark-commerce-order-paid.use-case.js";
import { COMMERCE_CART_PORT } from "./domain/ports/commerce-cart.port.js";
import { COMMERCE_ORDER_PORT } from "./domain/ports/commerce-order.port.js";
import { COMMERCE_CONNECTION_PORT } from "./domain/ports/commerce-connection.port.js";
import { COMMERCE_CATALOG_PORT } from "./domain/ports/commerce-catalog.port.js";
import { COMMERCE_PROVIDER_RUNTIME } from "./domain/ports/commerce-provider-runtime.port.js";
import { COMMERCE_PAID_WEBHOOK_DEDUP } from "./domain/ports/commerce-paid-webhook-dedup.port.js";
import { COMMERCE_PENDING_ORDER_INDEX } from "./domain/ports/pending-commerce-order-index.port.js";
import { PrismaPendingCommerceOrderIndex } from "./infrastructure/prisma-pending-commerce-order-index.repository.js";
import { PrismaCommercePaidWebhookDedup } from "./infrastructure/prisma-commerce-paid-webhook-dedup.repository.js";
import { PrismaCommerceConnectionRepository } from "./infrastructure/prisma-commerce-connection.repository.js";
import { TenantCommerceAdapterFactory } from "./infrastructure/tenant-commerce-adapter.factory.js";
import {
  ConnectCommerceUseCase,
  DisconnectCommerceUseCase,
  GetCommerceConnectionUseCase,
  SyncCommerceConnectionUseCase,
  TestCommerceConnectionUseCase,
} from "./application/manage-commerce-connection.use-cases.js";
import { CommerceConnectionsController } from "./presentation/http/commerce-connections.controller.js";

@Module({
  imports: [IntegrationsModule],
  controllers: [CommerceConnectionsController],
  providers: [
    TenantCommerceAdapterFactory,
    {
      provide: COMMERCE_CONNECTION_PORT,
      useFactory: (prisma: PrismaClient) => new PrismaCommerceConnectionRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_PENDING_ORDER_INDEX,
      useFactory: (prisma: PrismaClient) => new PrismaPendingCommerceOrderIndex(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_PAID_WEBHOOK_DEDUP,
      useFactory: (prisma: PrismaClient) => new PrismaCommercePaidWebhookDedup(prisma),
      inject: [PRISMA_CLIENT]
    },
    {
      provide: COMMERCE_CART_PORT,
      useExisting: TenantCommerceAdapterFactory
    },
    {
      provide: COMMERCE_ORDER_PORT,
      useExisting: TenantCommerceAdapterFactory
    },
    {
      provide: COMMERCE_CATALOG_PORT,
      useExisting: TenantCommerceAdapterFactory,
    },
    {
      provide: COMMERCE_PROVIDER_RUNTIME,
      useExisting: TenantCommerceAdapterFactory,
    },
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase,
    GetCommerceConnectionUseCase,
    ConnectCommerceUseCase,
    TestCommerceConnectionUseCase,
    SyncCommerceConnectionUseCase,
    DisconnectCommerceUseCase,
  ],
  exports: [
    ValidateCartForPaymentUseCase,
    SyncPendingOrderUseCase,
    MarkCommerceOrderPaidUseCase,
    COMMERCE_PENDING_ORDER_INDEX,
    COMMERCE_PAID_WEBHOOK_DEDUP,
    COMMERCE_CONNECTION_PORT,
    COMMERCE_CATALOG_PORT,
    COMMERCE_ORDER_PORT,
    TenantCommerceAdapterFactory,
  ]
})
export class CommerceModule {}
