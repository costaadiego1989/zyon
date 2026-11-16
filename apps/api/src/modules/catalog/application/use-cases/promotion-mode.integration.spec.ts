import assert from "node:assert/strict";
import test, { after, type TestContext } from "node:test";
import { randomUUID } from "node:crypto";
import { createPrismaClient } from "../../../../shared/persistence/prisma-client.js";
import { PrismaProductPromotionRepository } from "../../infrastructure/repositories/prisma-product-promotion.repository.js";
import { UpdateProductPromotionUseCase } from "./update-product-promotion.use-case.js";
import { selectBestProductPromotion } from "../../domain/services/best-product-promotion.service.js";
import { ProductPromotionEntity } from "../../domain/entities/product-promotion.entity.js";

const db = createPrismaClient("postgresql://postgres@127.0.0.1:15565/athom_qa");
after(async () => { await db.$disconnect(); });
const startsAt = new Date("2026-01-01"), endsAt = new Date("2030-01-01");
async function fixture(t: TestContext) {
  const merchantId = "qa_athom_promo_" + randomUUID(), productId = "qa-product-" + randomUUID();
  await db.merchant.create({ data: { id: merchantId, name: "Owned promotion QA" } });
  await db.product.create({ data: { id: productId, merchantId, name: "Owned product" } });
  t.after(async () => {
    assert.ok(merchantId.startsWith("qa_athom_promo_"));
    await db.productPromotion.deleteMany({ where: { merchantId } }); await db.product.deleteMany({ where: { merchantId } }); await db.merchant.deleteMany({ where: { id: merchantId } });
  });
  const repository = new PrismaProductPromotionRepository(db), useCase = new UpdateProductPromotionUseCase(repository);
  const promotion = await repository.create({ merchantId, productId, discountType: "percent", discountValue: 10, isActive: true, startsAt, endsAt });
  const update = (data: any) => useCase.execute({ id: promotion.id, merchantId, data });
  const select = (value: any) => selectBestProductPromotion({ merchantId, productId, variantId: "qa-variant", baseUnitPriceCents: 5000, now: new Date("2026-11-16"), promotions: [value] });
  return { merchantId, productId, repository, useCase, promotion, update, select };
}
test("switches percent to promotional price and canonical pricing applies4750cents", async t => {
  const f = await fixture(t); await f.update({ promoPriceInCents: 4750 });
  const saved = await f.repository.getById(f.promotion.id, f.merchantId);
  assert.equal(saved!.discountType, null); assert.equal(saved!.discountValue, null); assert.equal(saved!.couponId, null); assert.equal(saved!.promoPriceInCents, 4750);
  assert.equal(f.select(saved).unitPriceCents, 4750);
  const fixed = await f.update({ discountType: "fixed", discountValue: 500 });
  assert.equal(fixed.promoPriceInCents, null); assert.equal(fixed.discountType, "fixed"); assert.equal(fixed.discountValue, 500); assert.equal(f.select(fixed).unitPriceCents, 4500);
});
test("explicit nulls clear previous values and switching to coupon retains its association", async t => {
  const f = await fixture(t);
  const coupon = await f.update({ couponId: "owned-coupon", discountType: null, discountValue: null, promoPriceInCents: null });
  assert.equal(coupon.couponId, "owned-coupon"); assert.equal(coupon.discountType, null); assert.equal(coupon.discountValue, null);
  assert.deepEqual(f.select(coupon).couponIds, ["owned-coupon"]);
  const percent = await f.update({ couponId: null, promoPriceInCents: null, discountType: "percent", discountValue: 0 });
  assert.equal(percent.couponId, null); assert.equal(percent.discountValue, 0); assert.equal(f.select(percent).unitPriceCents, 5000);
});
test("window and active-only patches preserve the existing descriptor", async t => {
  const f = await fixture(t);
  const paused = await f.update({ isActive: false }); assert.equal(paused.isActive, false); assert.equal(paused.discountType, "percent"); assert.equal(paused.discountValue, 10);
  const dated = await f.update({ endsAt: new Date("2031-01-01") }); assert.equal(dated.discountType, "percent"); assert.equal(dated.discountValue, 10); assert.equal(dated.promoPriceInCents, null);
});
test("explicit mixed descriptor patch rejects without writing", async t => {
  const f = await fixture(t);
  await assert.rejects(f.update({ discountType: "percent", discountValue: 10, promoPriceInCents: 4750 }), /promotion_/);
  const saved = await f.repository.getById(f.promotion.id, f.merchantId); assert.equal(saved!.discountType, "percent"); assert.equal(saved!.promoPriceInCents, null); assert.equal(f.select(saved).unitPriceCents, 4500);
});
for (const patch of [{ discountValue: NaN }, { discountValue: 12.5 }, { discountType: "fixed", discountValue: 0.5 }, { promoPriceInCents: 12.5 }, { discountType: "invalid", discountValue: 10 }]) {
  test(`invalid canonical descriptor ${JSON.stringify(patch)} is rejected before persistence`, async t => {
    const f = await fixture(t); await assert.rejects(f.update(patch), /promotion_/);
    const saved = await f.repository.getById(f.promotion.id, f.merchantId); assert.equal(saved!.discountType, "percent"); assert.equal(saved!.discountValue, 10); assert.equal(saved!.promoPriceInCents, null);
  });
}
test("new ambiguous promotion descriptors are rejected by the shared entity", () => {
  assert.throws(() => ProductPromotionEntity.create({ merchantId: "merchant", discountType: "percent", discountValue: 10, promoPriceInCents: 4750, isActive: true, startsAt, endsAt }), /promotion_/);
});

