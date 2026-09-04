import { Injectable, Inject, NotFoundException , Logger} from "@nestjs/common";
import { COUPON_REPOSITORY, type CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import { COUPON_REDEMPTION_REPOSITORY, type CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import { OUTBOX_REPOSITORY, type OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { CorrelationIdStorage } from "../../../../shared/logger/correlation-id.storage.js";

@Injectable()
export class RedeemCouponUseCase {
  private readonly logger = new Logger(RedeemCouponUseCase.name);

  constructor(
    @Inject(COUPON_REPOSITORY) private readonly coupons: CouponRepository,
    @Inject(COUPON_REDEMPTION_REPOSITORY) private readonly redemptions: CouponRedemptionRepository,
    @Inject(OUTBOX_REPOSITORY) private readonly outbox: OutboxRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; order_id: string }) {
    const pending = await this.redemptions.findBySession(input.session_id, input.merchant_id);
    const applied = pending.filter((r) => r.status === "applied");

    for (const redemption of applied) {
      const redeemed = redemption.redeem(input.order_id);
      await this.redemptions.save(redeemed);

      const coupon = await this.coupons.findById(redeemed.coupon_id, input.merchant_id);
      if (coupon) {
        await this.coupons.save(coupon.incrementUsage());
      }

      const snap = redeemed.snapshot();
      await this.outbox.appendOutbox(
        createCouponEventEnvelope({
          eventType: "coupon.redeemed",
          merchantId: input.merchant_id,
          payload: {
            session_id: input.session_id,
            coupon_id: snap.coupon_id,
            order_id: input.order_id,
            discount_applied: snap.discount_applied,
            buyer_global_user_id: snap.buyer_global_user_id ?? ""
          }
        })
      );
    }
  }
}
