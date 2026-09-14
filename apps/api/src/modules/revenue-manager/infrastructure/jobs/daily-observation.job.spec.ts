import test from "node:test";
import assert from "node:assert/strict";
import { DailyObservationScheduler, DailyObservationWorker } from "./daily-observation.job.js";

function worker(prisma: Record<string, unknown>) {
  return new DailyObservationWorker(
    prisma as never,
    { execute: async () => ({ is_new: false }) } as never,
    { execute: async () => ({}) } as never,
    { execute: async () => ({ status: "created" }) } as never,
    { generate: () => null } as never,
    { save: async () => {} } as never,
  );
}

test("merchant-triggered observation propagates a database failure for BullMQ retry", async () => {
  const instance = worker({
    merchant: { findMany: async () => { throw new Error("database unavailable"); } },
  });

  await assert.rejects(
    instance.runObservationCycle("merchant-a"),
    /database unavailable/,
  );
});

test("merchant-triggered observation rejects an unknown merchant instead of reporting a false success", async () => {
  const instance = worker({
    merchant: { findMany: async () => [] },
  });

  await assert.rejects(
    instance.runObservationCycle("merchant-a"),
    /REVENUE_MANAGER_MERCHANT_NOT_FOUND/,
  );
});

test("manual strategy jobs use a BullMQ-valid identifier and retry transient failures", async () => {
  const scheduler = new DailyObservationScheduler();
  let options: Record<string, unknown> | undefined;
  (scheduler as any).queue = {
    add: async (_name: string, _data: unknown, jobOptions: Record<string, unknown>) => {
      options = jobOptions;
      return { id: jobOptions.jobId };
    },
  };

  const jobId = await scheduler.enqueueMerchantRun("merchant-a");

  assert.ok(!jobId.includes(":"));
  assert.equal(options?.attempts, 3);
  assert.deepEqual(options?.backoff, { type: "exponential", delay: 1_000 });
});

test("cohort stats use only consented, point-in-time intent data with complete cart costs", async () => {
  const now = Date.now();
  const sessions = Array.from({ length: 30 }, (_, index) => ({
    globalUserId: "buyer-a",
    createdAt: new Date(now - 60_000),
    cart: { items: [{ price: 100, cost: 40, quantity: 1 }] },
    completedOrders: index < 3 ? [{ id: `order-${index}` }] : [],
  }));
  const instance = worker({
    customerIntentRecord: {
      findMany: async (args: { where: { merchantId: string; consent: { is: { optedIn: boolean } } } }) => {
        assert.equal(args.where.merchantId, "merchant-a");
        assert.equal(args.where.consent.is.optedIn, true);
        return [{ globalUserId: "buyer-a", primaryIntent: "price_sensitive", generatedAt: new Date(now - 86_400_000) }];
      },
    },
    checkoutSession: { findMany: async () => sessions },
    productPrice: { findMany: async () => [] },
  });

  const stats = await (instance as any).loadCohortStats("merchant-a");

  assert.equal(stats.length, 1);
  assert.deepEqual(stats[0], {
    intent: "price_sensitive",
    sampleSize: 30,
    conversionRate: 0.1,
    avgMarginPercent: 60,
  });
});

test("cohort stats use catalog cost only for the merchant-owned variant and ignore later intent records", async () => {
  const now = Date.now();
  const instance = worker({
    customerIntentRecord: {
      findMany: async () => [
        { globalUserId: "buyer-a", primaryIntent: "price_sensitive", generatedAt: new Date(now - 86_400_000) },
        { globalUserId: "buyer-b", primaryIntent: "price_sensitive", generatedAt: new Date(now) },
      ],
    },
    checkoutSession: {
      findMany: async () => [
        {
          globalUserId: "buyer-a",
          createdAt: new Date(now - 60_000),
          cart: { items: [{ variantId: "variant-a", price: 100, quantity: 1 }] },
          completedOrders: [{ id: "order-a" }],
        },
        {
          globalUserId: "buyer-b",
          createdAt: new Date(now - 60_000),
          cart: { items: [{ variantId: "variant-a", price: 100, quantity: 1 }] },
          completedOrders: [{ id: "order-b" }],
        },
      ],
    },
    productPrice: {
      findMany: async (args: { where: { variant: { product: { merchantId: string } } } }) => {
        assert.equal(args.where.variant.product.merchantId, "merchant-a");
        return [{ variantId: "variant-a", costInCents: 45_00 }];
      },
    },
  });

  const stats = await (instance as any).loadCohortStats("merchant-a");

  assert.deepEqual(stats, [{
    intent: "price_sensitive",
    sampleSize: 1,
    conversionRate: 1,
    avgMarginPercent: 55,
  }]);
});