test("invalid coupon identifiers never replace the persisted canonical promotion", async t => {
  const f = await fixture(t);
  for (const couponId of ["", " \t", "x".repeat(192), "invalid\0coupon", "\uD800"]) {
    await assert.rejects(f.update({ couponId }), /promotion_invalid_coupon/);
    const saved = await f.repository.getById(f.promotion.id, f.merchantId);
    assert.deepEqual([saved!.discountType, saved!.discountValue, saved!.promoPriceInCents, saved!.couponId], ["percent", 10, null, null]);
    assert.equal(f.select(saved).unitPriceCents, 4500);
  }
  const couponId = "x".repeat(191);
  const valid = await f.update({ couponId });
  assert.equal(valid.couponId, couponId); assert.deepEqual(f.select(valid).couponIds, [couponId]);
});

for (const first of ["price", "inline"] as const) {
  test(`concurrent promotion mode patches retain a complete descriptor when${first} writes first`, async t => {
    const f = await fixture(t);
    let reads = 0, releaseReads!: () => void, releaseFirst!: () => void;
    const bothRead = new Promise<void>(resolve => { releaseReads = resolve; });
    const firstWritten = new Promise<void>(resolve => { releaseFirst = resolve; });
    const synchronized = {
      getById: async (id: string, merchantId: string) => {
        const value = await f.repository.getById(id, merchantId);
        if (++reads === 2) releaseReads(); await bothRead; return value;
      },
      update: async (id: string, merchantId: string, data: any) => {
        const isFirst = first === "price" ? data.promoPriceInCents === 2000 : data.discountValue === 20;
        if (isFirst) { try { return await f.repository.update(id, merchantId, data); } finally { releaseFirst(); } }
        await firstWritten; return f.repository.update(id, merchantId, data);
      },
    };
    const service = new UpdateProductPromotionUseCase(synchronized as never);
    await Promise.all([service.execute({ id: f.promotion.id, merchantId: f.merchantId, data: { promoPriceInCents: 2000 } }),
      service.execute({ id: f.promotion.id, merchantId: f.merchantId, data: { discountValue: 20 } })]);
    const saved = await f.repository.getById(f.promotion.id, f.merchantId);
    assert.deepEqual([saved!.discountType, saved!.discountValue, saved!.promoPriceInCents, saved!.couponId],
      first === "price" ? ["percent", 20, null, null] : [null, null, 2000, null]);
    assert.equal(f.select(saved).unitPriceCents, first === "price" ? 4000 : 2000);
  });
}
