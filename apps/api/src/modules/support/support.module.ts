import { Module } from "@nestjs/common";
import { RealtimeCapabilityService } from "../../shared/auth/realtime-capability.js";
import type { PrismaClient } from "@prisma/client";
import { EmbedModule } from "../embed/embed.module.js";
import { IntegrationsModule } from "../integrations/integrations.module.js";
import { HttpModule } from "../../shared/http/http.module.js";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { KnowledgeBaseModule } from "../knowledge-base/knowledge-base.module.js";
import { SendSupportMessageUseCase } from "./application/send-support-message.use-case.js";
import { GetSupportSettingsUseCase } from "./application/get-support-settings.use-case.js";
import { ListSupportTicketsUseCase } from "./application/list-support-tickets.use-case.js";
import { UpdateSupportSettingsUseCase } from "./application/update-support-settings.use-case.js";
import { UpdateSupportTicketStatusUseCase } from "./application/update-support-ticket-status.use-case.js";
import { CreateSupportTicketUseCase } from "./application/create-support-ticket.use-case.js";
import { SendTicketMessageUseCase } from "./application/send-ticket-message.use-case.js";
import { ListTicketMessagesUseCase } from "./application/list-ticket-messages.use-case.js";
import { TransferTicketUseCase } from "./application/transfer-ticket.use-case.js";
import { GetTicketMarketplaceOriginUseCase } from "./application/get-ticket-marketplace-origin.use-case.js";
import { SupportTicketEventPublisher } from "./application/support-ticket-event.publisher.js";
import { SupportHandoffService } from "./application/support-handoff.service.js";
import { SUPPORT_SETTINGS_REPOSITORY } from "./domain/ports/support-settings-repository.port.js";
import { SUPPORT_TICKET_REPOSITORY } from "./domain/ports/support-ticket-repository.port.js";
import { CHAT_COMPLETION_PORT } from "./domain/ports/chat-completion.port.js";
import { PrismaSupportSettingsRepository } from "./infrastructure/prisma-support-settings.repository.js";
import { PrismaSupportTicketRepository } from "./infrastructure/prisma-support-ticket.repository.js";
import { OpenAIChatAdapter } from "./infrastructure/openai-chat.adapter.js";
import { SupportController } from "./presentation/http/support.controller.js";
import { SupportMessagesController } from "./presentation/http/support-messages.controller.js";
import { SupportGateway } from "./infrastructure/gateways/support.gateway.js";

/**
 * SUPP-H1/H2: SendSupportMessageUseCase split across cohesive files.
 * ChatCompletionPort injected for testability.
 * KnowledgeBaseModule optional: RAG support integrated via QueryKnowledgeUseCase.
 */
@Module({
  // EmbedModule provides EmbedAuthGuard used by chat/faq endpoints (P0 fix)
  imports: [EmbedModule, IntegrationsModule, HttpModule, KnowledgeBaseModule],
  controllers: [SupportController, SupportMessagesController],
  providers: [
    { provide: RealtimeCapabilityService, useFactory: () => new RealtimeCapabilityService() },
    SendSupportMessageUseCase,
    GetSupportSettingsUseCase,
    UpdateSupportSettingsUseCase,
    ListSupportTicketsUseCase,
    UpdateSupportTicketStatusUseCase,
    CreateSupportTicketUseCase,
    SendTicketMessageUseCase,
    ListTicketMessagesUseCase,
    TransferTicketUseCase,
    GetTicketMarketplaceOriginUseCase,
    SupportTicketEventPublisher,
    SupportHandoffService,
    SupportGateway,
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
    {
      provide: CHAT_COMPLETION_PORT,
      useClass: OpenAIChatAdapter,
    },
  ],
  exports: [GetSupportSettingsUseCase, ListSupportTicketsUseCase, CreateSupportTicketUseCase, SendTicketMessageUseCase, TransferTicketUseCase, GetTicketMarketplaceOriginUseCase, SupportHandoffService, SupportGateway],
})
export class SupportModule {}
