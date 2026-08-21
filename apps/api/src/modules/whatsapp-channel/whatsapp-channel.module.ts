/**
 * WhatsApp Channel Module — NestJS module registration.
 *
 * Wires: webhook controller, use cases, services, ports → adapters.
 */

import { Module } from "@nestjs/common";
import { WhatsAppWebhookController } from "./presentation/http/whatsapp-webhook.controller.js";
import { HandleIncomingMessageUseCase } from "./application/use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase } from "./application/use-cases/handle-status-update.use-case.js";
import { RouteToSessionUseCase } from "./application/use-cases/route-to-session.use-case.js";
import { SendWhatsAppResponseUseCase } from "./application/use-cases/send-whatsapp-response.use-case.js";
import { MessageDebouncerService } from "./application/services/message-debouncer.service.js";
import { BubbleWhatsSenderAdapter } from "./infrastructure/adapters/bubblewhats-sender.adapter.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_SESSION_REPOSITORY } from "./domain/ports/whatsapp-session-repository.port.js";
import { WHATSAPP_CONFIG_REPOSITORY } from "./domain/ports/whatsapp-config-repository.port.js";
import { PrismaWhatsAppSessionRepository } from "./infrastructure/repositories/prisma-whatsapp-session.repository.js";
import { PrismaWhatsAppConfigRepository } from "./infrastructure/repositories/prisma-whatsapp-config.repository.js";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsAppWebhookController],
  providers: [
    // Use cases
    HandleIncomingMessageUseCase,
    HandleStatusUpdateUseCase,
    RouteToSessionUseCase,
    SendWhatsAppResponseUseCase,

    // Services
    MessageDebouncerService,

    // Ports → Adapters
    { provide: WHATSAPP_SENDER_PORT, useClass: BubbleWhatsSenderAdapter },
    { provide: WHATSAPP_SESSION_REPOSITORY, useClass: PrismaWhatsAppSessionRepository },
    { provide: WHATSAPP_CONFIG_REPOSITORY, useClass: PrismaWhatsAppConfigRepository },
  ],
  exports: [SendWhatsAppResponseUseCase],
})
export class WhatsAppChannelModule {}
