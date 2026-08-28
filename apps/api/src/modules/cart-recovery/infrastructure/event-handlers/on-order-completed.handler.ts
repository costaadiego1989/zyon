import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEvent, type DomainEventBus } from "../../../../shared/events/domain-event-bus.port.js";
import { TRACK_RECOVERY_OUTCOME_USE_CASE } from "../../cart-recovery.module.js";
import type { TrackRecoveryOutcomeUseCase } from "../../application/use-cases/track-recovery-outcome.use-case.js";

const logger = new Logger("CartRecoveryOnOrderCompletedHandler");

/**
 * Listens to `order.completed` and marks a matching recovery attempt as
 * "recovered" when the buyer converts within the attribution window.
 * This feeds the dashboard recovery metrics (recovered count, recovery rate,
 * revenue recovered). Without it, attempts stay "sent" forever and the
 * dashboard shows 0 conversions.
 */
@Injectable()
export class CartRecoveryOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    @Inject(TRACK_RECOVERY_OUTCOME_USE_CASE) private readonly trackOutcome: TrackRecoveryOutcomeUseCase,
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "cart-recovery.CartRecoveryOnOrderCompletedHandler",
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const merchantId = event.merchantId;
    const sessionId = payload["session_id"] as string | undefined;
    const orderId = (payload["external_order_id"] ?? payload["order_id"]) as string | undefined;

    if (!merchantId || !sessionId) {
      return; // not enough to attribute
    }

    try {
      const result = await this.trackOutcome.execute({ merchantId, sessionId, orderId });
      if (result.status === "recovered") {
        logger.log("recovery attributed", { merchantId, sessionId, attemptId: result.attemptId });
      }
    } catch (err) {
      logger.warn("failed to track recovery outcome", { merchantId, sessionId, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
