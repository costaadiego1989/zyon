import { Injectable, Inject, Logger, OnModuleInit } from "@nestjs/common";
import {
  DOMAIN_EVENT_BUS,
  type DomainEventBus,
  type DomainEvent,
} from "../../../../shared/events/domain-event-bus.port.js";
import {
  LOYALTY_TRACKER_REPOSITORY,
  type LoyaltyTrackerRepositoryPort,
} from "../../domain/ports/loyalty-tracker-repository.port.js";
import { CheckLoyaltyMilestoneUseCase } from "../../application/use-cases/check-loyalty-milestone.use-case.js";

@Injectable()
export class OnOrderCompletedHandler implements OnModuleInit {
  private readonly logger = new Logger(OnOrderCompletedHandler.name);

  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(LOYALTY_TRACKER_REPOSITORY)
    private readonly trackers: LoyaltyTrackerRepositoryPort,
    private readonly checkMilestone: CheckLoyaltyMilestoneUseCase
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "post-sale:order.completed:loyalty"
    );
    this.logger.log("Subscribed to order.completed for loyalty tracking");
  }

  private async handle(event: DomainEvent): Promise<void> {
    try {
      const payload = event.payload as Record<string, unknown>;
      const sessionId = payload["session_id"] as string | undefined;
      const orderTotal = payload["order_total"] as number | undefined;
      if (!sessionId) return;

      // Use session_id as buyer proxy; if buyer global ID is available use that
      const buyerId = (payload["buyer_global_user_id"] as string) || sessionId;
      const amountCents = Math.round((orderTotal ?? 0) * 100);

      // Upsert loyalty tracker
      const tracker = await this.trackers.incrementPurchase(
        event.merchantId,
        buyerId,
        amountCents
      );

      // Check loyalty milestones
      await this.checkMilestone.execute({
        merchantId: event.merchantId,
        buyerId,
        purchaseCount: tracker.purchaseCount,
      });
    } catch (err) {
      this.logger.error("Failed to handle order.completed for loyalty", {
        merchantId: event.merchantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}
