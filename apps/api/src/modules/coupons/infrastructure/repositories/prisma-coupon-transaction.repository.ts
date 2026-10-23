import { Injectable } from "@nestjs/common";
import type { Prisma, PrismaClient } from "@prisma/client";
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
  strategyIncentiveExecutionId: string | null;
};

@Injectable()
export class PrismaCouponTransactionRepository implements CouponTransactionRepository {
  constructor(private readonly prisma: PrismaClient | Prisma.TransactionClient, private readonly inTransaction = false) {}

  private transaction<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.inTransaction ? work(this.prisma) : (this.prisma as PrismaClient).$transaction(work);
  }

  async reserve(input: Parameters<CouponTransactionRepository["reserve"]>[0]): Promise<CouponReservationResult> {
    return this.transaction(async (tx) => {
      const locked = await tx.$queryRaw<LockedCouponLimits[]>`
        SELECT "max_usages" AS "maxUsages", "max_per_buyer" AS "maxPerBuyer",
          "strategy_incentive_execution_id" AS "strategyIncentiveExecutionId"
        FROM "coupons"
        WHERE "id" = ${input.coupon.id} AND "merchant_id" = ${input.coupon.merchant_id}
        FOR UPDATE
      `;
      const limits = locked[0];
      if (!limits) return { status: "coupon_missing" };
      if (limits.strategyIncentiveExecutionId || input.coupon.strategy_incentive_execution_id) {
        throw new Error("COUPON_STRATEGY_CHECKOUT_REQUIRED");
      }

      const existing = await tx.couponRedemption.findUnique({
        where: {
          merchantId_sessionId_couponId: {
            merchantId: input.redemption.merchant_id,
            sessionId: input.redemption.session_id,
            couponId: input.redemption.coupon_id
          }
        },
        select: { id: true, status: true }
      });
      if (existing && existing.status !== "cancelled") return { status: "already_applied" };

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

      let reserved: {id:string;updatedAt:Date};
      if (existing) {
        const snap = input.redemption.snapshot();
        reserved = await tx.couponRedemption.update({
          where: { id: existing.id },
          data: {
            buyerGlobalUserId: snap.buyer_global_user_id,
            discountApplied: snap.discount_applied,
            source: snap.source,
            status: "applied",
            orderId: null,
          },
          select: {id:true,updatedAt:true},
        });
      } else {
        reserved = await tx.couponRedemption.create({ data: toRedemptionCreateInput(input.redemption),select:{id:true,updatedAt:true} });
      }
      if(!reserved || reserved.id!==(existing?.id??input.redemption.id)||!(reserved.updatedAt instanceof Date)
        ||!Number.isFinite(reserved.updatedAt.getTime()))throw new Error("coupon_reservation_generation_unavailable");
      await appendOutboxInTransaction(tx, {...input.event,payload:{...input.event.payload,
        redemption_id:reserved.id,reservation_updated_at:reserved.updatedAt.toISOString()}});
      return { status: "reserved", redemption_id: existing?.id ?? input.redemption.id };
    });
  }

  async redeem(input: Parameters<CouponTransactionRepository["redeem"]>[0]): Promise<void> {
    const { merchantId, sessionId, orderId, eventFor } = input;
    await this.transaction(async (tx) => {
      // Discover lock identities without taking a redemption row lock. Every
      // coupon must be acquired before any redemption mutation, as in reserve.
      const candidates = await tx.couponRedemption.findMany({
        where: { merchantId, sessionId, status: "applied" },
        select: { id: true, couponId: true },
      });
      if (candidates.length === 0) return;
      const couponIds = [...new Set(candidates.map(row => row.couponId))].sort();
      for (const couponId of couponIds) {
        const locked = await tx.$queryRaw<Array<{ id: string }>>`
          SELECT "id" FROM "coupons"
          WHERE "id" = ${couponId} AND "merchant_id" = ${merchantId}
          FOR UPDATE
        `;
        if (locked.length !== 1 || locked[0]?.id !== couponId) {
          throw new Error("coupon_redemption_coupon_unavailable");
        }
      }
      // A competing delivery/cancellation can have changed the snapshot while
      // we waited. Only the discovered, still-applied scoped rows are eligible.
      const applied = await tx.couponRedemption.findMany({
        where: { merchantId, sessionId, status: "applied", id: { in: candidates.map(row => row.id) }, couponId: { in: couponIds } },
        orderBy: [{ couponId: "asc" }, { id: "asc" }],
      });

      for (const redemption of applied) {
        const updated = await tx.couponRedemption.updateMany({
          where: { id: redemption.id, merchantId, sessionId, couponId: redemption.couponId, status: "applied" },
          data: { status: "redeemed", orderId }
        });
        if (updated.count === 0) continue;
        if (updated.count !== 1) throw new Error("coupon_redemption_transition_conflict");

        await tx.coupon.update({
          where: { id: redemption.couponId, merchantId },
          data: { usagesCount: { increment: 1 } }
        });
        await appendOutboxInTransaction(tx, eventFor({
          id: redemption.id,
          coupon_id: redemption.couponId,
          merchant_id: redemption.merchantId,
          session_id: redemption.sessionId,
          buyer_global_user_id: redemption.buyerGlobalUserId,
          discount_applied: Number(redemption.discountApplied),
          source: redemption.source as "manual" | "auto",
          status: "redeemed",
          order_id: orderId,
          created_at: redemption.createdAt.toISOString(),
          updated_at: new Date().toISOString()
        }));
      }
    });
  }
}
