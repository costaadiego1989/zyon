import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { EmbedModule } from "../embed/embed.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { HttpModule } from "../../shared/http/http.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { SendSupportMessageUseCase } from "./application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "./application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "./application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "./application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "./application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "./application/create-support-ticket.use-case.js";
import { SUPPORT_SETTINGS_REPOSITORY } from "./domain/ports/support-settings-repository.port.js";
import { SUPPORT_TICKET_REPOSITORY } from "./domain/ports/support-ticket-repository.port.js";
import { PrismaSupportSettingsRepository } from "./infrastructure/prisma-support-settings.repository.js";
import { PrismaSupportTicketRepository } from "./infrastructure/prisma-support-ticket.repository.js";
import { SupportController } from "./presentation/http/support.controller.js";

@Module({
  // EmbedModule provides EmbedAuthGuard used by chat/faq endpoints (P0 fix)
  imports: [EmbedModule, IntegrationsModule, HttpModule],
  controllers: [SupportController],
  providers: [
    SendSupportMessageUseCase,
    GetSupportSettingsUseCase,
    UpdateSupportSettingsUseCase,
    ListSupportTicketsUseCase,
    UpdateSupportTicketStatusUseCase,
    CreateSupportTicketUseCase,
    {
      provide: SUPPORT_SETTINGS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaSupportSettingsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: SUPPORT_TICKET_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaSupportTicketRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
  ],
  exports: [GetSupportSettingsUseCase, ListSupportTicketsUseCase],
})
export class SupportModule {}
