import test from "node:test";
import assert from "node:assert/strict";
import { createCartHandlers, type CartHandlerDeps } from "./cart.handlers.js";
import { GenerateNudgeUseCase } from "../../application/use-cases/generate-nudge.use-case.js";
import type { NudgeCopyInput } from "../../domain/ports/conversation.port.js";
import { CouponEntity } from "../../../coupons/domain/entities/coupon.entity.js";
import { InMemoryCouponRepository } from "../../../coupons/infrastructure/repositories/in-memory-coupon.repository.js";

const merchantId = "store";
const privateCode = "ZYON" + "B".repeat(20);

async function repository(publicCoupon = true) {
  const coupons = new InMemoryCouponRepository();
  const ordinary = CouponEntity.create({ merchant_id: merchantId, code: "WELCOME", discount_type: "percent", discount_value: 10,
    min_cart_total: null, max_usages: 100, max_per_buyer: 1, allowed_skus: [], blocked_skus: [], allowed_regions: [], blocked_regions: [],
    starts_at: new Date(Date.now() - 60_000).toISOString(), ends_at: new Date(Date.now() + 86400000).toISOString(),
    strategy_incentive_execution_id: null });
  if (publicCoupon) await coupons.save(ordinary);
  await coupons.save(CouponEntity.rehydrate({ ...ordinary.snapshot(), id: "strategy-coupon", code: privateCode,
    strategy_incentive_execution_id: "approved-execution", strategy_incentive_state: "active" }));
  return coupons;
}

for (const authenticated of [false, true]) test(`list_promotions excludes strategy codes for ${authenticated ? "identified" : "anonymous"} buyers`, async () => {
  const coupons = await repository();
  const handlers = createCartHandlers({ couponRepo: coupons,
    prisma: { checkoutSetting: { findUnique: async () => null } },
    merchantRepo: { getRules: async () => ({ maxDiscountPercent: 10 }) },
  } as unknown as CartHandlerDeps, { merchantId, sessionId: "session", ...(authenticated ? { buyer: { globalUserId: "buyer" } } : {}) });
  const output = await handlers.listPromotions({}) as { coupons: Array<{ code: string }>; promotions: Array<{ code: string }> };
  assert.deepEqual(output.coupons.map(coupon => coupon.code), ["WELCOME"]);
  assert.deepEqual(output.promotions, output.coupons);
  assert.equal(JSON.stringify(output).includes(privateCode), false);
  // This is a public projection; the merchant repository retains both entries.
  assert.equal((await coupons.findAllByMerchant(merchantId)).length, 2);
});

for (const publicCoupon of [false, true]) test(`generic nudge offers ${publicCoupon ? "retain ordinary coupons" : "stay empty"} without revealing strategy codes`, async () => {
  const coupons = await repository(publicCoupon);
  let request: NudgeCopyInput | undefined;
  const useCase = new GenerateNudgeUseCase({ generateNudge: async (input: NudgeCopyInput) => { request = input; return "Posso ajudar?"; } } as never,
    { promptExperiment: { findFirst: async () => null }, agentRule: { findFirst: async () => null },
      checkoutSetting: { findUnique: async () => null } } as never, coupons,
    { getRules: async () => ({ maxDiscountPercent: 10, allowFreeShipping: false }) } as never);
  assert.deepEqual(await useCase.execute({ merchant_id: merchantId, trigger: "idle_30_seconds", fallback: "Olá" }), { message: "Posso ajudar?" });
  assert.deepEqual(request?.availableOffers, publicCoupon ? ["cupom WELCOME com 10% de desconto"] : []);
  assert.equal(JSON.stringify(request).includes(privateCode), false);
});
