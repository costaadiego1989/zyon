import { Injectable, Inject, OnModuleInit } from "@nestjs/common";
import { DOMAIN_EVENT_BUS, type DomainEventBus, type DomainEvent } from "../../../../shared/events/domain-event-bus.port.js";
import { RedeemCouponUseCase } from "../../application/use-cases/redeem-coupon.use-case.js";

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
    await this.redeemCoupon.execute({
      session_id,
      merchant_id: event.merchantId,
      order_id: external_order_id
    });
  }
}
