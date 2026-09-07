import { Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { checkCouponLimits } from "../../domain/policies/coupon-limit.policy.js";
import type {
  CouponReservationResult,
  CouponTransactionRepository
} from "../../domain/ports/coupon-transaction-repository.port.js";
import { toRedemptionCreateInput } from "./prisma-coupon.converters.js";
import { appendOutboxInTransaction } from "../../../../shared/messaging/infrastructure/append-outbox-in-transaction.js";

type LockedCouponLimits = {
  maxUsages: number | null;
  maxPerBuyer: number | null;
};

@Injectable()
export class PrismaCouponTransactionRepository implements CouponTransactionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async reserve(input: Parameters<CouponTransactionRepository["reserve"]>[0]): Promise<CouponReservationResult> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedCouponLimits[]>`
        SELECT "max_usages" AS "maxUsages", "max_per_buyer" AS "maxPerBuyer"
        FROM "coupons"
        WHERE "id" = ${input.coupon.id} AND "merchant_id" = ${input.coupon.merchant_id}
        FOR UPDATE
      `;
      const limits = locked[0];
      if (!limits) return { status: "coupon_missing" };

      const existing = await tx.couponRedemption.findUnique({
        where: {
          merchantId_sessionId_couponId: {
            merchantId: input.redemption.merchant_id,
            sessionId: input.redemption.session_id,
            couponId: input.redemption.coupon_id
          }
        },
        select: { id: true }
      });
      if (existing) return { status: "already_applied" };

      const globalCount = await tx.couponRedemption.count({
        where: { couponId: input.coupon.id, status: { not: "cancelled" } }
      });
      const buyerId = input.redemption.snapshot().buyer_global_user_id;
      const buyerCount = buyerId
        ? await tx.couponRedemption.count({
            where: { couponId: input.coupon.id, buyerGlobalUserId: buyerId, status: { not: "cancelled" } }
          })
        : 0;
      const limitCheck = checkCouponLimits(
        { ...input.coupon, max_usages: limits.maxUsages, max_per_buyer: limits.maxPerBuyer },
        globalCount,
        buyerCount
      );
      if (!limitCheck.allowed) return { status: "limit_reached", reason: limitCheck.reason ?? "COUPON_EXHAUSTED" };

      await tx.couponRedemption.create({ data: toRedemptionCreateInput(input.redemption) });
      await appendOutboxInTransaction(tx, input.event);
      return { status: "reserved" };
    });
  }

  async redeem(input: Parameters<CouponTransactionRepository["redeem"]>[0]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const applied = await tx.couponRedemption.findMany({
        where: { merchantId: input.merchantId, sessionId: input.sessionId, status: "applied" }
      });

      for (const redemption of applied) {
        const updated = await tx.couponRedemption.updateMany({
          where: { id: redemption.id, status: "applied" },
          data: { status: "redeemed", orderId: input.orderId }
        });
        if (updated.count === 0) continue;

        await tx.coupon.update({
          where: { id: redemption.couponId },
          data: { usagesCount: { increment: 1 } }
        });
        await appendOutboxInTransaction(tx, input.eventFor({
          id: redemption.id,
          coupon_id: redemption.couponId,
          merchant_id: redemption.merchantId,
          session_id: redemption.sessionId,
          buyer_global_user_id: redemption.buyerGlobalUserId,
          discount_applied: Number(redemption.discountApplied),
          source: redemption.source as "manual" | "auto",
          status: "redeemed",
          order_id: input.orderId,
          created_at: redemption.createdAt.toISOString(),
          updated_at: new Date().toISOString()
        }));
      }
    });
  }
}
