import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { toCouponCreateInput } from "./prisma-coupon.converters.js";
import { PrismaCouponTransactionRepository } from "./prisma-coupon-transaction.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaCouponTransactionRepository reserves one max-use coupon once across concurrent sessions",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantId = `mrc_coupon_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
    const coupon = CouponEntity.create({
      merchant_id: merchantId,
      code: `ONE${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`,
      discount_type: "percent",
      discount_value: 10,
      min_cart_total: null,
      max_usages: 1,
      max_per_buyer: null,
      allowed_skus: [],
      blocked_skus: [],
      allowed_regions: [],
      blocked_regions: [],
      starts_at: new Date(Date.now() - 1_000).toISOString(),
      ends_at: null
    });

    try {
      await prisma.coupon.create({ data: toCouponCreateInput(coupon) });
      const repository = new PrismaCouponTransactionRepository(prisma);
      const reserve = (sessionId: string) => {
        const redemption = CouponRedemptionEntity.create({
          coupon_id: coupon.id,
          merchant_id: merchantId,
          session_id: sessionId,
          buyer_global_user_id: null,
          discount_applied: 10,
          source: "manual"
        });
        return repository.reserve({
          coupon: coupon.snapshot(),
          redemption,
          event: createCouponEventEnvelope({
            eventType: "coupon.applied",
            merchantId,
            payload: { session_id: sessionId, coupon_id: coupon.id, code: coupon.code, discount_applied: 10, source: "manual" }
          })
        });
      };

      const results = await Promise.all([reserve("sess_coupon_a"), reserve("sess_coupon_b")]);
      assert.equal(results.filter((result) => result.status === "reserved").length, 1);
      assert.equal(results.filter((result) => result.status === "limit_reached").length, 1);
      assert.equal(await prisma.couponRedemption.count({ where: { couponId: coupon.id } }), 1);
      assert.equal(await prisma.outboxMessage.count({ where: { merchantId, eventType: "coupon.applied" } }), 1);
    } finally {
      await prisma.outboxMessage.deleteMany({ where: { merchantId } });
      await prisma.coupon.deleteMany({ where: { id: coupon.id } });
      await prisma.$disconnect();
    }
  }
);
