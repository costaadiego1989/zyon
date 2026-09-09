import { Module, forwardRef } from "@nestjs/common";
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
import { MetaCloudSenderAdapter } from "./infrastructure/adapters/meta-cloud-sender.adapter.js";
import { TwilioDeduplicatorService } from "./infrastructure/services/twilio-deduplicator.service.js";
import { WHATSAPP_SENDER_PORT } from "./domain/ports/whatsapp-sender.port.js";
import { WHATSAPP_SESSION_REPOSITORY, type WhatsAppSessionRepository } from "./domain/ports/whatsapp-session-repository.port.js";
import { WHATSAPP_POST_SALE_CONTEXT_PORT } from "./domain/ports/whatsapp-post-sale-context.port.js";
import { WhatsAppPostSaleContextAdapter } from "./infrastructure/adapters/whatsapp-post-sale-context.adapter.js";
import { PrismaWhatsAppSessionRepository } from "./infrastructure/repositories/prisma-whatsapp-session.repository.js";
import { PersistenceModule } from "../../shared/persistence/persistence.module.js";
import { PostSaleModule } from "../post-sale/post-sale.module.js";
import { WhatsAppConfigModule } from "./whatsapp-config.module.js";
import { WhatsAppTemplatesModule } from "../whatsapp-templates/whatsapp-templates.module.js";
import { SubmitTemplatePackageUseCase } from "../whatsapp-templates/application/use-cases/submit-template-package.use-case.js";
import { TEMPLATE_PACKAGE_SUBMITTER } from "./domain/ports/template-package-submitter.port.js";
import { AcceptBubbleWhatsWebhookUseCase } from "./application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { WhatsAppWebhookWorker } from "./application/services/whatsapp-webhook-worker.service.js";
import { WHATSAPP_WEBHOOK_INBOX } from "./domain/ports/whatsapp-webhook-inbox.port.js";
import { PrismaWhatsAppWebhookInbox } from "./infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";
import { TWILIO_ONBOARDING, WHATSAPP_ONBOARDING_STORE } from "./domain/ports/whatsapp-onboarding.port.js";
import { TwilioOnboardingAdapter } from "./infrastructure/adapters/twilio-onboarding.adapter.js";
import { PrismaWhatsAppOnboardingStore } from "./infrastructure/repositories/prisma-whatsapp-onboarding.repository.js";
import { WHATSAPP_SIGNUP_AUTHORIZATION } from "./domain/ports/whatsapp-signup-authorization.port.js";
import { MetaSignupAuthorizationAdapter } from "./infrastructure/adapters/meta-signup-authorization.adapter.js";

/**
 * Multi-tenant sender resolver.
 * Routes legacy BubbleWhats, legacy Twilio, or the official Meta Cloud API.
 */
export class MultiProviderSenderAdapter {
  constructor(
    private readonly bubblewhats: BubbleWhatsSenderAdapter,
    private readonly twilio: TwilioSenderAdapter,
    private readonly metaCloud: MetaCloudSenderAdapter,
  ) {}

  async sendText(msg: any) {
    if (msg.provider === "BUBBLEWHATS") return this.bubblewhats.sendText(msg);
    if (msg.provider === "META_CLOUD") return this.metaCloud.sendText(msg);
    return this.twilio.sendText(msg);
  }

  async sendMedia(msg: any) {
    if (msg.provider === "BUBBLEWHATS") return this.bubblewhats.sendMedia(msg);
    if (msg.provider === "META_CLOUD") return this.metaCloud.sendMedia(msg);
    return this.twilio.sendMedia(msg);
  }
}

@Module({
  imports: [PersistenceModule, WhatsAppConfigModule, WhatsAppTemplatesModule, forwardRef(() => PostSaleModule)],
  controllers: [WhatsAppWebhookController, WhatsAppConfigController],
  providers: [
    HandleIncomingMessageUseCase,
    HandleStatusUpdateUseCase,
    RouteToSessionUseCase,
    SendWhatsAppResponseUseCase,
    ConfigureWhatsAppUseCase,
    { provide: TWILIO_ONBOARDING, useClass: TwilioOnboardingAdapter },
    { provide: WHATSAPP_ONBOARDING_STORE, useClass: PrismaWhatsAppOnboardingStore },
    { provide: WHATSAPP_SIGNUP_AUTHORIZATION, useClass: MetaSignupAuthorizationAdapter },
    AcceptBubbleWhatsWebhookUseCase,
    WhatsAppWebhookWorker,

    // Services
    MessageDebouncerService,
    TwilioDeduplicatorService,
    BubbleWhatsSenderAdapter,
    TwilioSenderAdapter,
    MetaCloudSenderAdapter,
    {
      provide: WHATSAPP_SENDER_PORT,
      useFactory: (bw: BubbleWhatsSenderAdapter, tw: TwilioSenderAdapter, meta: MetaCloudSenderAdapter) => {
        return new MultiProviderSenderAdapter(bw, tw, meta);
      },
      inject: [BubbleWhatsSenderAdapter, TwilioSenderAdapter, MetaCloudSenderAdapter],
    },
    { provide: WHATSAPP_SESSION_REPOSITORY, useClass: PrismaWhatsAppSessionRepository },
    { provide: TEMPLATE_PACKAGE_SUBMITTER, useExisting: SubmitTemplatePackageUseCase },
    {
      provide: WHATSAPP_POST_SALE_CONTEXT_PORT,
      useFactory: (repo: WhatsAppSessionRepository) => new WhatsAppPostSaleContextAdapter(repo),
      inject: [WHATSAPP_SESSION_REPOSITORY],
    },
    { provide: WHATSAPP_WEBHOOK_INBOX, useClass: PrismaWhatsAppWebhookInbox },
  ],
  exports: [SendWhatsAppResponseUseCase, WHATSAPP_POST_SALE_CONTEXT_PORT, WhatsAppConfigModule],
})
export class WhatsAppChannelModule {}
