import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { SHIPMENT_REPOSITORY } from "./domain/ports/shipment-repository.port.js";
import { TRACKING_EVENT_REPOSITORY } from "./domain/ports/tracking-event-repository.port.js";
import { PrismaShipmentRepository } from "./infrastructure/repositories/prisma-shipment.repository.js";
import { PrismaTrackingEventRepository } from "./infrastructure/repositories/prisma-tracking-event.repository.js";
import { CreateShipmentUseCase } from "./application/use-cases/create-shipment.use-case.js";
import { RecordTrackingEventUseCase } from "./application/use-cases/record-tracking-event.use-case.js";
import { CancelShipmentUseCase } from "./application/use-cases/cancel-shipment.use-case.js";
import { FulfillmentOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { TrackingWebhookController } from "./presentation/http/tracking-webhook.controller.js";

@Module({
  controllers: [TrackingWebhookController],
  providers: [
    {
      provide: SHIPMENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaShipmentRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: TRACKING_EVENT_REPOSITORY,
      useFactory: (prisma: PrismaClient) =>
        new PrismaTrackingEventRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    CreateShipmentUseCase,
    RecordTrackingEventUseCase,
    CancelShipmentUseCase,
    FulfillmentOnOrderCompletedHandler
  ],
  exports: [CreateShipmentUseCase]
})
export class FulfillmentModule {}
