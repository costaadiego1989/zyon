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
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";
import { seedDashboardData } from "./dashboard-seed.js";

// Load env the same way the API does so DATABASE_URL is available to the
// Prisma 7 driver adapter (PrismaPg). Without this the bare PrismaClient()
// throws PrismaClientInitializationError (needs an adapter + connection).
loadDotenv({ path: resolve(process.cwd(), ".env") });
loadDotenv({ path: resolve(process.cwd(), "../../.env"), override: false });

const MERCHANT_ID = process.env.MERCHANT_ID ?? "mrc_dev_seed";
const MERCHANT_NAME = process.env.MERCHANT_NAME ?? "Bolsas Executivas Demo";
const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const prisma = createPrismaClient();

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
      brandVoice: "consultative",
      quickReplies: {
        payment: ["Cartão de crédito", "PIX", "Pagar com crypto"]
      },
      cryptoPayments: {
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        token: "USDC",
        quoteTtlSeconds: 900,
        brlPerUsdc: 5.5
      }
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
      brandVoice: "consultative",
      quickReplies: {
        payment: ["Cartão de crédito", "PIX", "Pagar com crypto"]
      },
      cryptoPayments: {
        enabled: true,
        chain: "polygon",
        network: "testnet",
        treasuryAddress: "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
        token: "USDC",
        quoteTtlSeconds: 900,
        brlPerUsdc: 5.5
      }
    }
  });
  console.log("✓ MerchantRule upserted (12% discount, crypto enabled on Polygon Amoy)");

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
        minimumAbandonmentScore: 0.5,
        cooldownSeconds: 300,
        maxInterventionsPerSession: 3
      },
      triggerRules: [
        { trigger: "exit_intent_detected", enabled: true, priority: 1 },
        { trigger: "idle_30_seconds", enabled: true, priority: 2 },
        { trigger: "shipping_objection_detected", enabled: true, priority: 3 }
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
        minimumAbandonmentScore: 0.5,
        cooldownSeconds: 300,
        maxInterventionsPerSession: 3
      },
      triggerRules: [
        { trigger: "exit_intent_detected", enabled: true, priority: 1 },
        { trigger: "idle_30_seconds", enabled: true, priority: 2 },
        { trigger: "shipping_objection_detected", enabled: true, priority: 3 }
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

  // 5. Support FAQ (via API — requires server running and merchant token)
  console.log("\n--- Support FAQ seed (use API after server starts) ---");
  const supportFaq = {
    faqItems: [
      { id: "faq-01", question: "Qual o prazo de entrega?", answer: "O prazo de entrega varia de 3 a 7 dias úteis dependendo da sua região. Pedidos para capitais costumam chegar em até 3 dias." },
      { id: "faq-02", question: "Como faço para rastrear meu pedido?", answer: "Após a confirmação do pagamento, você receberá um e-mail com o código de rastreamento. Use-o no site dos Correios ou da transportadora." },
      { id: "faq-03", question: "Posso trocar ou devolver o produto?", answer: "Sim! Aceitamos trocas e devoluções em até 7 dias corridos após o recebimento, conforme o Código de Defesa do Consumidor. Entre em contato pelo e-mail de suporte." },
      { id: "faq-04", question: "Quais são as formas de pagamento aceitas?", answer: "Aceitamos cartão de crédito (Visa, Mastercard, Elo, Amex), PIX e boleto bancário. Parcelamento em até 12x no cartão." },
      { id: "faq-05", question: "Meu pagamento foi recusado, o que fazer?", answer: "Verifique os dados do cartão, o limite disponível e se o banco não bloqueou a transação. Tente novamente ou use outro método de pagamento." },
      { id: "faq-06", question: "O produto chegou com defeito ou diferente do pedido?", answer: "Pedimos desculpas! Entre em contato com nosso suporte em até 7 dias com foto do produto. Providenciaremos a troca sem custo adicional." }
    ]
  };
  console.log(
    `curl -X PUT "${BASE_URL}/support/settings" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer <MERCHANT_TOKEN>" \\
  -d '${JSON.stringify(supportFaq)}'\n`
  );

  // 6. Dashboard data (checkout sessions, offers, orders, events)
  await seedDashboardData(prisma, MERCHANT_ID);

  console.log("Seed complete.\n");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
