import { Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { BillingPlanMeteringService, PlanLimitGuard } from "../payment/domain/billing-plan-guard.js";
import { DOMAIN_EVENT_BUS } from "../../shared/events/domain-event-bus.port.js";
import { NotificationsModule } from "../notifications/notifications.module.js";
import { WhatsAppChannelModule } from "../whatsapp-channel/whatsapp-channel.module.js";

// Ports
import {
  SCHEDULED_MESSAGE_REPOSITORY,
} from "./domain/ports/scheduled-message-repository.port.js";
import {
  REVIEW_REPOSITORY,
} from "./domain/ports/review-repository.port.js";
import {
  NPS_REPOSITORY,
} from "./domain/ports/nps-repository.port.js";
import {
  LOYALTY_TRACKER_REPOSITORY,
} from "./domain/ports/loyalty-tracker-repository.port.js";
import {
  POST_SALE_TEMPLATE_REPOSITORY,
} from "./domain/ports/post-sale-template-repository.port.js";
import {
  POST_SALE_REPLY_HANDLER_PORT,
} from "./domain/ports/post-sale-reply-handler.port.js";

// Repositories
import { PrismaScheduledMessageRepository } from "./infrastructure/repositories/prisma-scheduled-message.repository.js";
import { PrismaReviewRepository } from "./infrastructure/repositories/prisma-review.repository.js";
import { PrismaNpsRepository } from "./infrastructure/repositories/prisma-nps.repository.js";
import { PrismaLoyaltyTrackerRepository } from "./infrastructure/repositories/prisma-loyalty-tracker.repository.js";
import { PrismaPostSaleTemplateRepository } from "./infrastructure/repositories/prisma-post-sale-template.repository.js";

// Adapters
import { PostSaleReplyHandlerAdapter } from "./infrastructure/adapters/post-sale-reply-handler.adapter.js";

// Use Cases
import { SchedulePostDeliveryFlowUseCase } from "./application/use-cases/schedule-post-delivery-flow.use-case.js";
import { ProcessScheduledMessagesUseCase } from "./application/use-cases/process-scheduled-messages.use-case.js";
import { SubmitReviewUseCase } from "./application/use-cases/submit-review.use-case.js";
import { SubmitNpsUseCase } from "./application/use-cases/submit-nps.use-case.js";
import { GetPostSaleDashboardUseCase } from "./application/use-cases/get-post-sale-dashboard.use-case.js";
import { ScanInactiveBuyersUseCase } from "./application/use-cases/scan-inactive-buyers.use-case.js";
import { CheckLoyaltyMilestoneUseCase } from "./application/use-cases/check-loyalty-milestone.use-case.js";
import { ScanConsumableReordersUseCase } from "./application/use-cases/scan-consumable-reorders.use-case.js";
import { GeneratePostSaleTemplateUseCase } from "./application/use-cases/generate-post-sale-template.use-case.js";

// Services
import { PostSaleAiCopywriterService } from "./application/services/post-sale-ai-copywriter.service.js";

// Jobs (BullMQ queues + workers; setInterval fallback when REDIS_URL absent)
import { PostSaleMessageScheduler, PostSaleMessageWorker } from "./infrastructure/jobs/post-sale-message.queue.js";
import {
  WinBackScheduler,
  WinBackWorker,
  ConsumableReorderScheduler,
  ConsumableReorderWorker,
} from "./infrastructure/jobs/post-sale-scanners.queue.js";

// Event Handlers
import { OnOrderDeliveredHandler } from "./infrastructure/event-handlers/on-order-delivered.handler.js";
import { OnOrderCompletedHandler } from "./infrastructure/event-handlers/on-order-completed.handler.js";

// Controllers
import { BuyerPostSaleController } from "./presentation/http/buyer-post-sale.controller.js";
import { PostSaleDashboardController } from "./presentation/http/post-sale-dashboard.controller.js";

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
    forwardRef(() => WhatsAppChannelModule),
  ],
  controllers: [BuyerPostSaleController, PostSaleDashboardController],
  providers: [
    BillingPlanMeteringService,
    PlanLimitGuard,
    {
      provide: SCHEDULED_MESSAGE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaScheduledMessageRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: REVIEW_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaReviewRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: NPS_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaNpsRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: LOYALTY_TRACKER_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaLoyaltyTrackerRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: POST_SALE_TEMPLATE_REPOSITORY,
      useFactory: (prisma: PrismaClient) => new PrismaPostSaleTemplateRepository(prisma),
      inject: [PRISMA_CLIENT],
    },
    {
      provide: POST_SALE_REPLY_HANDLER_PORT,
      useFactory: (nps: SubmitNpsUseCase, review: SubmitReviewUseCase, prisma: PrismaClient) =>
        new PostSaleReplyHandlerAdapter(nps, review, prisma),
      inject: [SubmitNpsUseCase, SubmitReviewUseCase, PRISMA_CLIENT],
    },
    PostSaleAiCopywriterService,
    SchedulePostDeliveryFlowUseCase,
    ProcessScheduledMessagesUseCase,
    SubmitReviewUseCase,
    SubmitNpsUseCase,
    GetPostSaleDashboardUseCase,
    ScanInactiveBuyersUseCase,
    CheckLoyaltyMilestoneUseCase,
    ScanConsumableReordersUseCase,
    GeneratePostSaleTemplateUseCase,
    PostSaleMessageScheduler,
    PostSaleMessageWorker,
    WinBackScheduler,
    WinBackWorker,
    ConsumableReorderScheduler,
    ConsumableReorderWorker,
    OnOrderDeliveredHandler,
    OnOrderCompletedHandler,
  ],
  exports: [
    SCHEDULED_MESSAGE_REPOSITORY,
    REVIEW_REPOSITORY,
    NPS_REPOSITORY,
    LOYALTY_TRACKER_REPOSITORY,
    POST_SALE_TEMPLATE_REPOSITORY,
    POST_SALE_REPLY_HANDLER_PORT,
    SchedulePostDeliveryFlowUseCase,
  ],
})
export class PostSaleModule {}
