import { Module } from "@nestjs/common";
import { SHIPMENT_REPOSITORY } from "./domain/ports/shipment-repository.port.js";
import { TRACKING_EVENT_REPOSITORY } from "./domain/ports/tracking-event-repository.port.js";
import { InMemoryShipmentRepository } from "./infrastructure/repositories/in-memory-shipment.repository.js";
import { InMemoryTrackingEventRepository } from "./infrastructure/repositories/in-memory-tracking-event.repository.js";
import { CreateShipmentUseCase } from "./application/use-cases/create-shipment.use-case.js";
import { RecordTrackingEventUseCase } from "./application/use-cases/record-tracking-event.use-case.js";
import { CancelShipmentUseCase } from "./application/use-cases/cancel-shipment.use-case.js";
import { FulfillmentOnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";
import { TrackingWebhookController } from "./presentation/http/tracking-webhook.controller.js";

@Module({
  controllers: [TrackingWebhookController],
  providers: [
    InMemoryShipmentRepository,
    InMemoryTrackingEventRepository,
    { provide: SHIPMENT_REPOSITORY, useExisting: InMemoryShipmentRepository },
    { provide: TRACKING_EVENT_REPOSITORY, useExisting: InMemoryTrackingEventRepository },
    CreateShipmentUseCase,
    RecordTrackingEventUseCase,
    CancelShipmentUseCase,
    FulfillmentOnOrderCompletedHandler
  ],
  exports: [CreateShipmentUseCase]
})
export class FulfillmentModule {}
