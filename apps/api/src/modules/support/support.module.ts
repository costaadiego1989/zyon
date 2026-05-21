import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module.js";
import { HttpModule } from "../../shared/http/http.module.js";
import { createPrismaClient } from "../../shared/persistence/prisma-client.js";
import { SendSupportMessageUseCase } from "./application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "./application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "./application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "./application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "./application/update-support-ticket-status.use-case.js";
import { SUPPORT_SETTINGS_REPOSITORY } from "./domain/ports/support-settings-repository.port.js";
import { SUPPORT_TICKET_REPOSITORY } from "./domain/ports/support-ticket-repository.port.js";
import { InMemorySupportSettingsRepository } from "./infrastructure/in-memory-support-settings.repository.js";
import { InMemorySupportTicketRepository } from "./infrastructure/in-memory-support-ticket.repository.js";
import { PrismaSupportSettingsRepository } from "./infrastructure/prisma-support-settings.repository.js";
import { PrismaSupportTicketRepository } from "./infrastructure/prisma-support-ticket.repository.js";
import { SupportController } from "./presentation/http/support.controller.js";

@Module({
  imports: [AuthModule, HttpModule],
  controllers: [SupportController],
  providers: [
    SendSupportMessageUseCase,
    GetSupportSettingsUseCase,
    UpdateSupportSettingsUseCase,
    ListSupportTicketsUseCase,
    UpdateSupportTicketStatusUseCase,
    InMemorySupportSettingsRepository,
    InMemorySupportTicketRepository,
    {
      provide: SUPPORT_SETTINGS_REPOSITORY,
      useFactory: (inMemory: InMemorySupportSettingsRepository) => {
        if (
          process.env.SUPPORT_SETTINGS_REPOSITORY === "prisma" ||
          process.env.CHECKOUT_REPOSITORY === "prisma"
        ) {
          return new PrismaSupportSettingsRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemorySupportSettingsRepository],
    },
    {
      provide: SUPPORT_TICKET_REPOSITORY,
      useFactory: (inMemory: InMemorySupportTicketRepository) => {
        if (
          process.env.SUPPORT_TICKET_REPOSITORY === "prisma" ||
          process.env.CHECKOUT_REPOSITORY === "prisma"
        ) {
          return new PrismaSupportTicketRepository(createPrismaClient());
        }
        return inMemory;
      },
      inject: [InMemorySupportTicketRepository],
    },
  ],
  exports: [GetSupportSettingsUseCase, ListSupportTicketsUseCase],
})
export class SupportModule {}
