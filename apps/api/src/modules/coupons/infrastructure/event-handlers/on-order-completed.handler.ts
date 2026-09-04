import { Injectable, Inject, OnModuleInit, Logger } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";

const logger = new Logger("CouponsOnOrderCompletedHandler");

@Injectable()
export class CouponsOnOrderCompletedHandler implements OnModuleInit {
  constructor(
    @Inject(DOMAIN_EVENT_BUS) private readonly eventBus: DomainEventBus,
    private readonly redeemCoupon: RedeemCouponUseCase
  ) {}

  onModuleInit(): void {
    this.eventBus.subscribe(
      "order.completed",
      (event) => this.handle(event),
      "coupons.CouponsOnOrderCompletedHandler"
    );
  }

  private async handle(event: DomainEvent): Promise<void> {
    const payload = event.payload as Record<string, unknown>;
    const session_id = payload["session_id"] as string | undefined;
    const external_order_id = payload["external_order_id"] as string | undefined;
    if (!session_id || !external_order_id) return;

    // C2 fix: wrap redemption in try-catch; log errors with context for audit trail
    try {
      await this.redeemCoupon.execute({
        session_id,
        merchant_id: event.merchantId,
        order_id: external_order_id
      });
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const errorCode = err instanceof Error ? err.name : "UnknownError";
      logger.error(
        `Failed to redeem coupon for order: ${errorCode} — ${errorMsg}`,
        {
          session_id,
          order_id: external_order_id,
          merchant_id: event.merchantId,
          error: err instanceof Error ? err.stack : undefined
        }
      );
      // Do NOT re-throw: redemption failure should not crash the event bus.
      // The order is complete; coupon redemption is a secondary concern.
      // Human intervention may be needed to fix orphaned redemptions.
    }
  }
}
