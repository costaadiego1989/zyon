import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { UpdateTenantOrderTrackingUseCase } from "../integrations/application/integrations.use-cases.js";
import {
  GetCustomerUseCase,
  GetOrderUseCase,
  GetPaymentUseCase,
  ListCustomersUseCase,
  ListOrdersUseCase,
  ListPaymentsUseCase,
} from "./application/operations-read.use-cases.js";
import {
  CancelOrderUseCase,
  CreateOrderFromPaymentUseCase,
  UpdateOrderStatusUseCase,
} from "./application/order-command.use-cases.js";
import { OPERATIONS_READ_REPOSITORY } from "./domain/ports/operations-read.repository.port.js";
import { ORDER_TRACKING_UPDATER } from "./domain/ports/order-tracking.port.js";
import { PrismaOperationsReadRepository } from "./infrastructure/prisma-operations-read.repository.js";
import {
  CustomersController,
  OrdersController,
  PaymentsController,
} from "./presentation/http/operations.controller.js";

@Module({
  imports: [IntegrationsModule, CheckoutModule, CommerceModule],
  controllers: [
    OrdersController,
    CustomersController,
    PaymentsController,
  ],
  providers: [
    ListOrdersUseCase,
    GetOrderUseCase,
    ListCustomersUseCase,
    GetCustomerUseCase,
    ListPaymentsUseCase,
    GetPaymentUseCase,
    CancelOrderUseCase,
    CreateOrderFromPaymentUseCase,
    UpdateOrderStatusUseCase,
    {
      provide: OPERATIONS_READ_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaOperationsReadRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    // M4 fix: operations defines the port; integrations implements it
    {
      provide: ORDER_TRACKING_UPDATER,
      useExisting: UpdateTenantOrderTrackingUseCase,
    },
  ],
  exports: [
    ListOrdersUseCase,
    GetOrderUseCase,
    CancelOrderUseCase,
    UpdateOrderStatusUseCase,
  ],
})
export class OperationsModule {}
