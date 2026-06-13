import { Global, Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "./ports/outbox.repository.port.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";
import { PrismaOutboxRepository } from "./infrastructure/prisma-outbox.repository.js";
import { InMemoryDomainEventBus } from "../events/in-memory-domain-event-bus.js";
import { DOMAIN_EVENT_BUS } from "../events/domain-event-bus.port.js";
import { PRISMA_CLIENT } from "../persistence/persistence.module.js";
import { OutboxDispatcher } from "./outbox-dispatcher.service.js";

function usePrismaOutbox(): boolean {
  return (
    process.env.OUTBOX_REPOSITORY === "prisma" ||
    process.env.CHECKOUT_REPOSITORY === "prisma"
  );
}

@Global()
@Module({
  providers: [
    InMemoryOutboxRepository,
    {
      provide: OUTBOX_REPOSITORY,
      useFactory: (inMemory: InMemoryOutboxRepository, prisma: PrismaClient): OutboxRepository =>
        usePrismaOutbox() ? new PrismaOutboxRepository(prisma) : inMemory,
      inject: [InMemoryOutboxRepository, PRISMA_CLIENT]
    },
    InMemoryDomainEventBus,
    { provide: DOMAIN_EVENT_BUS, useExisting: InMemoryDomainEventBus },
    OutboxDispatcher
  ],
  exports: [OUTBOX_REPOSITORY, DOMAIN_EVENT_BUS, OutboxDispatcher]
})
export class MessagingModule {}
