import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { PrismaCouponTransactionRepository } from "./prisma-coupon-transaction.repository.js";

function coupon() {
  return CouponEntity.create({
    merchant_id: "mrc_1",
    code: "SAVE10",
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
    ends_at: null,
  });
}

describe("PrismaCouponTransactionRepository", () => {
  it("reactivates a cancelled session reservation instead of creating a duplicate", async () => {
    const saved: Array<{ where: unknown; data: unknown }> = [];
    const outboxEvents: unknown[] = [];
    const tx = {
      async $queryRaw() { return [{ maxUsages: 1, maxPerBuyer: null }]; },
      couponRedemption: {
        async findUnique() { return { id: "red_existing", status: "cancelled" }; },
        async count() { return 0; },
        async update(input: { where: unknown; data: unknown }) { saved.push(input); },
        async create() { throw new Error("must_not_create_a_duplicate"); },
      },
      outboxMessage: {
        async upsert(input: unknown) { outboxEvents.push(input); },
      },
    };
    const prisma = {
      async $transaction<T>(work: (client: typeof tx) => Promise<T>) { return work(tx); },
    };
    const entity = coupon();
    const redemption = CouponRedemptionEntity.create({
      coupon_id: entity.id,
      merchant_id: "mrc_1",
      session_id: "sess_1",
      buyer_global_user_id: "buyer_1",
      discount_applied: 10,
      source: "manual",
    });
    const repository = new PrismaCouponTransactionRepository(prisma as never);

    const result = await repository.reserve({
      coupon: entity.snapshot(),
      redemption,
      event: createCouponEventEnvelope({
        eventType: "coupon.applied",
        merchantId: "mrc_1",
        payload: { session_id: "sess_1" },
      }),
    });

    assert.deepEqual(result, { status: "reserved", redemption_id: "red_existing" });
    assert.deepEqual(saved, [{
      where: { id: "red_existing" },
      data: {
        buyerGlobalUserId: "buyer_1",
        discountApplied: 10,
        source: "manual",
        status: "applied",
        orderId: null,
      },
    }]);
    assert.equal(outboxEvents.length, 1);
  });
});
