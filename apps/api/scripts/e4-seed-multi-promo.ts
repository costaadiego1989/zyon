import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) });
const M = "mrc_marketplace_05";

async function main() {
  const now = new Date();
  const ends = new Date(Date.now() + 30 * 24 * 3600 * 1000);

  // Ensure plan = scale so advanced rules feature is available
  const sub = await p.merchantBillingSubscription.findFirst({ where: { merchantId: M } });
  if (sub) {
    await p.merchantBillingSubscription.update({ where: { id: sub.id }, data: { planKey: "scale" } });
    console.log("PLAN set → scale (existing sub", sub.id, ")");
  } else {
    console.log("NO_SUBSCRIPTION — advanced rules may gate; simple promo still works");
  }

  const products = [
    { id: "prod_decoracao_05_01", sku: "SKU-DECORACAO-501", kind: "percent" as const },
    { id: "prod_decoracao_05_02", sku: "SKU-DECORACAO-502", kind: "fixed" as const },
    { id: "prod_decoracao_05_03", sku: "SKU-DECORACAO-503", kind: "price" as const },
    { id: "prod_decoracao_05_04", sku: "SKU-DECORACAO-504", kind: "coupon" as const },
  ];

  // clean previous test promos on these products
  await p.productPromotion.deleteMany({ where: { merchantId: M, productId: { in: products.map((x) => x.id) } } });

  // coupon for coupon-link
  const coupon = await p.coupon.upsert({
    where: { merchantId_code: { merchantId: M, code: "TESTPROMO10" } },
    create: { id: `cpn_test_${Date.now()}`, merchantId: M, code: "TESTPROMO10", discountType: "percent", discountValue: 10, status: "ACTIVE", startsAt: now, endsAt: ends },
    update: { status: "ACTIVE" },
  });

  for (const prod of products) {
    const base: any = { merchantId: M, productId: prod.id, isActive: true, startsAt: now, endsAt: ends };
    if (prod.kind === "percent") { base.discountType = "percent"; base.discountValue = 20; }
    else if (prod.kind === "fixed") { base.discountType = "fixed"; base.discountValue = 2000; } // R$20 in cents
    else if (prod.kind === "price") { base.promoPriceInCents = 7000; } // R$70
    else if (prod.kind === "coupon") { base.couponId = coupon.id; }
    const created = await p.productPromotion.create({ data: base });
    console.log(`PROMO ${prod.kind.toUpperCase()} on ${prod.sku}:`, created.id);
  }

  // Advanced rule "compre 2 Almofada → 15% off" scoped to product_in_cart(SKU-504)
  const cs = await p.checkoutSetting.findFirst({ where: { merchantId: M } });
  const existing: any[] = Array.isArray((cs as any)?.advancedRules) ? ((cs as any).advancedRules as any[]) : [];
  const rule = {
    id: "rule_buy2_almofada",
    enabled: true,
    priority: 10,
    conditions: [
      { field: "cart_item_count", operator: "gte", value: 2 },
      { field: "product_in_cart", operator: "contains", value: "SKU-DECORACAO-504" },
    ],
    action: { type: "offer_discount", params: { percent: 15, maxDiscountReais: 500 } },
  };
  const merged = [...existing.filter((r: any) => r.id !== rule.id), rule];
  if (cs) {
    await p.checkoutSetting.update({ where: { merchantId: M }, data: { advancedRules: merged as any } });
  } else {
    await p.checkoutSetting.create({ data: { merchantId: M, mode: "reactive", widgetBehavior: {}, interventionPolicy: {}, triggerRules: {}, suppressionRules: {}, handoff: {}, advancedRules: merged as any } });
  }
  console.log("ADVANCED_RULE compre-2-almofada added");

  console.log("\nSEED DONE. Store slug: casa-decorao");
}

main().catch((e) => { console.error("ERR:", e.message); process.exit(1); }).finally(() => p.$disconnect());