/**
 * Catalog seed — 10 products, 3 categories, promotions, coupons.
 *
 * Usage: npx tsx src/seeds/catalog-seed.ts
 * Requires DATABASE_URL env var.
 */

import { createPrismaClient } from "../shared/persistence/prisma-client.js";

const prisma = createPrismaClient();
const MERCHANT_ID = process.env.SEED_MERCHANT_ID || "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

async function main() {
  console.log("🌱 Seeding catalog for merchant:", MERCHANT_ID);

  // Ensure merchant has correct store category for seed products
  await prisma.merchant.update({
    where: { id: MERCHANT_ID },
    data: { storeCategory: "fashion" },
  });

  console.log("✓ Merchant category set to fashion");

  // ─── Categories ──────────────────────────────────────────────────────────────

  const categories = [
    { id: "cat_vestuario", name: "Vestuário", slug: "vestuario" },
    { id: "cat_calcados", name: "Calçados", slug: "calcados" },
    { id: "cat_acessorios", name: "Acessórios", slug: "acessorios" },
  ];

  for (const cat of categories) {
    await prisma.productCategory.upsert({
      where: { merchantId_slug: { merchantId: MERCHANT_ID, slug: cat.slug } },
      create: { id: cat.id, merchantId: MERCHANT_ID, name: cat.name, slug: cat.slug },
      update: { name: cat.name },
    });
  }
  console.log("✓ 3 categories");

  // ─── Products ────────────────────────────────────────────────────────────────

  const products = [
    { id: "prod_001", name: "Camiseta Oversized Preta", desc: "Camiseta 100% algodão, corte oversized, tecido premium 180g", catId: "cat_vestuario", sku: "CAM-OVS-P-001", price: 8990, cost: 3500, stock: 50, weight: 280, length: 35, width: 25, height: 3, attrs: { size: "M", color: "Preto" } },
    { id: "prod_002", name: "Calça Cargo Bege", desc: "Calça cargo com bolsos laterais, tecido ripstop resistente", catId: "cat_vestuario", sku: "CAL-CRG-B-001", price: 17990, cost: 7000, stock: 30, weight: 550, length: 40, width: 30, height: 5, attrs: { size: "42", color: "Bege" } },
    { id: "prod_003", name: "Tênis Runner Pro", desc: "Tênis esportivo com amortecimento em gel, sola antiderrapante", catId: "cat_calcados", sku: "TEN-RUN-P-001", price: 34990, cost: 15000, stock: 20, weight: 750, length: 33, width: 22, height: 14, attrs: { size: "42", color: "Preto/Verde" } },
    { id: "prod_004", name: "Jaqueta Corta-Vento", desc: "Jaqueta impermeável com capuz, ideal para trilhas e dias chuvosos", catId: "cat_vestuario", sku: "JAQ-CVE-C-001", price: 24990, cost: 10000, stock: 15, weight: 420, length: 45, width: 35, height: 6, attrs: { size: "G", color: "Cinza" } },
    { id: "prod_005", name: "Mochila Urban 25L", desc: "Mochila com compartimento para notebook 15pol, alças acolchoadas", catId: "cat_acessorios", sku: "MOC-URB-P-001", price: 19990, cost: 8000, stock: 25, weight: 850, length: 50, width: 32, height: 18, attrs: { capacity: "25L", color: "Preto" } },
    { id: "prod_006", name: "Boné Snapback Logo", desc: "Boné aba reta com bordado frontal, ajuste snapback", catId: "cat_acessorios", sku: "BON-SNP-B-001", price: 5990, cost: 2000, stock: 100, weight: 120, length: 20, width: 18, height: 12, attrs: { color: "Preto" } },
    { id: "prod_007", name: "Meias Pack x3 Cano Alto", desc: "Kit 3 pares meias cano alto, algodão com elastano, antifúngica", catId: "cat_vestuario", sku: "MEI-PK3-B-001", price: 4990, cost: 1500, stock: 200, weight: 150, length: 22, width: 15, height: 4, attrs: { size: "39-43" } },
    { id: "prod_008", name: "Shorts Training Dry-Fit", desc: "Shorts esportivo com tecnologia dry-fit, bolso com zíper", catId: "cat_vestuario", sku: "SHR-TRN-P-001", price: 7990, cost: 3000, stock: 40, weight: 200, length: 30, width: 25, height: 3, attrs: { size: "M", color: "Preto" } },
    { id: "prod_009", name: "Óculos de Sol Polarizado", desc: "Lentes polarizadas UV400, armação em acetato premium", catId: "cat_acessorios", sku: "OCL-POL-P-001", price: 14990, cost: 5000, stock: 35, weight: 85, length: 16, width: 7, height: 5, attrs: { color: "Preto Fosco" } },
    { id: "prod_010", name: "Relógio Digital Minimal", desc: "Relógio digital com pulseira em silicone, resistente a água 5ATM", catId: "cat_acessorios", sku: "REL-DIG-P-001", price: 12990, cost: 4500, stock: 18, weight: 95, length: 12, width: 10, height: 8, attrs: { color: "Preto" } },
  ];

  for (const p of products) {
    const variantId = `var_${p.id.split("_")[1]}`;
    await prisma.product.upsert({
      where: { id: p.id },
      create: { id: p.id, merchantId: MERCHANT_ID, name: p.name, description: p.desc, categoryId: p.catId, isActive: true },
      update: { name: p.name, description: p.desc, categoryId: p.catId },
    });
    await prisma.productVariant.upsert({
      where: { productId_sku: { productId: p.id, sku: p.sku } },
      create: { id: variantId, productId: p.id, sku: p.sku, attributes: p.attrs, isActive: true, weightGrams: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height },
      update: { attributes: p.attrs, weightGrams: p.weight, lengthCm: p.length, widthCm: p.width, heightCm: p.height },
    });
    await prisma.productPrice.upsert({
      where: { variantId },
      create: { variantId, basePriceInCents: p.price, costInCents: p.cost, taxPercent: 0, currency: "BRL" },
      update: { basePriceInCents: p.price, costInCents: p.cost },
    });
    await prisma.productStock.upsert({
      where: { variantId_warehouseId: { variantId, warehouseId: "default" } },
      create: { variantId, quantity: p.stock, reserved: 0, warehouseId: "default" },
      update: { quantity: p.stock },
    });
  }
  console.log("✓ 10 products with variants, prices, stock");

  // ─── Extra Variants (sizes/colors) ──────────────────────────────────────────

  type ExtraVariant = { id: string; productId: string; sku: string; attrs: Record<string, string>; weight: number; length: number; width: number; height: number; price: number; cost: number; stock: number };

  const extraVariants: ExtraVariant[] = [
    // Camiseta Oversized Preta — sizes G, GG (M already exists as var_001)
    { id: "var_001_g", productId: "prod_001", sku: "CAM-OVS-P-G", attrs: { size: "G", color: "Preto" }, weight: 300, length: 36, width: 26, height: 3, price: 8990, cost: 3500, stock: 35 },
    { id: "var_001_gg", productId: "prod_001", sku: "CAM-OVS-P-GG", attrs: { size: "GG", color: "Preto" }, weight: 320, length: 37, width: 27, height: 3, price: 8990, cost: 3500, stock: 20 },

    // Tênis Runner Pro — sizes 40, 41, 43 (42 already exists as var_003)
    { id: "var_003_40", productId: "prod_003", sku: "TEN-RUN-P-40", attrs: { size: "40", color: "Preto/Verde" }, weight: 730, length: 32, width: 21, height: 14, price: 34990, cost: 15000, stock: 15 },
    { id: "var_003_41", productId: "prod_003", sku: "TEN-RUN-P-41", attrs: { size: "41", color: "Preto/Verde" }, weight: 740, length: 32, width: 22, height: 14, price: 34990, cost: 15000, stock: 18 },
    { id: "var_003_43", productId: "prod_003", sku: "TEN-RUN-P-43", attrs: { size: "43", color: "Preto/Verde" }, weight: 770, length: 34, width: 23, height: 14, price: 34990, cost: 15000, stock: 12 },

    // Óculos de Sol Polarizado — color variants (Preto Fosco already exists as var_009)
    { id: "var_009_azul", productId: "prod_009", sku: "OCL-POL-A-001", attrs: { color: "Azul Marinho" }, weight: 85, length: 16, width: 7, height: 5, price: 14990, cost: 5000, stock: 25 },
  ];

  for (const v of extraVariants) {
    await prisma.productVariant.upsert({
      where: { productId_sku: { productId: v.productId, sku: v.sku } },
      create: { id: v.id, productId: v.productId, sku: v.sku, attributes: v.attrs, isActive: true, weightGrams: v.weight, lengthCm: v.length, widthCm: v.width, heightCm: v.height },
      update: { attributes: v.attrs, weightGrams: v.weight, lengthCm: v.length, widthCm: v.width, heightCm: v.height },
    });
    await prisma.productPrice.upsert({
      where: { variantId: v.id },
      create: { variantId: v.id, basePriceInCents: v.price, costInCents: v.cost, taxPercent: 0, currency: "BRL" },
      update: { basePriceInCents: v.price, costInCents: v.cost },
    });
    await prisma.productStock.upsert({
      where: { variantId_warehouseId: { variantId: v.id, warehouseId: "default" } },
      create: { variantId: v.id, quantity: v.stock, reserved: 0, warehouseId: "default" },
      update: { quantity: v.stock },
    });
  }
  console.log("✓ 6 extra variants (Camiseta G/GG, Tênis 40/41/43, Óculos Azul Marinho)");

  // ─── Product Promotions ──────────────────────────────────────────────────────

  const now = new Date();
  const in30Days = new Date(now.getTime() + 30 * 24 * 3600_000);

  const promos = [
    { id: "promo_001", variantId: "var_001", discountType: "percent", discountValue: 20, promoPriceCents: 7192 },
    { id: "promo_002", variantId: "var_003", discountType: "fixed", discountValue: 5000, promoPriceCents: 29990 },
    { id: "promo_003", variantId: "var_005", discountType: "percent", discountValue: 15, promoPriceCents: 16992 },
    { id: "promo_004", variantId: "var_008", discountType: "percent", discountValue: 30, promoPriceCents: 5593 },
  ];

  for (const promo of promos) {
    await prisma.productPromotion.upsert({
      where: { id: promo.id },
      create: {
        id: promo.id,
        merchantId: MERCHANT_ID,
        variantId: promo.variantId,
        discountType: promo.discountType,
        discountValue: promo.discountValue,
        promoPriceInCents: promo.promoPriceCents,
        isActive: true,
        startsAt: now,
        endsAt: in30Days,
      },
      update: { isActive: true, endsAt: in30Days, promoPriceInCents: promo.promoPriceCents, discountValue: promo.discountValue },
    });
  }
  console.log("✓ 4 variant promotions (20-30% off, 30 days)");

  // Category promotion: 15% off all Acessórios
  await prisma.productPromotion.upsert({
    where: { id: "promo_cat_acessorios" },
    create: {
      id: "promo_cat_acessorios",
      merchantId: MERCHANT_ID,
      categoryId: "cat_acessorios",
      discountType: "percent",
      discountValue: 15,
      isActive: true,
      startsAt: now,
      endsAt: in30Days,
    },
    update: { isActive: true, endsAt: in30Days },
  });
  console.log("✓ 1 category promotion (Acessórios 15% off)");

  // ─── Coupons ─────────────────────────────────────────────────────────────────

  const coupons = [
    {
      id: "coupon_desconto10",
      code: "DESCONTO10",
      discountType: "percent",
      discountValue: 10,
      minCartTotal: 5000,
      maxUsages: 100,
      maxPerBuyer: 1,
    },
    {
      id: "coupon_20reais",
      code: "20REAIS",
      discountType: "fixed",
      discountValue: 2000,
      minCartTotal: 10000,
      maxUsages: 50,
      maxPerBuyer: 2,
    },
    {
      id: "coupon_fretegratis",
      code: "FRETEGRATIS",
      discountType: "shipping_free",
      discountValue: 0,
      minCartTotal: 15000,
      freeShippingMinCartTotal: 15000,
      maxUsages: 200,
      maxPerBuyer: 3,
    },
    {
      id: "coupon_frete50",
      code: "FRETE50",
      discountType: "shipping_percent",
      discountValue: 50,
      minCartTotal: null,
      maxUsages: null,
      maxPerBuyer: 1,
    },
  ];

  for (const c of coupons) {
    await prisma.coupon.upsert({
      where: { id: c.id },
      create: {
        id: c.id,
        merchantId: MERCHANT_ID,
        code: c.code,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minCartTotal: c.minCartTotal,
        freeShippingMinCartTotal: (c as any).freeShippingMinCartTotal ?? null,
        maxUsages: c.maxUsages,
        maxPerBuyer: c.maxPerBuyer,
        minPerBuyer: null,
        usagesCount: 0,
        status: "active",
        startsAt: now,
        endsAt: in30Days,
      },
      update: { status: "active", endsAt: in30Days },
    });
  }
  console.log("✓ 4 coupons (percent, fixed, shipping_free, shipping_percent)");

  console.log("\n🎉 Seed complete!");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
