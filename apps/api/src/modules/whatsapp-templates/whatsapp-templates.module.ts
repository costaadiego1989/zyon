import { Module } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { MessagingChannelsModule } from "../notifications/messaging-channels.module.js";
import { WhatsAppConfigModule } from "../whatsapp-channel/whatsapp-config.module.js";

import { WHATSAPP_TEMPLATE_REPOSITORY } from "./domain/ports/whatsapp-template-repository.port.js";
import { WHATSAPP_TEMPLATE_SENDER } from "./domain/ports/whatsapp-template-sender.port.js";
import { TEMPLATE_SUBMISSION_PORT } from "./domain/ports/template-submission.port.js";

import { PrismaWhatsAppTemplateRepository } from "./infrastructure/repositories/prisma-whatsapp-template.repository.js";
import { WhatsAppTemplateSenderAdapter } from "./infrastructure/adapters/whatsapp-template-sender.adapter.js";
import { TwilioContentTemplateAdapter } from "./infrastructure/adapters/twilio-content-template.adapter.js";

import { SendWhatsAppMessageUseCase } from "./application/use-cases/send-whatsapp-message.use-case.js";
import { SubmitTemplatePackageUseCase } from "./application/use-cases/submit-template-package.use-case.js";
import { SyncTemplateStatusesUseCase } from "./application/use-cases/sync-template-statuses.use-case.js";
import { RecoveryTemplateLifecycleUseCase } from "./application/use-cases/recovery-template-lifecycle.use-case.js";
import { PrismaRecoveryTemplateLifecycleRepository } from "./infrastructure/repositories/prisma-recovery-template-lifecycle.repository.js";
import { RecoveryTemplateMonitorJob } from "./infrastructure/recovery-template-monitor.job.js";
import { RecoveryTemplateNoticeWorker } from "./infrastructure/recovery-template-notice.worker.js";
import { RECOVERY_TEMPLATE_INITIALIZER, RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY } from "./domain/ports/recovery-template-lifecycle.port.js";

/**
 * Shared WhatsApp templates module: central catalog, Meta submission (Twilio
 * Content), approval-status sync, and the single safe send path. Consumed by
 * post-sale, cart-recovery and notifications.
 *
 * Depends ONLY on two dependency-free base modules — no cycle, no forwardRef:
 *   MessagingChannelsModule → email + legacy WhatsApp fallback ports
 *   WhatsAppConfigModule    → current merchant connection and Twilio/WABA credentials
 * Recovery routing and the sender both inject this repository; the sender also
 * re-reads the template repository before dispatch. Neither uses env as recovery authority.
 */
@Module({
  imports: [MessagingChannelsModule, WhatsAppConfigModule],
  providers: [
    {
      provide: WHATSAPP_TEMPLATE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaWhatsAppTemplateRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    { provide: WHATSAPP_TEMPLATE_SENDER, useClass: WhatsAppTemplateSenderAdapter },
    { provide: TEMPLATE_SUBMISSION_PORT, useClass: TwilioContentTemplateAdapter },
    SendWhatsAppMessageUseCase,
    SubmitTemplatePackageUseCase,
    SyncTemplateStatusesUseCase,
    { provide: RECOVERY_TEMPLATE_LIFECYCLE_REPOSITORY, useClass: PrismaRecoveryTemplateLifecycleRepository },
    RecoveryTemplateLifecycleUseCase,
    { provide: RECOVERY_TEMPLATE_INITIALIZER, useExisting: RecoveryTemplateLifecycleUseCase },
    RecoveryTemplateMonitorJob,
    RecoveryTemplateNoticeWorker,
  ],
  exports: [
    WHATSAPP_TEMPLATE_REPOSITORY,
    WHATSAPP_TEMPLATE_SENDER,
    TEMPLATE_SUBMISSION_PORT,
    SendWhatsAppMessageUseCase,
    SubmitTemplatePackageUseCase,
    SyncTemplateStatusesUseCase,
    RecoveryTemplateLifecycleUseCase,
    RECOVERY_TEMPLATE_INITIALIZER,
  ],
})
export class WhatsAppTemplatesModule {}
