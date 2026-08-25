import { Module, forwardRef } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../shared/persistence/persistence.module.js";
import { DOMAIN_EVENT_BUS } from "../../shared/events/domain-event-bus.port.js";
import { NotificationsModule } from "../notifications/notifications.module.js";

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

// Repositories
import { PrismaScheduledMessageRepository } from "./infrastructure/repositories/prisma-scheduled-message.repository.js";
import { PrismaReviewRepository } from "./infrastructure/repositories/prisma-review.repository.js";
import { PrismaNpsRepository } from "./infrastructure/repositories/prisma-nps.repository.js";
import { PrismaLoyaltyTrackerRepository } from "./infrastructure/repositories/prisma-loyalty-tracker.repository.js";

// Use Cases
import { SchedulePostDeliveryFlowUseCase } from "./application/use-cases/schedule-post-delivery-flow.use-case.js";
import { ProcessScheduledMessagesUseCase } from "./application/use-cases/process-scheduled-messages.use-case.js";
import { SubmitReviewUseCase } from "./application/use-cases/submit-review.use-case.js";
import { SubmitNpsUseCase } from "./application/use-cases/submit-nps.use-case.js";
import { GetPostSaleDashboardUseCase } from "./application/use-cases/get-post-sale-dashboard.use-case.js";

// Services
import { PostSaleAiCopywriterService } from "./application/services/post-sale-ai-copywriter.service.js";

// Jobs
import { PostSaleMessageSenderJob } from "./infrastructure/jobs/post-sale-message-sender.job.js";

// Event Handlers
import { OnOrderDeliveredHandler } from "./infrastructure/event-handlers/on-order-delivered.handler.js";

// Controllers
import { BuyerPostSaleController } from "./presentation/http/buyer-post-sale.controller.js";
import { PostSaleDashboardController } from "./presentation/http/post-sale-dashboard.controller.js";

@Module({
  imports: [
    forwardRef(() => NotificationsModule),
  ],
  controllers: [BuyerPostSaleController, PostSaleDashboardController],
  providers: [
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
    PostSaleAiCopywriterService,
    SchedulePostDeliveryFlowUseCase,
    ProcessScheduledMessagesUseCase,
    SubmitReviewUseCase,
    SubmitNpsUseCase,
    GetPostSaleDashboardUseCase,
    PostSaleMessageSenderJob,
    OnOrderDeliveredHandler,
  ],
  exports: [
    SCHEDULED_MESSAGE_REPOSITORY,
    REVIEW_REPOSITORY,
    NPS_REPOSITORY,
    LOYALTY_TRACKER_REPOSITORY,
    SchedulePostDeliveryFlowUseCase,
  ],
})
export class PostSaleModule {}
