import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaProductPromotionRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-product-promotion.repository.js";
import { resolveEffectiveUnitPrice, type ActivePromotion } from "../src/modules/catalog/domain/services/product-price-resolver.service.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MERCHANT = "mrc_marketplace_05";
const SKU = "SKU-DECORACAO-501";
const BASE_CENTS = 19900;

function toDescriptor(promo: any): ActivePromotion | undefined {
  if (promo.couponId) return { kind: "coupon", couponId: promo.couponId };
  if (promo.discountType === "percent") return { kind: "inline_percent", percent: promo.discountValue ?? 0 };
  if (promo.discountType === "fixed") return { kind: "inline_fixed", amountCents: promo.discountValue ?? 0 };
  if (promo.promoPriceInCents != null) return { kind: "inline_price", promoPriceCents: promo.promoPriceInCents };
  return undefined;
}

async function main() {
  const repo = new PrismaProductPromotionRepository(prisma as any);

  console.log("=== TEST 1: findActiveBySku (percent 20% active) ===");
  const active = await repo.findActiveBySku(MERCHANT, SKU);
  console.log("active promos found:", active.length);
  active.forEach((p) => console.log("  →", p.discountType ?? (p.couponId ? "coupon" : "price"), "val:", p.discountValue, "active:", p.isActive));

  console.log("\n=== TEST 2: resolveEffectiveUnitPrice ===");
  if (active[0]) {
    const desc = toDescriptor(active[0]);
    const resolved = resolveEffectiveUnitPrice(BASE_CENTS, desc);
    console.log("base:", BASE_CENTS, "→ resolved:", JSON.stringify(resolved));
    console.log("EXPECTED: unitPriceCents=15920 (19900 - 20%), discountPercent=20");
    console.log(resolved.unitPriceCents === 15920 ? "  ✅ PASS" : `  ❌ FAIL got ${resolved.unitPriceCents}`);
  }

  console.log("\n=== TEST 3: cross-merchant boundary ===");
  const otherMerchant = await repo.findActiveBySku("mrc_nonexistent_zzz", SKU);
  console.log("promos for wrong merchant:", otherMerchant.length, otherMerchant.length === 0 ? "✅ PASS (isolated)" : "❌ FAIL");

  console.log("\n=== TEST 4: toggle scenarios (activate fixed, deactivate percent) ===");
  const all = await prisma.productPromotion.findMany({ where: { merchantId: MERCHANT, productId: "prod_decoracao_05_01" } });
  const percentP = all.find((x) => x.discountType === "percent");
  const fixedP = all.find((x) => x.discountType === "fixed");
  if (percentP && fixedP) {
    await prisma.productPromotion.update({ where: { id: percentP.id }, data: { isActive: false } });
    await prisma.productPromotion.update({ where: { id: fixedP.id }, data: { isActive: true } });
    const nowActive = await repo.findActiveBySku(MERCHANT, SKU);
    const desc = nowActive[0] ? toDescriptor(nowActive[0]) : undefined;
    const resolved = resolveEffectiveUnitPrice(BASE_CENTS, desc);
    console.log("fixed 1500 off:", BASE_CENTS, "→", resolved.unitPriceCents, "EXPECTED 18400");
    console.log(resolved.unitPriceCents === 18400 ? "  ✅ PASS" : `  ❌ FAIL got ${resolved.unitPriceCents}`);
    // restore percent active
    await prisma.productPromotion.update({ where: { id: fixedP.id }, data: { isActive: false } });
    await prisma.productPromotion.update({ where: { id: percentP.id }, data: { isActive: true } });
  }

  console.log("\n=== TEST 5: coupon-link = badge only (no price change) ===");
  const all2 = await prisma.productPromotion.findMany({ where: { merchantId: MERCHANT, productId: "prod_decoracao_05_01" } });
  const percentP2 = all2.find((x) => x.discountType === "percent");
  const couponP = all2.find((x) => x.couponId);
  if (percentP2 && couponP) {
    await prisma.productPromotion.update({ where: { id: percentP2.id }, data: { isActive: false } });
    await prisma.productPromotion.update({ where: { id: couponP.id }, data: { isActive: true } });
    const nowActive = await repo.findActiveBySku(MERCHANT, SKU);
    const desc = nowActive[0] ? toDescriptor(nowActive[0]) : undefined;
    const resolved = resolveEffectiveUnitPrice(BASE_CENTS, desc);
    console.log("coupon-link:", BASE_CENTS, "→", resolved.unitPriceCents, "badge:", JSON.stringify(resolved.couponBadge));
    console.log(resolved.unitPriceCents === BASE_CENTS && resolved.couponBadge ? "  ✅ PASS (no fabricated discount, badge present)" : "  ❌ FAIL");
    // restore
    await prisma.productPromotion.update({ where: { id: couponP.id }, data: { isActive: false } });
    await prisma.productPromotion.update({ where: { id: percentP2.id }, data: { isActive: true } });
  }

  console.log("\n=== TEST 6: advanced rule 'compre 2' present in checkout-settings ===");
  const cs = await prisma.checkoutSetting.findFirst({ where: { merchantId: MERCHANT }, select: { advancedRules: true } });
  const rules: any[] = Array.isArray(cs?.advancedRules) ? (cs!.advancedRules as any[]) : [];
  const buy2 = rules.find((r) => r.id === "rule_buy2_15off");
  console.log("rule_buy2_15off found:", !!buy2);
  if (buy2) {
    const hasQty = buy2.conditions.some((c: any) => c.field === "cart_item_count" && c.value === 2);
    const hasSku = buy2.conditions.some((c: any) => c.field === "product_in_cart" && c.value === SKU);
    console.log("  cart_item_count>=2:", hasQty, "| product_in_cart(SKU):", hasSku);
    console.log(hasQty && hasSku ? "  ✅ PASS (scoped to product)" : "  ❌ FAIL");
  }
}

main().catch((e) => { console.error("ERR:", e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());