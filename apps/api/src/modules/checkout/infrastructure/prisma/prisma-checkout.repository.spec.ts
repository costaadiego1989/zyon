import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, type PrismaClient } from "@prisma/client";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";

type MerchantRuleRow = {
  merchantId: string;
  maxDiscountPercent: number;
  minimumMarginPercent: number;
  allowFreeShipping: boolean;
  allowShippingDiscount: boolean;
  allowBonusItem: boolean;
  allowStackDiscountAndFreeShipping: boolean;
  couponBoxEnabled: boolean;
  freeShippingMinCartValue: number;
  maxShippingSubsidy: number;
  maxPartialShippingDiscount: number;
  offerExpirationMinutes: number;
  blockedRegions: string[];
  brandVoice: string;
};

class FakePrisma {
  private readonly rules = new Map<string, MerchantRuleRow>();

  merchantRule = {
    upsert: async ({ where, create, update }: any) => {
      const current = this.rules.get(where.merchantId);
      const next = current ? { ...current, ...update } : create;
      this.rules.set(where.merchantId, next);
      return next;
    }
  };
}

test("prepayment benefits take admission locks and never rewrite a committed or assigned quote", async () => {
  for (const protection of ["payment", "order", "experiment"] as const) {
    const session = checkoutSession({ persistenceVersion: 1 });
    const locks: string[] = [];
    let writes = 0;
    const row = { ...session, version: 1, createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) };
    const tx = {
      $queryRaw: async (sql: TemplateStringsArray) => { locks.push(sql.join("?")); return []; },
      checkoutSession: { findUnique: async () => row, update: async () => { writes++; return row; } },
      paymentIntent: { findFirst: async () => protection === "payment" ? { id: "payment" } : null },
      completedOrder: { findFirst: async () => protection === "order" ? { id: "order" } : null },
      strategyIncentiveAssignment: { findUnique: async () => protection === "experiment" ? { id: "assignment" } : null },
    };
    const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
    const repo = new PrismaCheckoutRepository(prisma as unknown as PrismaClient);
    const result = await repo.saveBenefitsIfMutable({ ...session, cart: { ...session.cart, currentDiscount: 30 } }, session, merchantRules());
    assert.equal(result.cart.currentDiscount ?? 0, 0);
    assert.equal(writes, 0);
    assert.match(locks[0]!, /merchants.*FOR UPDATE/);
    assert.match(locks[1]!, /merchant_rules.*FOR UPDATE/);
    assert.match(locks[2]!, /checkout_sessions.*FOR UPDATE/);
  }
});

test("a merchant rule change during preparation prevents stale discount authorization", async () => {
  const session = checkoutSession({ persistenceVersion: 1 });
  const tx = {
    $queryRaw: async () => [],
    checkoutSession: { findUnique: async () => ({ ...session, version: 1, createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) }) },
    paymentIntent: { findFirst: async () => null }, completedOrder: { findFirst: async () => null },
    strategyIncentiveAssignment: { findUnique: async () => null },
    merchantRule: { upsert: async () => merchantRules({ maxDiscountPercent: 0 }) },
  };
  const prisma = { $transaction: async (work: (client: typeof tx) => Promise<unknown>) => work(tx) };
  const repo = new PrismaCheckoutRepository(prisma as unknown as PrismaClient);
  await assert.rejects(repo.saveBenefitsIfMutable(session, session, merchantRules()), /CHECKOUT_BENEFITS_RULES_CHANGED/);
});

test("clearing shipping after a customer correction writes database null instead of skipping the update", async () => {
  let update: Record<string, unknown> | undefined;
  const snapshot = checkoutSession({ persistenceVersion: 1 });
  const row = { ...snapshot, version: 1, createdAt: new Date(snapshot.createdAt), updatedAt: new Date(snapshot.updatedAt) };
  const prisma = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work(prisma),
    $queryRaw: async () => [],
    strategyAssignment: { findUnique: async () => null }, strategyIncentiveAssignment: { findUnique: async () => null },
    checkoutChatRequest: { findFirst: async () => null },
    checkoutSession: { findUnique: async () => row,
      update: async (input: { data: Record<string, unknown> }) => { update = input.data; return { ...row, version: 2 }; } },
  };
  const repository = new PrismaCheckoutRepository(prisma as unknown as PrismaClient);
  await repository.saveSession(checkoutSession({ persistenceVersion: 1, shipping: undefined, shippingOptions: undefined }));
  assert.equal(update?.shipping, Prisma.DbNull);
  assert.equal(update?.shippingOptions, Prisma.DbNull);
});

test("PrismaCheckoutRepository persists couponBoxEnabled in checkout rules", async () => {
  const prisma = new FakePrisma();
  const repository = new PrismaCheckoutRepository(prisma as unknown as PrismaClient);

  const updated = await repository.setRules("mrc_1", { couponBoxEnabled: false });
  const loaded = await repository.getRules("mrc_1");

  assert.equal(updated.couponBoxEnabled, false);
  assert.equal(loaded.couponBoxEnabled, false);
});

test("PrismaCheckoutRepository dashboard requests distinct session IDs for funnel stages", async () => {
  const queries: Array<{ where: { eventName: string }; distinct?: string[] }> = [];
  const eventSessionIds = {
    offer_viewed: ["chk_1", "chk_1", "chk_2"],
    order_completed: ["chk_1", "chk_1"],
    offer_accepted: ["chk_1", "chk_1"]
  };
  const prisma = {
    checkoutSession: {
      findMany: async () => [],
      count: async () => 2,
      aggregate: async () => ({ _avg: { abandonmentScore: null } })
    },
    authorizedOffer: { findMany: async () => [] },
    checkoutEvent: {
      findMany: async (query: { where: { eventName: string }; distinct?: string[] }) => {
        queries.push(query);
        const sessionIds = eventSessionIds[query.where.eventName as keyof typeof eventSessionIds];
        const returnedIds = query.distinct?.includes("sessionId")
          ? [...new Set(sessionIds)]
          : sessionIds;
        return returnedIds.map((sessionId) => ({ sessionId }));
      }
    },
    acceptedOffer: { aggregate: async () => ({ _avg: { value: null } }) }
  } as unknown as PrismaClient;
  const repository = new PrismaCheckoutRepository(prisma);

  const overview = await repository.overview("mrc_1", "7d");

  assert.deepEqual(queries.map((query) => query.where.eventName), ["offer_viewed", "order_completed", "offer_accepted"]);
  assert.ok(queries.every((query) => query.distinct?.join(",") === "sessionId"));
  assert.equal(overview.offers_viewed, 2);
  assert.equal(overview.orders_completed, 1);
  assert.equal(overview.offers_accepted, 1);
});
