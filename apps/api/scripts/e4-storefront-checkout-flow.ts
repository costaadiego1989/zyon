import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaProductPromotionRepository } from "../src/modules/catalog/infrastructure/repositories/prisma-product-promotion.repository.js";
import { CartPromoResolutionService } from "../src/modules/checkout/application/services/cart-promo-resolution.service.js";
import type { Cart } from "@zyon/shared-types";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const MERCHANT = "mrc_marketplace_05";
const SKU = "SKU-DECORACAO-501";
const PRODUCT = "prod_decoracao_05_01";
const BASE_REAIS = 199; // R$199 = 19900 cents

function pass(label: string, cond: boolean, detail = "") {
  console.log(`${cond ? "✅ PASS" : "❌ FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  return cond;
}

async function setActive(kind: "percent" | "fixed" | "price" | "coupon") {
  const all = await prisma.productPromotion.findMany({ where: { merchantId: MERCHANT, productId: PRODUCT } });
  for (const p of all) {
    const isThis =
      (kind === "percent" && p.discountType === "percent") ||
      (kind === "fixed" && p.discountType === "fixed") ||
      (kind === "price" && p.promoPriceInCents != null && !p.couponId && !p.discountType) ||
      (kind === "coupon" && !!p.couponId);
    await prisma.productPromotion.update({ where: { id: p.id }, data: { isActive: isThis } });
  }
}

async function main() {
  const repo = new PrismaProductPromotionRepository(prisma as any);
  const resolution = new CartPromoResolutionService(repo as any);
  let ok = true;

  console.log("\n========== E4: STOREFRONT → CART → CHECKOUT (DB real) ==========\n");

  // ---- SCENARIO A: percent 20% ----
  console.log("--- Scenario A: percent 20% active ---");
  await setActive("percent");
  const cartA: Cart = { currency: "BRL", total: BASE_REAIS, items: [{ sku: SKU, name: "Luminária", price: BASE_REAIS, quantity: 1 }] };
  const resA = await resolution.resolveCartPromos(cartA, MERCHANT);
  ok = pass("cart line price = R$159.20 (20% off 199)", resA.items[0]?.price === 159.2, `got ${resA.items[0]?.price}`) && ok;

  // ---- SCENARIO B: fixed R$15 off ----
  console.log("\n--- Scenario B: fixed R$15 off active ---");
  await setActive("fixed"); // discountValue=1500 cents
  const cartB: Cart = { currency: "BRL", total: BASE_REAIS, items: [{ sku: SKU, name: "Luminária", price: BASE_REAIS, quantity: 1 }] };
  const resB = await resolution.resolveCartPromos(cartB, MERCHANT);
  ok = pass("cart line price = R$184 (199 - 15)", resB.items[0]?.price === 184, `got ${resB.items[0]?.price}`) && ok;

  // ---- SCENARIO C: inline promo price R$150 ----
  console.log("\n--- Scenario C: inline promo price R$150 active ---");
  await setActive("price"); // promoPriceInCents=15000
  const cartC: Cart = { currency: "BRL", total: BASE_REAIS, items: [{ sku: SKU, name: "Luminária", price: BASE_REAIS, quantity: 1 }] };
  const resC = await resolution.resolveCartPromos(cartC, MERCHANT);
  ok = pass("cart line price = R$150 (inline promo price)", resC.items[0]?.price === 150, `got ${resC.items[0]?.price}`) && ok;

  // ---- SCENARIO D: coupon-link = badge only, no price change ----
  console.log("\n--- Scenario D: coupon-link active (badge only) ---");
  await setActive("coupon");
  const cartD: Cart = { currency: "BRL", total: BASE_REAIS, items: [{ sku: SKU, name: "Luminária", price: BASE_REAIS, quantity: 1 }] };
  const resD = await resolution.resolveCartPromos(cartD, MERCHANT);
  ok = pass("cart line price UNCHANGED R$199 (no fabricated discount)", resD.items[0]?.price === BASE_REAIS, `got ${resD.items[0]?.price}`) && ok;

  // ---- SCENARIO E: getDailyDeals reads product-level promo (loja) ----
  console.log("\n--- Scenario E: getDailyDeals (loja) reads product-level promo ---");
  await setActive("percent");
  const now = new Date();
  const promos = await prisma.productPromotion.findMany({
    where: { merchantId: MERCHANT, isActive: true, startsAt: { lte: now }, endsAt: { gt: now } },
    select: { productId: true, variantId: true, categoryId: true, couponId: true, discountType: true, discountValue: true, promoPriceInCents: true },
  });
  const byProduct = new Map(promos.filter((p) => p.productId).map((p) => [p.productId as string, p]));
  const dealPromo = byProduct.get(PRODUCT);
  ok = pass("getDailyDeals matches product-level promo by productId", !!dealPromo && dealPromo.discountType === "percent") && ok;

  // ---- SCENARIO F: multi-line cart, each resolved independently ----
  console.log("\n--- Scenario F: multi-line cart ---");
  await setActive("percent");
  const cartF: Cart = {
    currency: "BRL", total: BASE_REAIS + 50,
    items: [
      { sku: SKU, name: "Luminária", price: BASE_REAIS, quantity: 1 },
      { sku: "SKU-NO-PROMO-XYZ", name: "Outro", price: 50, quantity: 1 },
    ],
  };
  const resF = await resolution.resolveCartPromos(cartF, MERCHANT);
  const line1 = resF.items[0]?.price === 159.2;
  const line2 = resF.items[1]?.price === 50; // no promo → unchanged
  ok = pass("promo line reduced, non-promo line unchanged", line1 && line2, `l1=${resF.items[0]?.price} l2=${resF.items[1]?.price}`) && ok;

  // ---- SCENARIO G: merchant boundary ----
  console.log("\n--- Scenario G: merchant boundary ---");
  const foreign = await repo.findActiveBySku("mrc_other_merchant", SKU);
  ok = pass("cross-merchant lookup returns 0 promos", foreign.length === 0) && ok;

  // ---- SCENARIO H: advanced rule 'compre 2' present + scoped ----
  console.log("\n--- Scenario H: advanced rule 'compre 2' ---");
  const cs = await prisma.checkoutSetting.findFirst({ where: { merchantId: MERCHANT }, select: { advancedRules: true } });
  const rules: any[] = Array.isArray(cs?.advancedRules) ? (cs!.advancedRules as any[]) : [];
  const buy2 = rules.find((r) => r.id === "rule_buy2_15off");
  const scoped = buy2?.conditions?.some((c: any) => c.field === "product_in_cart" && c.value === SKU);
  const qty = buy2?.conditions?.some((c: any) => c.field === "cart_item_count" && c.value === 2);
  ok = pass("'compre 2' rule scoped to product SKU + qty>=2", !!buy2 && scoped && qty) && ok;

  // restore percent active as default
  await setActive("percent");

  console.log("\n========== " + (ok ? "ALL E4 SCENARIOS PASS ✅" : "SOME E4 FAILURES ❌") + " ==========\n");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => { console.error("ERR:", e.message, e.stack); process.exit(1); }).finally(() => prisma.$disconnect());