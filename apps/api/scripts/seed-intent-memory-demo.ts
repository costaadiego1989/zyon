import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// Simple UUID-like ID generator
const generateId = () => `buyer_${Math.random().toString(36).substr(2, 9)}`;

const MERCHANT_EMAIL = "costaadiego1989@gmail.com";

const INTENT_PROFILES = [
  {
    primaryIntent: "price_sensitive",
    urgency: "high",
    budgetTier: "budget",
    categoryFocus: ["electronics", "accessories"],
    painPoints: ["frete_caro", "preco_alto"],
    conversionLikelihoodPct: 45,
  },
  {
    primaryIntent: "quality_seeker",
    urgency: "medium",
    budgetTier: "premium",
    categoryFocus: ["electronics"],
    painPoints: ["indeciso"],
    conversionLikelihoodPct: 72,
  },
  {
    primaryIntent: "speed_focused",
    urgency: "high",
    budgetTier: "mid",
    categoryFocus: ["consumables"],
    painPoints: ["prazo_longo"],
    conversionLikelihoodPct: 61,
  },
  {
    primaryIntent: "sustainability_conscious",
    urgency: "low",
    budgetTier: "premium",
    categoryFocus: ["eco-products"],
    painPoints: ["impacto_ambiental"],
    conversionLikelihoodPct: 58,
  },
  {
    primaryIntent: "price_sensitive",
    urgency: "low",
    budgetTier: "budget",
    categoryFocus: ["bulk-items"],
    painPoints: ["preco_alto", "frete_caro"],
    conversionLikelihoodPct: 38,
  },
  {
    primaryIntent: "quality_seeker",
    urgency: "high",
    budgetTier: "premium",
    categoryFocus: ["electronics"],
    painPoints: [],
    conversionLikelihoodPct: 85,
  },
  {
    primaryIntent: "speed_focused",
    urgency: "high",
    budgetTier: "budget",
    categoryFocus: ["consumables"],
    painPoints: ["prazo_longo", "preco_alto"],
    conversionLikelihoodPct: 52,
  },
  {
    primaryIntent: "sustainability_conscious",
    urgency: "medium",
    budgetTier: "mid",
    categoryFocus: ["packaging", "eco-products"],
    painPoints: ["sustentabilidade"],
    conversionLikelihoodPct: 64,
  },
  {
    primaryIntent: "price_sensitive",
    urgency: "medium",
    budgetTier: "budget",
    categoryFocus: ["promotions"],
    painPoints: ["frete_caro"],
    conversionLikelihoodPct: 48,
  },
  {
    primaryIntent: "quality_seeker",
    urgency: "low",
    budgetTier: "premium",
    categoryFocus: ["certified-goods"],
    painPoints: ["indeciso"],
    conversionLikelihoodPct: 68,
  },
  {
    primaryIntent: "speed_focused",
    urgency: "medium",
    budgetTier: "mid",
    categoryFocus: ["consumables"],
    painPoints: ["prazo_longo"],
    conversionLikelihoodPct: 55,
  },
  {
    primaryIntent: "sustainability_conscious",
    urgency: "low",
    budgetTier: "premium",
    categoryFocus: ["renewable"],
    painPoints: ["impacto_ambiental"],
    conversionLikelihoodPct: 60,
  },
];

const BUYER_NAMES = [
  "Maria Silva",
  "João Santos",
  "Ana Costa",
  "Pedro Oliveira",
  "Carla Martins",
  "Ricardo Ferreira",
  "Lucia Alves",
  "Marcos Rocha",
  "Fernanda Dias",
  "Bruno Costa",
  "Sandra Moura",
  "Felipe Gomes",
];

async function main() {
  try {
    // 1. Find merchant by email
    const merchantUser = await prisma.merchantUser.findUnique({
      where: { email: MERCHANT_EMAIL },
      include: { merchant: true },
    });

    if (!merchantUser) {
      console.error(`Merchant user not found: ${MERCHANT_EMAIL}`);
      process.exit(1);
    }

    const merchantId = merchantUser.merchantId;
    console.log(`Found merchant: ${merchantId} (${merchantUser.merchant.name})`);

    // 2. Create demo purchase records and intent records
    console.log("Creating demo purchase records and intent memory...");

    for (let i = 0; i < INTENT_PROFILES.length; i++) {
      const profile = INTENT_PROFILES[i];
      const buyerName = BUYER_NAMES[i % BUYER_NAMES.length];
      const globalUserId = generateId();
      const orderId = `order_${Date.now()}_${i}`;

      // Create purchase record
      await prisma.buyerPurchaseRecord.create({
        data: {
          merchantId,
          orderId,
          globalUserId,
          merchantCustomerId: `cust_${i}`,
          currency: "BRL",
          totalAmount: Math.random() * 500 + 50,
          discountAmount: Math.random() * 100,
          completedAt: new Date(
            Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000
          ), // Last 30 days
          items: [
            {
              name: `Product ${i}`,
              quantity: Math.floor(Math.random() * 3) + 1,
              price: Math.random() * 300 + 20,
            },
          ],
        },
      });

      // Create intent record
      await prisma.customerIntentRecord.create({
        data: {
          merchantId,
          globalUserId,
          primaryIntent: profile.primaryIntent,
          urgency: profile.urgency,
          budgetTier: profile.budgetTier,
          categoryFocus: profile.categoryFocus,
          painPoints: profile.painPoints,
          conversionLikelihoodPct: profile.conversionLikelihoodPct,
          behavioralSignalsJson: {
            sessionDuration: Math.floor(Math.random() * 600) + 60,
            pageViews: Math.floor(Math.random() * 15) + 2,
            clicksOnFilters: Math.floor(Math.random() * 8),
            timeOnProductPage: Math.floor(Math.random() * 300) + 30,
            reviewsRead: Math.floor(Math.random() * 5),
            couponSearches: Math.floor(Math.random() * 5),
            shippingOptionsViewed: Math.floor(Math.random() * 5),
            buyerName,
          },
          generatedAt: new Date(
            Date.now() - Math.random() * 7 * 24 * 60 * 60 * 1000
          ), // Last 7 days
        },
      });

      console.log(
        `[${i + 1}/${INTENT_PROFILES.length}] Created intent record for ${buyerName} (${profile.primaryIntent})`
      );
    }

    console.log(
      `\n✓ Seeding complete! Created ${INTENT_PROFILES.length} purchase records and intent memories.`
    );
    console.log(`Merchant: ${merchantId}`);
    console.log(`Email: ${MERCHANT_EMAIL}`);
  } catch (error) {
    console.error("Seed error:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
