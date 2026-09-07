import type { DomainEventEnvelope } from "@zyon/shared-types";
import type { CouponSnapshot } from "../entities/coupon.entity.js";
import type { CouponRedemptionEntity, CouponRedemptionSnapshot } from "../entities/coupon-redemption.entity.js";

export const COUPON_TRANSACTION_REPOSITORY = Symbol("COUPON_TRANSACTION_REPOSITORY");

export type CouponReservationResult =
  | { status: "reserved" }
  | { status: "already_applied" }
  | { status: "limit_reached"; reason: string }
  | { status: "coupon_missing" };

export interface CouponTransactionRepository {
  reserve(input: {
    coupon: CouponSnapshot;
    redemption: CouponRedemptionEntity;
    event: DomainEventEnvelope;
  }): Promise<CouponReservationResult>;

  redeem(input: {
    merchantId: string;
    sessionId: string;
    orderId: string;
    eventFor: (redemption: CouponRedemptionSnapshot) => DomainEventEnvelope;
  }): Promise<void>;
}
