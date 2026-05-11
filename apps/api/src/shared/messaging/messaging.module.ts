import { Global, Module } from "@nestjs/common";
import { OUTBOX_REPOSITORY } from "./ports/outbox.repository.port.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { DOMAIN_EVENT_BUS } from "../events/domain-event-bus.port.js";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";

@Global()
@Module({
  providers: [
    InMemoryOutboxRepository,
    { provide: OUTBOX_REPOSITORY, useClass: InMemoryOutboxRepository },
    InMemoryDomainEventBus,
    { provide: DOMAIN_EVENT_BUS, useExisting: InMemoryDomainEventBus },
    OutboxDispatcher
  ],
  exports: [OUTBOX_REPOSITORY, DOMAIN_EVENT_BUS, OutboxDispatcher]
})
export class MessagingModule {}
