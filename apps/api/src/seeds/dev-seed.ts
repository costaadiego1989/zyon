/**
 * Dev seed — configures one merchant tenant with realistic settings for testing:
 *   - Merchant profile + merchant rules (discounts, free shipping, cross-sell)
 *   - Agent rules (identity + guardrails)
 *   - Checkout settings (widget behavior, trigger rules)
 *   - Prints curl commands to create in-memory cross-sell promotions via API
 *
 * Usage:
 *   MERCHANT_ID=mrc_xxx BASE_URL=http://localhost:3000 npx tsx src/seeds/dev-seed.ts
 *
 * Requires DATABASE_URL env var (same as the API).
 */
import { PrismaClient } from "@prisma/client";

const MERCHANT_ID = process.env.MERCHANT_ID ?? "mrc_dev_seed";
const MERCHANT_NAME = process.env.MERCHANT_NAME ?? "Bolsas Executivas Demo";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const prisma = new PrismaClient();

async function main() {
  console.log(`\nSeeding tenant: ${MERCHANT_ID} (${MERCHANT_NAME})`);

  // 1. Merchant profile
  await prisma.merchant.upsert({
    where: { id: MERCHANT_ID },
    create: {
      id: MERCHANT_ID,
      name: MERCHANT_NAME,
      theme: {
        accentColor: "#1a1a2e",
        logoUrl: null
      }
    },
    update: {
      name: MERCHANT_NAME,
      theme: {
        accentColor: "#1a1a2e",
        logoUrl: null
      }
    }
  });
  console.log("✓ Merchant upserted");

  // 2. Merchant rules
  await prisma.merchantRule.upsert({
    where: { merchantId: MERCHANT_ID },
    create: {
      merchantId: MERCHANT_ID,
      maxDiscountPercent: 12,
      minimumMarginPercent: 35,
      allowFreeShipping: true,
      allowShippingDiscount: true,
      allowBonusItem: false,
      allowStackDiscountAndFreeShipping: false,
      couponBoxEnabled: true,
      freeShippingMinCartValue: 200,
      maxShippingSubsidy: 25,
      maxPartialShippingDiscount: 15,
      offerExpirationMinutes: 20,
      blockedRegions: [],
      brandVoice: "consultative"
    },
    update: {
      maxDiscountPercent: 12,
      minimumMarginPercent: 35,
      allowFreeShipping: true,
      allowShippingDiscount: true,
      allowBonusItem: false,
      allowStackDiscountAndFreeShipping: false,
      couponBoxEnabled: true,
      freeShippingMinCartValue: 200,
      maxShippingSubsidy: 25,
      maxPartialShippingDiscount: 15,
      offerExpirationMinutes: 20,
      blockedRegions: [],
      brandVoice: "consultative"
    }
  });
  console.log("✓ MerchantRule upserted (12% discount, free shipping ≥R$200, 20min expiry)");

  // 3. Checkout settings
  await prisma.checkoutSetting.upsert({
    where: { merchantId: MERCHANT_ID },
    create: {
      merchantId: MERCHANT_ID,
      mode: "assisted",
      widgetBehavior: {
        openWidgetOnTrigger: true,
        startMinimized: false,
        position: "bottom-right",
        initialDelaySeconds: 3
      },
      interventionPolicy: {
        minimumAbandonmentScore: 50,
        cooldownSeconds: 300,
        maxInterventionsPerSession: 3
      },
      triggerRules: [
        { trigger: "cart_abandonment", enabled: true, priority: 1 },
        { trigger: "exit_intent", enabled: true, priority: 2 },
        { trigger: "inactivity", enabled: true, priority: 3 }
      ],
      suppressionRules: {
        suppressedSteps: [],
        blockedRegions: [],
        suppressAfterOfferAccepted: true,
        respectBuyerOptOut: true
      },
      handoff: {
        enabled: false,
        message: "Precisa de ajuda? Fale conosco.",
        channels: ["whatsapp"]
      }
    },
    update: {
      mode: "assisted",
      widgetBehavior: {
        openWidgetOnTrigger: true,
        startMinimized: false,
        position: "bottom-right",
        initialDelaySeconds: 3
      },
      interventionPolicy: {
        minimumAbandonmentScore: 50,
        cooldownSeconds: 300,
        maxInterventionsPerSession: 3
      },
      triggerRules: [
        { trigger: "cart_abandonment", enabled: true, priority: 1 },
        { trigger: "exit_intent", enabled: true, priority: 2 },
        { trigger: "inactivity", enabled: true, priority: 3 }
      ],
      suppressionRules: {
        suppressedSteps: [],
        blockedRegions: [],
        suppressAfterOfferAccepted: true,
        respectBuyerOptOut: true
      },
      handoff: {
        enabled: false,
        message: "Precisa de ajuda? Fale conosco.",
        channels: ["whatsapp"]
      }
    }
  });
  console.log("✓ CheckoutSetting upserted");

  // 4. Cross-sell promotions (in-memory only — create via API after server starts)
  console.log("\n--- Cross-sell promotions (in-memory, use API) ---");
  console.log("Run these after the API is running:\n");

  const crossSellPayloads = [
    {
      name: "Necessaire com Bolsa Executiva",
      trigger: { category_in_cart: ["bolsas", "executivo"], cart_total_above: 150 },
      recommended_skus: ["NECS-001", "NECS-002"],
      discount_percent: 15,
      max_discount_percent: 20,
      starts_at: new Date().toISOString()
    },
    {
      name: "Carteira de Couro Complementar",
      trigger: { sku_in_cart: ["BOLSA-EXE-01", "BOLSA-EXE-02"] },
      recommended_skus: ["CART-COE-01"],
      discount_percent: 10,
      max_discount_percent: 15,
      starts_at: new Date().toISOString()
    }
  ];

  for (const payload of crossSellPayloads) {
    console.log(
      `curl -X POST "${BASE_URL}/merchants/${MERCHANT_ID}/cross-sell/promotions" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <MERCHANT_TOKEN>" \\
  -d '${JSON.stringify(payload)}'\n`
    );
  }

  console.log("Seed complete.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
