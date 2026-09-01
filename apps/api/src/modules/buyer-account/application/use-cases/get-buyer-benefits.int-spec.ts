import test from "node:test";
import assert from "node:assert/strict";
import { GetBuyerBenefitsUseCase } from "./get-buyer-benefits.use-case.js";
import { InMemoryBuyerEarnedBenefitRepository } from "../../infrastructure/in-memory-buyer-earned-benefit.repository.js";

// Lightweight Prisma stub covering only the delegates the use-case reads.
function makePrismaStub(opts: {
  consent?: { merchantId: string } | null;
  advancedRules?: unknown[];
  merchantRule?: { freeShippingMinCartValue: number; allowFreeShipping?: boolean } | null;
}) {
  const consent = opts.consent === undefined ? { merchantId: "m1" } : opts.consent;
  return {
    buyerIntentMemoryConsent: {
      async findFirst() {
        return consent;
      },
    },
    checkoutSetting: {
      async findUnique() {
        return { advancedRules: opts.advancedRules ?? [] };
      },
    },
    merchantRule: {
      async findFirst() {
        return opts.merchantRule === undefined
          ? { freeShippingMinCartValue: 250, allowFreeShipping: true }
          : opts.merchantRule;
      },
    },
  } as any;
}

const discountRule = {
  id: "rule-1",
  enabled: true,
  priority: 1,
  conditions: [{ field: "cart_total", operator: "gte", value: 300 }],
  action: { type: "offer_discount", params: { percent: 15, maxDiscountReais: 16 } },
};

test("get-buyer-benefits: no consent → empty result (INV-05 LGPD gate)", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  await repo.create({
    merchantId: "m1",
    globalUserId: "u1",
    benefitType: "discount_percent",
    value: 10,
    origin: "loyalty_milestone",
    reason: "x",
  });
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({ consent: null }), repo);

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.deepEqual(res, { available: [], earned: [], progress: [] });
});

test("get-buyer-benefits: earned reflects active benefits for the tenant", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  await repo.create({
    merchantId: "m1",
    globalUserId: "u1",
    benefitType: "discount_percent",
    value: 15,
    origin: "loyalty_milestone",
    reason: "Cliente fiel: 15%",
  });
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({}), repo);

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.equal(res.earned.length, 1);
  assert.equal(res.earned[0].value, 15);
  assert.equal(res.earned[0].origin, "loyalty_milestone");
});

test("get-buyer-benefits: tenant scope — benefit from another merchant is excluded (INV-06)", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  await repo.create({
    merchantId: "other",
    globalUserId: "u1",
    benefitType: "coupon",
    value: 5,
    origin: "loyalty_milestone",
    reason: "cross-tenant",
  });
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({}), repo);

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.equal(res.earned.length, 0);
});

test("get-buyer-benefits: available lists qualifying value rule via wouldMatch", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  const uc = new GetBuyerBenefitsUseCase(
    makePrismaStub({ advancedRules: [discountRule] }),
    repo
  );

  const res = await uc.execute({
    globalUserId: "u1",
    merchantId: "m1",
    cart: { cartTotal: 350 },
  });

  assert.equal(res.available.length, 1);
  assert.equal(res.available[0].ruleId, "rule-1");
  assert.equal(res.available[0].discountPercent, 15);
  assert.equal(res.available[0].maxReais, 16);
});

test("get-buyer-benefits: available excludes rule the cart does not qualify for", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  const uc = new GetBuyerBenefitsUseCase(
    makePrismaStub({ advancedRules: [discountRule] }),
    repo
  );

  const res = await uc.execute({
    globalUserId: "u1",
    merchantId: "m1",
    cart: { cartTotal: 100 },
  });

  assert.equal(res.available.length, 0);
});

test("get-buyer-benefits: non-value action (show_message) is not offered as available", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  const rule = {
    id: "msg-1",
    enabled: true,
    priority: 1,
    conditions: [],
    action: { type: "show_message", params: { text: "hi" } },
  };
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({ advancedRules: [rule] }), repo);

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1", cart: { cartTotal: 500 } });

  assert.equal(res.available.length, 0);
});

test("get-buyer-benefits: progress computes remaining to free shipping threshold", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({}), repo);

  const res = await uc.execute({
    globalUserId: "u1",
    merchantId: "m1",
    cart: { cartTotal: 200 },
  });

  assert.equal(res.progress.length, 1);
  assert.equal(res.progress[0].target, 250);
  assert.equal(res.progress[0].current, 200);
  assert.equal(res.progress[0].remaining, 50);
});

test("get-buyer-benefits: progress empty once threshold reached", async () => {
  const repo = new InMemoryBuyerEarnedBenefitRepository();
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({}), repo);

  const res = await uc.execute({
    globalUserId: "u1",
    merchantId: "m1",
    cart: { cartTotal: 300 },
  });

  assert.equal(res.progress.length, 0);
});
