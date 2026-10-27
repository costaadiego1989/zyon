import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CouponEntity } from "../../domain/entities/coupon.entity.js";
import { CouponRedemptionEntity } from "../../domain/entities/coupon-redemption.entity.js";
import { createCouponEventEnvelope } from "../../domain/events/coupon-domain-event.js";
import { PrismaCouponTransactionRepository } from "./prisma-coupon-transaction.repository.js";
import { Prisma, type CouponRedemption } from "@prisma/client";

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

type RedemptionWhere = { merchantId?: string; sessionId?: string; status?: string; couponId?: string | { in: string[] }; id?: string | { in: string[] } };
function redemptionRow(id = "redemption-a", couponId = "coupon-a"): CouponRedemption {
  return { id, couponId, merchantId: "mrc_1", sessionId: "session-1", buyerGlobalUserId: "buyer-1", discountApplied: new Prisma.Decimal(10),
    source: "manual", status: "applied", orderId: null, createdAt: new Date(0), updatedAt: new Date(0) };
}
// Explicit delegates, NOT PostgreSQL locking/isolation proof. Calls go through
// the real repository; no fixture silently grants a coupon lock to redeem.
function redemptionFixture(initial: CouponRedemption[] = [redemptionRow()]) {
  let rows = initial.map(row => ({ ...row }));
  const calls: Array<{ step: string; args?: unknown }> = [];
  const events: Array<{ eventType: string; payload: unknown }> = [];
  let missingCoupon = false, loseCas = false, afterLock: (() => void) | undefined;
  const matches = (row: CouponRedemption, where: RedemptionWhere) =>
    (where.merchantId === undefined || row.merchantId === where.merchantId)
    && (where.sessionId === undefined || row.sessionId === where.sessionId)
    && (where.status === undefined || row.status === where.status)
    && (where.id === undefined || (typeof where.id === "string" ? row.id === where.id : where.id.in.includes(row.id)))
    && (where.couponId === undefined || (typeof where.couponId === "string" ? row.couponId === where.couponId : where.couponId.in.includes(row.couponId)));
  const tx = {
    async $queryRaw(parts: TemplateStringsArray, ...args: unknown[]) {
      calls.push({ step: "coupon-lock", args: { sql: parts.join("?"), values: args } });
      const run = afterLock; afterLock = undefined; run?.();
      if (missingCoupon) return [];
      return [{ id: args[0], maxUsages: 10, maxPerBuyer: null, strategyIncentiveExecutionId: null }];
    },
    couponRedemption: {
      async findMany(input: { where: RedemptionWhere; orderBy?: unknown }) {
        calls.push({ step: "read", args: input });
        const result = rows.filter(row => matches(row, input.where)).map(row => ({ ...row }));
        if (input.orderBy) result.sort((a, b) => a.couponId < b.couponId ? -1 : a.couponId > b.couponId ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
        return result;
      },
      async findUnique(input: { where: { merchantId_sessionId_couponId: { merchantId: string; sessionId: string; couponId: string } } }) {
        return rows.find(row => matches(row, input.where.merchantId_sessionId_couponId)) ?? null;
      },
      async count() { return rows.filter(row => row.status !== "cancelled").length; },
      async create(input: { data: Omit<CouponRedemption, "createdAt" | "updatedAt" | "discountApplied"> & { discountApplied: number } }) {
        calls.push({ step: "redemption-create", args: input });
        const row = { ...input.data, discountApplied: new Prisma.Decimal(input.data.discountApplied), createdAt: new Date(0), updatedAt: new Date(0) };
        rows.push(row); return row;
      },
      async updateMany(input: { where: RedemptionWhere; data: { status: string; orderId: string } }) {
        calls.push({ step: "redemption-write", args: input });
        if (loseCas) return { count: 0 };
        const selected = rows.filter(row => matches(row, input.where));
        for (const row of selected) Object.assign(row, input.data);
        return { count: selected.length };
      },
    },
    coupon: { async update(input: unknown) { calls.push({ step: "coupon-write", args: input }); return {}; } },
    outboxMessage: { async upsert(input: { create: { eventType: string; payload: unknown } }) { calls.push({ step: "outbox", args: input }); events.push(input.create); return input.create; } },
  };
  const input = { merchantId: "mrc_1", sessionId: "session-1", orderId: "order-1",
    eventFor: (row: Parameters<Parameters<PrismaCouponTransactionRepository["redeem"]>[0]["eventFor"]>[0]) => createCouponEventEnvelope({
      eventType: "coupon.redeemed", merchantId: row.merchant_id, payload: { id: row.id, discount: row.discount_applied },
    }) };
  return { repository: new PrismaCouponTransactionRepository(tx as never, true), input, calls, events,
    missingCoupon: () => { missingCoupon = true; }, loseCas: () => { loseCas = true; },
    afterLock: (run: () => void) => { afterLock = run; }, changeDiscount: (value: number) => { rows[0]!.discountApplied = new Prisma.Decimal(value); } };
}

describe("PrismaCouponTransactionRepository", () => {
  it("reserve and redeem both acquire coupon before any redemption write", async () => {
    const f = redemptionFixture([]), entity = coupon();
    const redemption = CouponRedemptionEntity.create({ coupon_id: entity.id, merchant_id: "mrc_1", session_id: "session-1",
      buyer_global_user_id: "buyer-1", discount_applied: 10, source: "manual" });
    await f.repository.reserve({ coupon: entity.snapshot(), redemption,
      event: createCouponEventEnvelope({ eventType: "coupon.applied", merchantId: "mrc_1", payload: {} }) });
    assert.deepEqual(f.calls.filter(call => call.step !== "read").map(call => call.step), ["coupon-lock", "redemption-create", "outbox"]);
    f.calls.length = 0;
    await f.repository.redeem(f.input);
    const writes = f.calls.filter(call => call.step !== "read").map(call => call.step);
    assert.deepEqual(writes, ["coupon-lock", "redemption-write", "coupon-write", "outbox"], "redeem must not invert reserve's coupon-to-redemption lock order");
  });

  it("locks coupon IDs once in deterministic order and pins all redemption mutations to merchant/session/coupon", async () => {
    const f = redemptionFixture([redemptionRow("redemption-z", "coupon-z"), redemptionRow("redemption-b", "coupon-a"), redemptionRow("redemption-a", "coupon-a")]);
    await f.repository.redeem(f.input);
    const locks = f.calls.filter(call => call.step === "coupon-lock");
    assert.deepEqual(locks.map(call => (call.args as { values: unknown[] }).values), [["coupon-a", "mrc_1"], ["coupon-z", "mrc_1"]]);
    for (const call of locks) {
      const sql = (call.args as { sql: string }).sql;
      assert.match(sql, /FROM\s+"coupons"/); assert.match(sql, /"merchant_id"\s*=\s*\?/); assert.match(sql, /FOR UPDATE/);
    }
    const lastLock = f.calls.map(call => call.step).lastIndexOf("coupon-lock");
    assert.ok(lastLock < f.calls.findIndex(call => call.step === "redemption-write"));
    assert.deepEqual(f.calls.filter(call => call.step === "redemption-write").map(call => (call.args as { where: RedemptionWhere }).where), [
      { id: "redemption-a", merchantId: "mrc_1", sessionId: "session-1", couponId: "coupon-a", status: "applied" },
      { id: "redemption-b", merchantId: "mrc_1", sessionId: "session-1", couponId: "coupon-a", status: "applied" },
      { id: "redemption-z", merchantId: "mrc_1", sessionId: "session-1", couponId: "coupon-z", status: "applied" },
    ]);
    for (const call of f.calls.filter(call => call.step === "coupon-write")) assert.equal((call.args as { where: { merchantId?: string } }).where.merchantId, "mrc_1");
  });

  it("rereads applied snapshots after the coupon lock instead of publishing a stale discount", async () => {
    const f = redemptionFixture(); f.afterLock(() => f.changeDiscount(7));
    await f.repository.redeem(f.input);
    assert.deepEqual(f.events.map(event => event.payload), [{ id: "redemption-a", discount: 7 }]);
  });

  it("missing or foreign coupon lock never mutates a redemption, increments usage or publishes", async () => {
    const f = redemptionFixture(); f.missingCoupon();
    await assert.rejects(f.repository.redeem(f.input));
    assert.equal(f.calls.some(call => ["redemption-write", "coupon-write", "outbox"].includes(call.step)), false);
  });

  it("CAS lost to another delivery and replay never duplicate usage or outbox", async () => {
    const raced = redemptionFixture(); raced.loseCas(); await raced.repository.redeem(raced.input);
    assert.equal(raced.calls.some(call => call.step === "coupon-write" || call.step === "outbox"), false);
    const f = redemptionFixture(); await f.repository.redeem(f.input); await f.repository.redeem(f.input);
    assert.equal(f.calls.filter(call => call.step === "coupon-write").length, 1); assert.equal(f.events.length, 1);
  });

  it("an empty applied set takes no coupon lock and produces no write or event", async () => {
    const f = redemptionFixture([]); await f.repository.redeem(f.input);
    assert.deepEqual(f.calls.map(call => call.step), ["read"]);
    assert.equal(f.events.length, 0);
  });

  it("same coupon under a different tenant or session cannot be selected or redeemed", async () => {
    for (const foreign of ["merchant", "session"] as const) {
      const row = redemptionRow();
      if (foreign === "merchant") row.merchantId = "mrc_other";
      else row.sessionId = "session-other";
      const f = redemptionFixture([row]); await f.repository.redeem(f.input);
      assert.deepEqual(f.calls.map(call => call.step), ["read"]);
      assert.equal(f.events.length, 0);
      assert.deepEqual((f.calls[0]!.args as { where: RedemptionWhere }).where, { merchantId: "mrc_1", sessionId: "session-1", status: "applied" });
    }
  });

  it("the locked database marker blocks an ordinary reservation even if its caller omits the strategy link", async () => {
    const entity = coupon();
    const tx = { async $queryRaw() { return [{ maxUsages: 10, maxPerBuyer: 1, strategyIncentiveExecutionId: "execution-1" }]; } };
    const repository = new PrismaCouponTransactionRepository(tx as never, true);
    await assert.rejects(repository.reserve({ coupon: entity.snapshot(),
      redemption: CouponRedemptionEntity.create({ coupon_id: entity.id, merchant_id: "mrc_1", session_id: "session-1",
        buyer_global_user_id: "buyer-1", discount_applied: 10, source: "manual" }),
      event: createCouponEventEnvelope({ eventType: "coupon.applied", merchantId: "mrc_1", payload: {} }),
    }), /COUPON_STRATEGY_CHECKOUT_REQUIRED/);
  });

  it("reactivates a cancelled session reservation instead of creating a duplicate", async () => {
    const saved: Array<{ where: unknown; data: unknown }> = [];
    const outboxEvents: unknown[] = [];
    const tx = {
      async $queryRaw() { return [{ maxUsages: 1, maxPerBuyer: null }]; },
      couponRedemption: {
        async findUnique() { return { id: "red_existing", status: "cancelled" }; },
        async count() { return 0; },
        async update(input: { where: unknown; data: unknown; select?:unknown }) { const {select:_select,...write}=input;saved.push(write);return{id:"red_existing",updatedAt:new Date("2026-10-20T12:00:00.123Z")}; },
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
    const actualEvent = outboxEvents[0] as {create:{payload:Record<string,unknown>}};
    assert.equal(actualEvent.create.payload.redemption_id,"red_existing");
    assert.equal(actualEvent.create.payload.reservation_updated_at,"2026-10-20T12:00:00.123Z");
  });

  it("enriches the original application event with actual reservation generation, never a caller reference", async()=>{
    const f=redemptionFixture([]),entity=coupon();
    const event=createCouponEventEnvelope({eventType:"coupon.applied",merchantId:"mrc_1",
      payload:{redemption_id:"untrusted-request-reference",reservation_updated_at:"untrusted-time"}});
    const redemption=CouponRedemptionEntity.create({coupon_id:entity.id,merchant_id:"mrc_1",session_id:"session-1",
      buyer_global_user_id:"buyer-1",discount_applied:10,source:"manual"});
    await f.repository.reserve({coupon:entity.snapshot(),redemption,event});
    const persisted=f.calls.find(call=>call.step==="outbox")!.args as {create:{eventId:string;payload:Record<string,unknown>}};
    assert.equal(persisted.create.eventId,event.event_id);
    assert.equal(persisted.create.payload.redemption_id,redemption.id);
    assert.equal(persisted.create.payload.reservation_updated_at,new Date(0).toISOString());
    assert.equal(event.payload.redemption_id,"untrusted-request-reference","the caller envelope is not mutated");
  });
});
