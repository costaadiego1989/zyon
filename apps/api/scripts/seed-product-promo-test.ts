import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const p = new PrismaClient({ adapter });

async function main() {
  // Find an existing merchant (any) and its first product, or skip if not present
  const merchant = await p.merchant.findFirst({ select: { id: true, name: true } });
  if (!merchant) {
    console.log("NO_MERCHANT_IN_DB");
    return;
  }
  console.log("MERCHANT:", merchant.id, merchant.name);

  // Find first product + variant for the merchant (or any if none)
  let product = await p.product.findFirst({
    where: { merchantId: merchant.id },
    select: {
      id: true, name: true, variants: { select: { id: true, sku: true, price: true } }
    },
  });
  if (!product) {
    console.log("NO_PRODUCT_FOR_MERCHANT");
    return;
  }
  const variant = product.variants[0];
  if (!variant) {
    console.log("NO_VARIANT_FOR_PRODUCT");
    return;
  }
  console.log("PRODUCT:", product.id, product.name, "SKU:", variant.sku, "BASE_CENTS:", (variant.price as any)?.basePriceInCents);

  const now = new Date();
  const ends = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  // Clean previous test promos
  await p.productPromotion.deleteMany({
    where: { merchantId: merchant.id, productId: product.id },
  });

  // 1) Percent promo (20% off)
  const p1 = await p.productPromotion.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      discountType: "percent",
      discountValue: 20,
      isActive: true,
      startsAt: now,
      endsAt: ends,
    },
  });
  console.log("PROMO_PERCENT:", p1.id);

  // 2) Fixed promo (1500 cents off) — created INACTIVE (toggle to test later)
  const p2 = await p.productPromotion.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      discountType: "fixed",
      discountValue: 1500,
      isActive: false,
      startsAt: now,
      endsAt: ends,
    },
  });
  console.log("PROMO_FIXED (inactive):", p2.id);

  // 3) Inline price promo — created INACTIVE
  const p3 = await p.productPromotion.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      promoPriceInCents: 15000,
      isActive: false,
      startsAt: now,
      endsAt: ends,
    },
  });
  console.log("PROMO_PRICE (inactive):", p3.id);

  // 4) Coupon-link promo (creates a coupon first) — created INACTIVE
  const coupon = await p.coupon.upsert({
    where: { merchantId_code: { merchantId: merchant.id, code: "TESTPROMO10" } },
    create: {
      id: `cpn_test_${Date.now()}`,
      merchantId: merchant.id,
      code: "TESTPROMO10",
      discountType: "percent",
      discountValue: 10,
      status: "ACTIVE",
      startsAt: now,
      endsAt: ends,
    },
    update: {},
  });
  const p4 = await p.productPromotion.create({
    data: {
      merchantId: merchant.id,
      productId: product.id,
      couponId: coupon.id,
      isActive: false,
      startsAt: now,
      endsAt: ends,
    },
  });
  console.log("PROMO_COUPON_LINK (inactive):", p4.id, "COUPON:", coupon.code);

  // 5) Advanced rule "compre 2" — buy 2 get 15% off
  // Load current checkout-settings.advancedRules
  const cs = await p.checkoutSetting.findFirst({ where: { merchantId: merchant.id } });
  const existing: any[] = Array.isArray((cs as any)?.advancedRules) ? ((cs as any).advancedRules as any[]) : [];

  // New rule scoped to product via product_in_cart(SKU), cart_item_count >= 2, offer_discount 15%
  const newRule = {
    id: "rule_buy2_15off",
    enabled: true,
    priority: 10,
    conditions: [
      { field: "cart_item_count", operator: "gte", value: 2 },
      { field: "product_in_cart", operator: "contains", value: variant.sku },
    ],
    action: { type: "offer_discount", params: { percent: 15, maxDiscountReais: 500 } },
  };

  const merged = [...existing.filter((r: any) => r.id !== newRule.id), newRule];
  if (cs) {
    await p.checkoutSetting.update({
      where: { merchantId: merchant.id },
      data: { advancedRules: merged as any },
    });
  } else {
    await p.checkoutSetting.create({
      data: {
        merchantId: merchant.id,
        mode: "reactive",
        widgetBehavior: {},
        interventionPolicy: {},
        triggerRules: {},
        suppressionRules: {},
        handoff: {},
        advancedRules: merged as any,
      },
    });
  }
  console.log("RULE_BUY2_ADDED");

  // Dump state for inspection
  const promos = await p.productPromotion.findMany({
    where: { merchantId: merchant.id, productId: product.id },
  });
  console.log("FINAL_PROMOS:", JSON.stringify(promos.map(x => ({
    id: x.id,
    kind: x.couponId ? "coupon-link" : x.discountType === "percent" ? "percent" : x.discountType === "fixed" ? "fixed" : "price",
    discountType: x.discountType,
    discountValue: x.discountValue,
    promoPriceInCents: x.promoPriceInCents,
    couponId: x.couponId,
    isActive: x.isActive,
  })), null, 2));
}

main().catch(e => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());