import { Module } from "@nestjs/common";
import { ServiceMetricsController } from "./presentation/http/service-metrics.controller.js";
import { ReadServiceMetricsUseCase } from "./application/read-service-metrics.use-case.js";
import { PrismaServiceMetricsRepository } from "./infrastructure/prisma-service-metrics.repository.js";
import { OrderFulfillmentUseCase } from "./application/order-fulfillment.use-case.js";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { DOMAIN_EVENT_BUS, type DomainEventBus } from "../../shared/events/domain-event-bus.port.js";
import { CreateManualServiceAppointmentUseCase } from "./application/create-manual-service-appointment.use-case.js";
import { TransitionServiceAppointmentUseCase } from "./application/transition-service-appointment.use-case.js";
import { CancelServiceAppointmentUseCase } from "./application/cancel-service-appointment.use-case.js";
import { RescheduleServiceAppointmentUseCase } from "./application/reschedule-service-appointment.use-case.js";
import { RecordAttendanceReceiptUseCase } from "./application/record-attendance-receipt.use-case.js";
import { TenantContextService } from "../../shared/tenant/tenant-context.service.js";
import { ServiceAppointmentHoldCleanupConsumer } from "./application/service-appointment-hold-cleanup.consumer.js";
import { ServiceAppointmentsController, ServiceAppointmentReadsController } from "./presentation/http/service-appointments.controller.js";
import { ReadServiceAppointments } from "./application/read-service-appointments.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { CheckoutModule } from "../checkout/checkout.module.js";
import { CommerceModule } from "../commerce/commerce.module.js";
import { UpdateTenantOrderTrackingUseCase } from "../integrations/application/integrations.use-cases.js";
import {
  GetCustomerUseCase,
  GetOrderUseCase,
  GetPaymentUseCase,
  ListCustomerOrdersUseCase,
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
    ServiceMetricsController,
    ServiceAppointmentsController,
    ServiceAppointmentReadsController,
    OrdersController,
    CustomersController,
    PaymentsController,
  ],
  providers: [
    { provide: ReadServiceMetricsUseCase, useFactory: (prisma: PrismaClient) =>
      new ReadServiceMetricsUseCase(prisma, new PrismaServiceMetricsRepository(prisma)),
      inject: [PRISMA_CLIENT] },
    { provide: ReadServiceAppointments, useFactory: (prisma: PrismaClient) =>
      new ReadServiceAppointments(prisma), inject: [PRISMA_CLIENT] },
    { provide: RecordAttendanceReceiptUseCase, useFactory: (prisma: PrismaClient) =>
      new RecordAttendanceReceiptUseCase(prisma), inject: [PRISMA_CLIENT] },
    { provide: RescheduleServiceAppointmentUseCase, useFactory: (prisma: PrismaClient) =>
      new RescheduleServiceAppointmentUseCase(prisma), inject: [PRISMA_CLIENT] },
    { provide: ServiceAppointmentHoldCleanupConsumer,
      useFactory: (prisma: PrismaClient, events: DomainEventBus, tenant: TenantContextService) =>
        new ServiceAppointmentHoldCleanupConsumer(prisma, events, tenant),
      inject: [PRISMA_CLIENT, DOMAIN_EVENT_BUS, TenantContextService] },
    { provide: CancelServiceAppointmentUseCase, useFactory: (prisma: PrismaClient) =>
      new CancelServiceAppointmentUseCase(prisma), inject: [PRISMA_CLIENT] },
    { provide: TransitionServiceAppointmentUseCase, useFactory: (prisma: PrismaClient) =>
      new TransitionServiceAppointmentUseCase(prisma), inject: [PRISMA_CLIENT] },
    { provide: CreateManualServiceAppointmentUseCase, useFactory: (prisma: PrismaClient, events: DomainEventBus) =>
      new CreateManualServiceAppointmentUseCase(prisma, events), inject: [PRISMA_CLIENT, DOMAIN_EVENT_BUS] },
    OrderFulfillmentUseCase,
    ListOrdersUseCase,
    GetOrderUseCase,
    ListCustomersUseCase,
    ListCustomerOrdersUseCase,
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
    ListCustomersUseCase,
    ListCustomerOrdersUseCase,
    GetCustomerUseCase,
    ListPaymentsUseCase,
    GetPaymentUseCase,
    ORDER_TRACKING_UPDATER,
  ],
})
export class OperationsModule {}
