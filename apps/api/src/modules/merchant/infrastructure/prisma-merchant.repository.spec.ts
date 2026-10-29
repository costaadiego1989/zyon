import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaMerchantRepository } from "./prisma-merchant.repository.js";
import { UpdateMerchantRulesUseCase } from "../application/merchant.use-cases.js";

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
  settings: Record<string, any> = { company: { razaoSocial: "Fornecedor" }, policies: { privacy: "Texto vigente" } };
  merchant = {
    findUnique: async () => ({ storeSettings: structuredClone(this.settings) }),
    update: async ({ data }: any) => { this.settings = structuredClone(data.storeSettings); return {}; },
  };
  $transaction = async (run: (tx: FakePrisma) => Promise<any>) => run(this);

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

test("checkout policy links survive reload and partial edits preserve store settings", async () => {
  const prisma = new FakePrisma();
  const repository = new PrismaMerchantRepository(prisma as unknown as PrismaClient);
  await repository.updateRules("mrc_1", { policies: { privacyUrl: "https://supplier.example/privacy", termsUrl: "https://supplier.example/terms" } });
  await repository.updateRules("mrc_1", { policies: { termsUrl: "" } });
  await repository.updateRules("mrc_1", { couponBoxEnabled: false });
  assert.deepEqual((await repository.getRules("mrc_1")).policies, { privacyUrl: "https://supplier.example/privacy", termsUrl: "" });
  assert.deepEqual(prisma.settings.company, { razaoSocial: "Fornecedor" });
  assert.deepEqual(prisma.settings.policies, { privacy: "Texto vigente" });
});

test("invalid policy URLs never reach persistence or emit a configuration event", async () => {
  let writes = 0;
  let events = 0;
  const useCase = new UpdateMerchantRulesUseCase({ updateRules: async () => { writes++; return {}; } } as never, { publish: async () => { events++; } } as never);
  for (const policies of [null, [], { privacyUrl: "javascript:alert(1)" }, { termsUrl: "https://user:secret@example.com" }, { refundUrl: 123 }, { unsupported: "https://example.com" }]) {
    await assert.rejects(useCase.execute("mrc_1", { policies } as never), /invalid_policy_links/);
  }
  assert.equal(writes, 0);
  assert.equal(events, 0);
});
