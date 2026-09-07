import { Injectable, Inject } from "@nestjs/common";
import { COUPON_TRANSACTION_REPOSITORY, type CouponTransactionRepository } from "../../domain/ports/coupon-transaction-repository.port.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";

@Injectable()
export class RedeemCouponUseCase {
  constructor(
    @Inject(COUPON_TRANSACTION_REPOSITORY) private readonly transactions: CouponTransactionRepository
  ) {}

  async execute(input: { session_id: string; merchant_id: string; order_id: string }) {
    await this.transactions.redeem({
      merchantId: input.merchant_id,
      sessionId: input.session_id,
      orderId: input.order_id,
      eventFor: (redemption) => createCouponEventEnvelope({
        eventType: "coupon.redeemed",
        merchantId: input.merchant_id,
        payload: {
          session_id: input.session_id,
          coupon_id: redemption.coupon_id,
          order_id: input.order_id,
          discount_applied: redemption.discount_applied,
          buyer_global_user_id: redemption.buyer_global_user_id ?? ""
        }
      })
    });
  }
}
