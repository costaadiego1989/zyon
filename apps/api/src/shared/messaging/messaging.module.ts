import { Global, Module } from "@nestjs/common";
import { OUTBOX_REPOSITORY } from "./ports/outbox.repository.port.js";
import { InMemoryOutboxRepository } from "./infrastructure/in-memory-outbox.repository.js";

@Global()
@Module({
  providers: [
    InMemoryOutboxRepository,
    { provide: OUTBOX_REPOSITORY, useClass: InMemoryOutboxRepository }
  ],
  exports: [OUTBOX_REPOSITORY]
})
export class MessagingModule {}
