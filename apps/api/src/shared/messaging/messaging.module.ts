import { Global, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { OUTBOX_REPOSITORY, type LeasedOutboxRepository } from "./ports/outbox.repository.port.js";
import { PrismaOutboxRepository } from "./infrastructure/prisma-outbox.repository.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { DOMAIN_EVENT_BUS } from "../events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";
import { OutboxBullMqRelay } from "./infrastructure/outbox-bullmq-relay.service.js";

@Global()
@Module({
  providers: [
    {
      provide: OUTBOX_REPOSITORY,
      useFactory: (prisma: PrismaClient): LeasedOutboxRepository => new PrismaOutboxRepository(prisma),
      inject: [PRISMA_CLIENT]
    },
    InMemoryDomainEventBus,
    { provide: DOMAIN_EVENT_BUS, useExisting: InMemoryDomainEventBus },
    OutboxDispatcher,
    OutboxBullMqRelay,
  ],
  exports: [OUTBOX_REPOSITORY, DOMAIN_EVENT_BUS, OutboxDispatcher]
})
export class MessagingModule {}
