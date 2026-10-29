/**
 * Cross-sell Intelligence Seed
 *
 * Creates 3 merchants with different product profiles and a single buyer
 * who purchases across all 3 stores. Tests that the LLM receives rich
 * purchase_history context for personalized cross-sell suggestions.
 *
 * Usage:
 *   cd apps/api && npx tsx src/seeds/cross-sell-intelligence-seed.ts
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";

loadDotenv({ path: resolve(process.cwd(), ".env") });
loadDotenv({ path: resolve(process.cwd(), "../../.env"), override: false });

const prisma = createPrismaClient();

const BUYER_GLOBAL_ID = "buyer_cross_sell_intelligence";
const BUYER_EMAIL = "lucas.shopper@example.com";
const BUYER_PHONE = "+5511999887766";
const BUYER_NAME = "Lucas Mendes";

const MERCHANTS = [
  {
    id: "mrc_luxury_bags",
    name: "Bolsas Executivas Premium",
    theme: { accentColor: "#1a1a2e", logoUrl: null },
    products: [
      { sku: "lux_couro_01", title: "Bolsa Couro Italiano Executive", price: 1200_00, category: "luxury-bags" },
      { sku: "lux_couro_02", title: "Pasta Couro Premium Meeting", price: 1500_00, category: "luxury-bags" },
      { sku: "lux_carteira_01", title: "Carteira Slim Couro Safiano", price: 450_00, category: "luxury-accessories" },
      { sku: "lux_cinto_01", title: "Cinto Couro Reversível", price: 380_00, category: "luxury-accessories" },
    ],
    orders: [
      {
        orderId: "ord_lux_001",
        total: 1200_00,
        discount: 0,
        items: [{ sku: "lux_couro_01", title: "Bolsa Couro Italiano Executive", quantity: 1, unitPrice: 1200_00, discountAmount: 0, categoryId: "luxury-bags" }],
        completedAt: new Date("2026-05-15T14:30:00Z")
      },
      {
        orderId: "ord_lux_002",
        total: 1500_00,
        discount: 0,
        items: [{ sku: "lux_couro_02", title: "Pasta Couro Premium Meeting", quantity: 1, unitPrice: 1500_00, discountAmount: 0, categoryId: "luxury-bags" }],
        completedAt: new Date("2026-06-20T10:00:00Z")
      },
    ],
    rules: {
      maxDiscountPercent: 8,
      minimumMarginPercent: 45,
      allowFreeShipping: true,
      freeShippingMinCartValue: 500,
      brandVoice: "consultative",
    }
  },
  {
    id: "mrc_tech_gadgets",
    name: "Tech Gadgets Brasil",
    theme: { accentColor: "#0066ff", logoUrl: null },
    products: [
      { sku: "tech_fone_01", title: "Fone Bluetooth ANC Pro", price: 350_00, category: "electronics-audio" },
      { sku: "tech_charger_01", title: "Carregador MagSafe 3-in-1", price: 200_00, category: "electronics-chargers" },
      { sku: "tech_case_01", title: "Case iPhone Premium Titanium", price: 150_00, category: "electronics-accessories" },
      { sku: "tech_watch_01", title: "Smartwatch Ultra GPS", price: 500_00, category: "electronics-wearables" },
      { sku: "tech_hub_01", title: "USB-C Hub 7-em-1 Aluminum", price: 180_00, category: "electronics-accessories" },
    ],
    orders: [
      {
        orderId: "ord_tech_001",
        total: 200_00,
        discount: 20_00,
        items: [{ sku: "tech_charger_01", title: "Carregador MagSafe 3-in-1", quantity: 1, unitPrice: 200_00, discountAmount: 20_00, categoryId: "electronics-chargers" }],
        completedAt: new Date("2026-04-10T09:15:00Z")
      },
      {
        orderId: "ord_tech_002",
        total: 150_00,
        discount: 15_00,
        items: [{ sku: "tech_case_01", title: "Case iPhone Premium Titanium", quantity: 1, unitPrice: 150_00, discountAmount: 15_00, categoryId: "electronics-accessories" }],
        completedAt: new Date("2026-05-22T16:45:00Z")
      },
      {
        orderId: "ord_tech_003",
        total: 350_00,
        discount: 0,
        items: [{ sku: "tech_fone_01", title: "Fone Bluetooth ANC Pro", quantity: 1, unitPrice: 350_00, discountAmount: 0, categoryId: "electronics-audio" }],
        completedAt: new Date("2026-06-30T11:20:00Z")
      },
    ],
    rules: {
      maxDiscountPercent: 15,
      minimumMarginPercent: 30,
      allowFreeShipping: true,
      freeShippingMinCartValue: 200,
      brandVoice: "friendly",
    }
  },
  {
    id: "mrc_fashion_casual",
    name: "Urban Style Casual",
    theme: { accentColor: "#2d6a4f", logoUrl: null },
    products: [
      { sku: "fash_tshirt_01", title: "T-Shirt Oversized Premium Cotton", price: 120_00, category: "apparel-tops" },
      { sku: "fash_calca_01", title: "Calça Jogger Stretch", price: 180_00, category: "apparel-bottoms" },
      { sku: "fash_tenis_01", title: "Tênis Casual Minimalista", price: 280_00, category: "apparel-shoes" },
      { sku: "fash_jaqueta_01", title: "Jaqueta Bomber Tech", price: 320_00, category: "apparel-outerwear" },
    ],
    orders: [
      {
        orderId: "ord_fash_001",
        total: 180_00,
        discount: 36_00,
        items: [{ sku: "fash_calca_01", title: "Calça Jogger Stretch", quantity: 1, unitPrice: 180_00, discountAmount: 36_00, categoryId: "apparel-bottoms" }],
        completedAt: new Date("2026-03-25T13:00:00Z")
      },
      {
        orderId: "ord_fash_002",
        total: 220_00,
        discount: 44_00,
        items: [
          { sku: "fash_tshirt_01", title: "T-Shirt Oversized Premium Cotton", quantity: 1, unitPrice: 120_00, discountAmount: 24_00, categoryId: "apparel-tops" },
          { sku: "fash_tshirt_01", title: "T-Shirt Oversized Premium Cotton", quantity: 1, unitPrice: 120_00, discountAmount: 24_00, categoryId: "apparel-tops" },
        ],
        completedAt: new Date("2026-05-05T18:30:00Z")
      },
    ],
    rules: {
      maxDiscountPercent: 20,
      minimumMarginPercent: 25,
      allowFreeShipping: true,
      freeShippingMinCartValue: 150,
      brandVoice: "casual",
    }
  }
];

async function main() {
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  Cross-Sell Intelligence Seed");
  console.log("═══════════════════════════════════════════════════════\n");

  // 1. Create buyer account
  console.log("1. Creating buyer account...");
  await prisma.buyerAccount.upsert({
    where: { globalUserId: BUYER_GLOBAL_ID },
    create: {
      globalUserId: BUYER_GLOBAL_ID,
      email: BUYER_EMAIL,
      passwordHash: "$2a$10$seed.only.test.placeholder.password.hash.value",
      displayName: BUYER_NAME,
      phone: BUYER_PHONE,
      createdAt: new Date("2026-03-01T10:00:00Z"),
    },
    update: {
      email: BUYER_EMAIL,
      displayName: BUYER_NAME,
      phone: BUYER_PHONE,
    }
  });
  console.log(`   ✓ Buyer: ${BUYER_NAME} (${BUYER_GLOBAL_ID})`);

  // 2. Create merchants + rules + purchase history + cross-sell promos
  for (const merchant of MERCHANTS) {
    console.log(`\n2. Seeding merchant: ${merchant.name} (${merchant.id})`);

    await prisma.merchant.upsert({
      where: { id: merchant.id },
      create: { id: merchant.id, name: merchant.name, theme: merchant.theme },
      update: { name: merchant.name, theme: merchant.theme }
    });
    console.log("   ✓ Merchant profile");

    await prisma.merchantRule.upsert({
      where: { merchantId: merchant.id },
      create: {
        merchantId: merchant.id,
        maxDiscountPercent: merchant.rules.maxDiscountPercent,
        minimumMarginPercent: merchant.rules.minimumMarginPercent,
        allowFreeShipping: merchant.rules.allowFreeShipping,
        freeShippingMinCartValue: merchant.rules.freeShippingMinCartValue,
        brandVoice: merchant.rules.brandVoice,
        allowShippingDiscount: true,
        allowBonusItem: false,
        allowStackDiscountAndFreeShipping: false,
        couponBoxEnabled: true,
        maxShippingSubsidy: 30,
        maxPartialShippingDiscount: 15,
        offerExpirationMinutes: 20,
        blockedRegions: [],
        quickReplies: {},
        cryptoPayments: { enabled: false }
      },
      update: {
        maxDiscountPercent: merchant.rules.maxDiscountPercent,
        minimumMarginPercent: merchant.rules.minimumMarginPercent,
        allowFreeShipping: merchant.rules.allowFreeShipping,
        freeShippingMinCartValue: merchant.rules.freeShippingMinCartValue,
        brandVoice: merchant.rules.brandVoice,
      }
    });
    console.log("   ✓ Merchant rules");

    // Record purchase history for buyer in this merchant
    for (const order of merchant.orders) {
      await prisma.buyerPurchaseRecord.upsert({
        where: {
          merchantId_orderId: {
            merchantId: merchant.id,
            orderId: order.orderId
          }
        },
        create: {
          merchantId: merchant.id,
          orderId: order.orderId,
          globalUserId: BUYER_GLOBAL_ID,
          currency: "BRL",
          totalAmount: order.total / 100,
          discountAmount: order.discount / 100,
          completedAt: order.completedAt,
          items: order.items,
        },
        update: {
          totalAmount: order.total / 100,
          discountAmount: order.discount / 100,
          items: order.items,
        }
      });
    }
    console.log(`   ✓ ${merchant.orders.length} purchase records for buyer`);

    // Create cross-sell promotions (use trigger Json shape)
    for (let i = 0; i < merchant.products.length - 1; i++) {
      const triggerProduct = merchant.products[i];
      const recommendedProduct = merchant.products[i + 1];
      const promoId = `promo_${merchant.id}_${i}`;
      const triggerShape = {
        sku_in_cart: [triggerProduct.sku],
        category_in_cart: [triggerProduct.category],
        cart_total_above: null,
      };

      await prisma.crossSellPromotion.upsert({
        where: { id: promoId },
        create: {
          id: promoId,
          merchantId: merchant.id,
          name: `${triggerProduct.title} → ${recommendedProduct.title}`,
          status: "active",
          trigger: triggerShape,
          recommendedSkus: [recommendedProduct.sku],
          discountPercent: 10,
          maxDiscountPercent: 15,
          startsAt: new Date("2026-01-01"),
          endsAt: null,
        },
        update: {
          status: "active",
          trigger: triggerShape,
          recommendedSkus: [recommendedProduct.sku],
        }
      });
    }
    console.log(`   ✓ ${merchant.products.length - 1} cross-sell promotions`);
  }

  // Summary
  console.log("\n═══════════════════════════════════════════════════════");
  console.log("  SEED COMPLETE");
  console.log("═══════════════════════════════════════════════════════");
  console.log(`\n  Buyer: ${BUYER_NAME} (${BUYER_GLOBAL_ID})`);
  console.log(`  Email: ${BUYER_EMAIL}`);
  console.log(`\n  Purchase Pattern:`);
  console.log(`    • Luxury Bags:  2 orders, R$ 2.700 (no discounts → sensitivity: LOW)`);
  console.log(`    • Tech Gadgets: 3 orders, R$ 700 (R$35 em descontos → sensitivity: MEDIUM)`);
  console.log(`    • Fashion:      2 orders, R$ 400 (R$80 em descontos → sensitivity: HIGH)`);
  console.log(`\n  Expected LLM Behavior:`);
  console.log(`    When buyer enters Luxury store next:`);
  console.log(`    → Knows they're a premium buyer (R$ 2700 lifetime in luxury)`);
  console.log(`    → Knows they also buy tech (chargers, cases, fones)`);
  console.log(`    → Should suggest premium tech-luxury crossover (carteira couro, cinto)`);
  console.log(`    → Should NOT offer aggressive discounts (low sensitivity in luxury)`);
  console.log(`\n  Test command:`);
  console.log(`    POST /v1/checkout/start with merchant_id=mrc_luxury_bags`);
  console.log(`    Then send chat message and observe agentContext.purchase_history`);
  console.log("");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error("SEED FAILED:", e);
  process.exit(1);
});