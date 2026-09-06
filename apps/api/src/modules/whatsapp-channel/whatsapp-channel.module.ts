/**
 * WhatsApp Channel Module — NestJS module registration.
 *
 * Wires: webhook controller, use cases, services, ports → adapters.
 * Supports multi-provider: BubbleWhats (legacy) and Twilio (new).
 */

import { Module } from "@nestjs/common";
import { WhatsAppWebhookController } from "./presentation/http/whatsapp-webhook.controller.js";
import { WhatsAppConfigController } from "./presentation/http/whatsapp-config.controller.js";
import { HandleIncomingMessageUseCase } from "./application/use-cases/handle-incoming-message.use-case.js";
import { HandleStatusUpdateUseCase } from "./application/use-cases/handle-status-update.use-case.js";
import { RouteToSessionUseCase } from "./application/use-cases/route-to-session.use-case.js";
import { SendWhatsAppResponseUseCase } from "./application/use-cases/send-whatsapp-response.use-case.js";
import { ConfigureWhatsAppUseCase } from "./application/use-cases/configure-whatsapp.use-case.js";
import { MessageDebouncerService } from "./application/services/message-debouncer.service.js";
import { BubbleWhatsSenderAdapter } from "./infrastructure/adapters/bubblewhats-sender.adapter.js";
import { TwilioSenderAdapter } from "./infrastructure/adapters/twilio-sender.adapter.js";
import { TwilioDeduplicatorService } from "./infrastructure/services/twilio-deduplicator.service.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_SESSION_REPOSITORY } from "./domain/ports/whatsapp-session-repository.port.js";
import { WHATSAPP_CONFIG_REPOSITORY } from "./domain/ports/whatsapp-config-repository.port.js";
import { PrismaWhatsAppSessionRepository } from "./infrastructure/repositories/prisma-whatsapp-session.repository.js";
import { PrismaWhatsAppConfigRepository } from "./infrastructure/repositories/prisma-whatsapp-config.repository.js";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { AcceptBubbleWhatsWebhookUseCase } from "./application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { WhatsAppWebhookWorker } from "./application/services/whatsapp-webhook-worker.service.js";
import { WHATSAPP_WEBHOOK_INBOX } from "./domain/ports/whatsapp-webhook-inbox.port.js";
import { PrismaWhatsAppWebhookInbox } from "./infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";

/**
 * Multi-tenant sender resolver.
 * Routes to BubbleWhats or Twilio based on merchant config provider.
 */
export class MultiProviderSenderAdapter {
  constructor(
    private readonly bubblewhats: BubbleWhatsSenderAdapter,
    private readonly twilio: TwilioSenderAdapter,
  ) {}

  async sendText(msg: any) {
    if (msg.provider === "BUBBLEWHATS") return this.bubblewhats.sendText(msg);
    // For now, try Twilio first, fallback to BubbleWhats
    // Future: lookup merchant config and choose provider
    const result = await this.twilio.sendText(msg);
    if (result.status === "sent") return result;
    return this.bubblewhats.sendText(msg);
  }

  async sendMedia(msg: any) {
    const result = await this.twilio.sendMedia?.(msg);
    if (result?.status === "sent") return result;
    return this.bubblewhats.sendMedia?.(msg);
  }
}

@Module({
  imports: [PersistenceModule],
  controllers: [WhatsAppWebhookController, WhatsAppConfigController],
  providers: [
    // Use cases
    HandleIncomingMessageUseCase,
    HandleStatusUpdateUseCase,
    RouteToSessionUseCase,
    SendWhatsAppResponseUseCase,
    ConfigureWhatsAppUseCase,
    AcceptBubbleWhatsWebhookUseCase,
    WhatsAppWebhookWorker,

    // Services
    MessageDebouncerService,
    TwilioDeduplicatorService,

    // Adapters
    BubbleWhatsSenderAdapter,
    TwilioSenderAdapter,

    // Ports → Adapters (multi-provider)
    {
      provide: WHATSAPP_SENDER_PORT,
      useFactory: (bw: BubbleWhatsSenderAdapter, tw: TwilioSenderAdapter) => {
        return new MultiProviderSenderAdapter(bw, tw);
      },
      inject: [BubbleWhatsSenderAdapter, TwilioSenderAdapter],
    },
    { provide: WHATSAPP_SESSION_REPOSITORY, useClass: PrismaWhatsAppSessionRepository },
    { provide: WHATSAPP_CONFIG_REPOSITORY, useClass: PrismaWhatsAppConfigRepository },
    { provide: WHATSAPP_WEBHOOK_INBOX, useClass: PrismaWhatsAppWebhookInbox },
  ],
  exports: [SendWhatsAppResponseUseCase],
})
export class WhatsAppChannelModule {}
