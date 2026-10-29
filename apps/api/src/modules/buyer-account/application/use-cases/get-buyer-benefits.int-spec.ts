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
  assert.match(res.available[0].condition, /valor dos produtos no carrinho a partir de R\$/);
  assert.doesNotMatch(res.available[0].condition, /cart_total|\bgte\b/);
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

test("get-buyer-benefits: unmet compound terms are listed without qualifying an absent cart", async () => {
  const rule = { ...discountRule, conditions: [
    { field: "cart_total", operator: ">=", value: 300 },
    { field: "cart_item_count", operator: "gte", value: 3 },
    { field: "payment_method", operator: "eq", value: "pix" },
    { field: "coupon_applied", operator: "eq", value: false },
  ] };
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({ advancedRules: [rule] }), new InMemoryBuyerEarnedBenefitRepository());

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.deepEqual(res.available, []);
  assert.deepEqual(res.earned, []);
  assert.equal(res.offers, undefined);
  assert.equal(res.conditions?.length, 1);
  assert.deepEqual(res.conditions?.[0], {
    ruleId: "rule-1", description: "Até 15% de desconto nos produtos", discountPercent: 15, maxReais: 16,
    condition: `valor dos produtos no carrinho a partir de ${(300).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} e quantidade total no carrinho a partir de 3 itens e pagamento igual a Pix e sem cupom aplicado`,
  });
  assert.doesNotMatch(JSON.stringify(res.conditions), /cart_total|cart_item_count|payment_method|\bgte\b|disponível|aplicado nesta compra/);
});

test("get-buyer-benefits: informational rules exclude disabled actions and never expose coupon codes", async () => {
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({ advancedRules: [
    { ...discountRule, id: "disabled", enabled: false },
    { ...discountRule, id: "message", action: { type: "show_message", params: { text: "not a benefit" } } },
    { ...discountRule, id: "shipping", action: { type: "offer_free_shipping", params: {} } },
    { ...discountRule, id: "coupon", action: { type: "offer_coupon", params: { code: "PRIVATE-EXAMPLE", maxDiscountReais: Number.NaN } } },
  ] }), new InMemoryBuyerEarnedBenefitRepository());

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.deepEqual(res.conditions?.map(({ ruleId, description }) => ({ ruleId, description })), [
    { ruleId: "shipping", description: "Frete grátis" },
    { ruleId: "coupon", description: "Cupom conforme as condições da oferta" },
  ]);
  assert.equal(res.conditions?.[1].maxReais, undefined);
  assert.doesNotMatch(JSON.stringify(res.conditions), /PRIVATE-EXAMPLE|NaN|disponível/);
  assert.deepEqual(res.available, []);
});

test("get-buyer-benefits: non-executable discount values are not advertised as conditional offers", async () => {
  const invalid = [0, -1, 101, Number.NaN, Number.POSITIVE_INFINITY].map((percent) => ({
    ...discountRule, action: { type: "offer_discount", params: { percent } },
  }));
  const invalidCaps = [0, -1, Number.NaN, Number.POSITIVE_INFINITY, "invalid"].map((maxDiscountReais) => ({
    ...discountRule, action: { type: "offer_discount", params: { percent: 5, maxDiscountReais } },
  }));
  const uc = new GetBuyerBenefitsUseCase(makePrismaStub({ advancedRules: [
    ...invalid, ...invalidCaps,
    { ...discountRule, id: "valid-decimal", action: { type: "offer_discount", params: { percent: 3.5 } } },
  ] }), new InMemoryBuyerEarnedBenefitRepository());

  const res = await uc.execute({ globalUserId: "u1", merchantId: "m1" });

  assert.equal(res.conditions?.length, 1);
  assert.equal(res.conditions?.[0].ruleId, "valid-decimal");
  assert.equal(res.conditions?.[0].description, "Até 3,5% de desconto nos produtos");
  assert.equal(res.conditions?.[0].discountPercent, 3.5);
  assert.equal(res.conditions?.[0].maxReais, undefined);
  assert.deepEqual(res.available, []);
});

test("get-buyer-benefits: conditions require buyer consent and read only the selected merchant ID", async () => {
  const merchantId = "mrc-store-id-different-from-slug";
  const queries: unknown[] = [];
  const settings: unknown[] = [];
  const prisma = makePrismaStub({});
  prisma.buyerIntentMemoryConsent.findFirst = async ({ where }: any) => {
    queries.push(where);
    return where.globalUserId === "u1" && where.merchantId === merchantId ? { merchantId } : null;
  };
  prisma.checkoutSetting.findUnique = async (query: any) => {
    settings.push(query);
    assert.equal(query.where.merchantId, merchantId);
    return { advancedRules: [discountRule] };
  };
  const uc = new GetBuyerBenefitsUseCase(prisma, new InMemoryBuyerEarnedBenefitRepository());

  const res = await uc.execute({ globalUserId: "u1", merchantId });
  assert.equal(res.conditions?.[0].ruleId, "rule-1");
  assert.deepEqual(settings, [{ where: { merchantId }, select: { advancedRules: true } }]);
  assert.equal((queries[0] as any).globalUserId, "u1");
  assert.equal((queries[0] as any).merchantId, merchantId);
  assert.equal((queries[0] as any).optedIn, true);
  assert.ok((queries[0] as any).expiresAt.gt instanceof Date);

  for (const input of [{ globalUserId: "u2", merchantId }, { globalUserId: "u1", merchantId: "other-store" }, { globalUserId: "", merchantId }]) {
    assert.deepEqual(await uc.execute(input), { available: [], earned: [], progress: [] });
  }
  assert.equal(settings.length, 1, "no additional rule reads for another buyer, store, or missing identity");
});
