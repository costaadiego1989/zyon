import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaMerchantRepository } from "./prisma-merchant.repository.js";

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

test("PrismaMerchantRepository persists couponBoxEnabled in merchant rules", async () => {
  const prisma = new FakePrisma();
  const repository = new PrismaMerchantRepository(prisma as unknown as PrismaClient);

  const updated = await repository.updateRules("mrc_1", { couponBoxEnabled: false });
  const loaded = await repository.getRules("mrc_1");

  assert.equal(updated.couponBoxEnabled, false);
  assert.equal(loaded.couponBoxEnabled, false);
});
