import type { CouponTransactionRepository, CouponReservationResult } from "../../domain/ports/coupon-transaction-repository.port.js";
import { checkCouponLimits } from "../../domain/policies/coupon-limit.policy.js";
import type { CouponRepository } from "../../domain/ports/coupon-repository.port.js";
import type { CouponRedemptionRepository } from "../../domain/ports/coupon-redemption-repository.port.js";
import type { OutboxRepository } from "../../../../shared/messaging/ports/outbox.repository.port.js";

export class InMemoryCouponTransactionRepository implements CouponTransactionRepository {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly coupons: CouponRepository,
    private readonly redemptions: CouponRedemptionRepository,
    private readonly outbox: OutboxRepository
  ) {}

  async reserve(input: Parameters<CouponTransactionRepository["reserve"]>[0]): Promise<CouponReservationResult> {
    return this.exclusive(async () => {
      const existing = await this.redemptions.findBySession(input.redemption.session_id, input.redemption.merchant_id);
      if (existing.some((redemption) => redemption.coupon_id === input.redemption.coupon_id)) {
        return { status: "already_applied" };
      }
      const globalCount = await this.redemptions.countByCoupon(input.coupon.id);
      const buyerId = input.redemption.snapshot().buyer_global_user_id;
      const buyerCount = buyerId ? await this.redemptions.countByBuyer(input.coupon.id, buyerId) : 0;
      const limitCheck = checkCouponLimits(input.coupon, globalCount, buyerCount);
      if (!limitCheck.allowed) return { status: "limit_reached", reason: limitCheck.reason ?? "COUPON_EXHAUSTED" };

      await this.redemptions.save(input.redemption);
      await this.outbox.appendOutbox(input.event);
      return { status: "reserved" };
    });
  }

  async redeem(input: Parameters<CouponTransactionRepository["redeem"]>[0]): Promise<void> {
    await this.exclusive(async () => {
      const applied = (await this.redemptions.findBySession(input.sessionId, input.merchantId))
        .filter((redemption) => redemption.status === "applied");
      for (const redemption of applied) {
        const redeemed = redemption.redeem(input.orderId);
        const coupon = await this.coupons.findById(redeemed.coupon_id, input.merchantId);
        if (!coupon) continue;
        await this.redemptions.save(redeemed);
        await this.coupons.save(coupon.incrementUsage());
        await this.outbox.appendOutbox(input.eventFor(redeemed.snapshot()));
      }
    });
  }

  private async exclusive<T>(work: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await work();
    } finally {
      release();
    }
  }
}
