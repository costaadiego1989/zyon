import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
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
