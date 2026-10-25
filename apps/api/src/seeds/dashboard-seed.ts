/**
 * Dashboard seed — populates 60 days of realistic checkout/order data for the
 * dashboard overview page. Uses deterministic PRNG so results are repeatable.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... MERCHANT_ID=mrc_xxx npx tsx src/seeds/dashboard-seed.ts
 *
 * Or via the dev-seed which calls seedDashboardData at the end.
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import type { PrismaClient, Prisma } from "@prisma/client";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";

// ─── Deterministic PRNG (Mulberry32) ────────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Data Pools ─────────────────────────────────────────────────────────────

const BUYER_NAMES = [
  "João Silva", "Maria Santos", "Pedro Oliveira", "Ana Costa", "Lucas Pereira",
  "Juliana Ferreira", "Carlos Souza", "Fernanda Lima", "Rafael Almeida", "Beatriz Rocha",
  "Gabriel Martins", "Camila Araújo", "Thiago Ribeiro", "Larissa Gomes", "Mateus Barbosa",
  "Amanda Cardoso", "Bruno Nascimento", "Isabela Correia", "Diego Mendes", "Letícia Carvalho",
  "Vinícius Pinto", "Mariana Teixeira", "Felipe Nunes", "Carolina Moreira", "Rodrigo Castro",
  "Patrícia Dias", "Henrique Monteiro", "Aline Vieira", "Gustavo Campos", "Renata Melo",
];

const BUYER_EMAILS = BUYER_NAMES.map(
  (n) => n.toLowerCase().replace(/ /g, ".").normalize("NFD").replace(/[̀-ͯ]/g, "") + "@email.com",
);

const PRODUCTS = [
  { name: "Fone Bluetooth Pro", sku: "FONE-BT-01", price: 189.9, imageUrl: "https://placehold.co/200x200?text=Fone" },
  { name: "Smartwatch Pulse", sku: "WATCH-PLS-01", price: 349.9, imageUrl: "https://placehold.co/200x200?text=Watch" },
  { name: "Camiseta Dry-Fit Premium", sku: "CAM-DRY-01", price: 79.9, imageUrl: "https://placehold.co/200x200?text=Camiseta" },
  { name: "Tênis Runner X", sku: "TEN-RUN-01", price: 459.9, imageUrl: "https://placehold.co/200x200?text=Tenis" },
  { name: "Mochila Urban Tech", sku: "MOCH-URB-01", price: 229.9, imageUrl: "https://placehold.co/200x200?text=Mochila" },
  { name: "Carregador Turbo 65W", sku: "CARR-65W-01", price: 149.9, imageUrl: "https://placehold.co/200x200?text=Carregador" },
  { name: "Mouse Sem Fio Ergo", sku: "MOUSE-ERG-01", price: 119.9, imageUrl: "https://placehold.co/200x200?text=Mouse" },
  { name: "Teclado Mecânico RGB", sku: "TEC-MEC-01", price: 289.9, imageUrl: "https://placehold.co/200x200?text=Teclado" },
  { name: "Óculos Solar Titanium", sku: "OC-SOL-01", price: 199.9, imageUrl: "https://placehold.co/200x200?text=Oculos" },
  { name: "Carteira Couro Legítimo", sku: "CART-COE-01", price: 159.9, imageUrl: "https://placehold.co/200x200?text=Carteira" },
  { name: "Bolsa Executiva Slim", sku: "BOLSA-EXE-01", price: 389.9, imageUrl: "https://placehold.co/200x200?text=Bolsa" },
  { name: "Cinto de Couro Classic", sku: "CINT-COE-01", price: 89.9, imageUrl: "https://placehold.co/200x200?text=Cinto" },
  { name: "Power Bank 20000mAh", sku: "PWB-20K-01", price: 179.9, imageUrl: "https://placehold.co/200x200?text=PowerBank" },
  { name: "Câmera Action 4K", sku: "CAM-4K-01", price: 499.9, imageUrl: "https://placehold.co/200x200?text=Camera" },
  { name: "Hub USB-C 7-em-1", sku: "HUB-USBC-01", price: 159.9, imageUrl: "https://placehold.co/200x200?text=Hub" },
];

const ORDER_STATUSES = ["approved", "shipped", "delivered"] as const;
const OFFER_TYPES = ["discount", "free_shipping", "shipping_discount"] as const;

const EVENT_NAMES = [
  "session_start",
  "message_sent",
  "offer_viewed",
  "offer_accepted",
  "order_completed",
] as const;

// ─── Helpers ────────────────────────────────────────────────────────────────

function generateCuid(rand: () => number): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let id = "c";
  for (let i = 0; i < 24; i++) {
    id += chars[Math.floor(rand() * chars.length)];
  }
  return id;
}

function pickRandom<T>(arr: readonly T[], rand: () => number): T {
  return arr[Math.floor(rand() * arr.length)];
}

function randomHour(rand: () => number): number {
  // Weighted toward business hours (10-20h)
  const r = rand();
  if (r < 0.15) return Math.floor(rand() * 10); // 0-9h (15%)
  if (r < 0.9) return 10 + Math.floor(rand() * 10); // 10-19h (75%)
  return 20 + Math.floor(rand() * 4); // 20-23h (10%)
}

function buildTimestamp(baseDate: Date, rand: () => number): Date {
  const d = new Date(baseDate);
  d.setHours(randomHour(rand), Math.floor(rand() * 60), Math.floor(rand() * 60), 0);
  return d;
}

function buildCartItems(rand: () => number): Array<{
  product_id: string;
  sku: string;
  name: string;
  price: number;
  quantity: number;
  imageUrl: string;
}> {
  const count = 1 + Math.floor(rand() * 3); // 1-3 items
  const items: Array<{
    product_id: string;
    sku: string;
    name: string;
    price: number;
    quantity: number;
    imageUrl: string;
  }> = [];
  const used = new Set<number>();
  for (let i = 0; i < count; i++) {
    let idx: number;
    do {
      idx = Math.floor(rand() * PRODUCTS.length);
    } while (used.has(idx));
    used.add(idx);
    const p = PRODUCTS[idx];
    items.push({
      product_id: `prod_${p.sku.toLowerCase()}`,
      sku: p.sku,
      name: p.name,
      price: p.price,
      quantity: 1 + Math.floor(rand() * 2),
      imageUrl: p.imageUrl,
    });
  }
  return items;
}

// ─── Main Seed Function ─────────────────────────────────────────────────────

export async function seedDashboardData(prisma: PrismaClient, merchantId: string): Promise<void> {
  // Derive seed from merchantId so each merchant gets unique IDs
  let hash = 0;
  for (let i = 0; i < merchantId.length; i++) {
    hash = ((hash << 5) - hash + merchantId.charCodeAt(i)) | 0;
  }
  const SEED = Math.abs(hash) || 42_7331;
  const rand = mulberry32(SEED);

  const DAYS = 60;
  const now = new Date();
  const startDate = new Date(now);
  startDate.setDate(startDate.getDate() - DAYS);
  startDate.setHours(0, 0, 0, 0);

  // Plan how many sessions per day (weekends get ~40% less)
  const dailySessionCounts: number[] = [];
  let totalPlanned = 0;
  for (let d = 0; d < DAYS; d++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + d);
    const dayOfWeek = date.getDay(); // 0=Sun, 6=Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const base = isWeekend ? 3 : 5;
    const variance = Math.floor(rand() * 3) - 1; // -1 to 1
    const count = Math.max(1, base + variance);
    dailySessionCounts.push(count);
    totalPlanned += count;
  }

  console.log(`  Planning ${totalPlanned} sessions over ${DAYS} days...`);

  // Collect all records in arrays for batch creation
  const sessions: Prisma.CheckoutSessionCreateManyInput[] = [];

  const events: Prisma.CheckoutEventCreateManyInput[] = [];

  const offers: Prisma.AuthorizedOfferCreateManyInput[] = [];

  const orders: Prisma.CompletedOrderCreateManyInput[] = [];

  let sessionIndex = 0;
  for (let d = 0; d < DAYS; d++) {
    const dayDate = new Date(startDate);
    dayDate.setDate(dayDate.getDate() + d);
    const count = dailySessionCounts[d];

    for (let s = 0; s < count; s++) {
      sessionIndex++;
      const sessionId = `sess_dash_${sessionIndex.toString().padStart(4, "0")}`;
      const id = generateCuid(rand);
      const buyerIdx = Math.floor(rand() * BUYER_NAMES.length);
      const globalUserId = `guser_${buyerIdx.toString().padStart(3, "0")}`;
      const conversationId = `conv_${generateCuid(rand)}`;
      const createdAt = buildTimestamp(dayDate, rand);
      const updatedAt = new Date(createdAt.getTime() + Math.floor(rand() * 600_000)); // +0-10min

      const cartItems = buildCartItems(rand);
      const cartTotal = cartItems.reduce((sum, it) => sum + it.price * it.quantity, 0);
      const abandonmentScore = Math.round(rand() * 100) / 100;

      sessions.push({
        id,
        merchantId,
        sessionId,
        globalUserId,
        conversationId,
        cart: { items: cartItems, total: Math.round(cartTotal * 100) / 100 },
        customer: { fullName: BUYER_NAMES[buyerIdx], email: BUYER_EMAILS[buyerIdx] },
        abandonmentScore,
        chatHistory: [],
        version: 0,
        createdAt,
        updatedAt,
      });

      // Always create session_start event
      events.push({
        id: generateCuid(rand),
        merchantId,
        sessionId,
        eventName: "session_start",
        occurredAt: createdAt,
      });

      // ~70% get message_sent
      if (rand() < 0.7) {
        events.push({
          id: generateCuid(rand),
          merchantId,
          sessionId,
          eventName: "message_sent",
          occurredAt: new Date(createdAt.getTime() + Math.floor(rand() * 120_000)),
        });
      }

      // ~50% get an authorized offer
      const getsOffer = rand() < 0.5;
      if (getsOffer) {
        const offerType = pickRandom(OFFER_TYPES, rand);
        const value = offerType === "discount"
          ? Math.round((5 + rand() * 7) * 100) / 100
          : offerType === "free_shipping"
            ? Math.round(cartTotal * 0.05 * 100) / 100
            : Math.round((8 + rand() * 12) * 100) / 100;

        const offerId = `offer_${generateCuid(rand)}`;
        const expiresAt = new Date(createdAt.getTime() + 20 * 60 * 1000);

        offers.push({
          id: offerId,
          merchantId,
          sessionId,
          type: offerType,
          value,
          approved: true,
          reason: "abandonment_intervention",
          marginAfterOffer: Math.round((35 + rand() * 15) * 100) / 100,
          expiresAt,
          discountCode: offerType === "discount" ? `DASH${sessionIndex}` : null,
        });

        events.push({
          id: generateCuid(rand),
          merchantId,
          sessionId,
          eventName: "offer_viewed",
          occurredAt: new Date(createdAt.getTime() + Math.floor(rand() * 180_000)),
        });

        // ~55% of offers get accepted -> order
        if (rand() < 0.55) {
          events.push({
            id: generateCuid(rand),
            merchantId,
            sessionId,
            eventName: "offer_accepted",
            occurredAt: new Date(createdAt.getTime() + Math.floor(rand() * 300_000)),
          });

          const orderTotal = offerType === "discount"
            ? Math.round(cartTotal * (1 - value / 100) * 100) / 100
            : Math.round(cartTotal * 100) / 100;

          const status = pickRandom(ORDER_STATUSES, rand);
          orders.push({
            id: generateCuid(rand),
            merchantId,
            sessionId,
            externalOrderId: `ORD-${sessionIndex.toString().padStart(5, "0")}`,
            orderTotal: Math.max(50, orderTotal),
            currency: "BRL",
            status,
            completedAt: new Date(createdAt.getTime() + Math.floor(rand() * 600_000)),
          });

          events.push({
            id: generateCuid(rand),
            merchantId,
            sessionId,
            eventName: "order_completed",
            occurredAt: new Date(createdAt.getTime() + Math.floor(rand() * 600_000)),
          });
        }
      } else {
        // ~15% of sessions without offer still complete an order (direct purchase)
        if (rand() < 0.15) {
          const orderTotal = Math.round(cartTotal * 100) / 100;
          const status = pickRandom(ORDER_STATUSES, rand);
          orders.push({
            id: generateCuid(rand),
            merchantId,
            sessionId,
            externalOrderId: `ORD-${sessionIndex.toString().padStart(5, "0")}`,
            orderTotal: Math.max(50, orderTotal),
            currency: "BRL",
            status,
            completedAt: new Date(createdAt.getTime() + Math.floor(rand() * 600_000)),
          });
          events.push({
            id: generateCuid(rand),
            merchantId,
            sessionId,
            eventName: "order_completed",
            occurredAt: new Date(createdAt.getTime() + Math.floor(rand() * 600_000)),
          });
        }
      }
    }
  }

  console.log(`  Created: ${sessions.length} sessions, ${offers.length} offers, ${orders.length} orders, ${events.length} events`);

  // Clean existing dashboard seed data for this merchant (idempotent re-run)
  const dashSessionIds = sessions.map((s) => s.sessionId);

  // Delete in dependency order
  await prisma.completedOrder.deleteMany({
    where: { merchantId, sessionId: { in: dashSessionIds } },
  });
  await prisma.authorizedOffer.deleteMany({
    where: { merchantId, sessionId: { in: dashSessionIds } },
  });
  await prisma.checkoutEvent.deleteMany({
    where: { merchantId, sessionId: { in: dashSessionIds } },
  });
  await prisma.checkoutSession.deleteMany({
    where: { merchantId, sessionId: { in: dashSessionIds } },
  });

  // Batch insert sessions
  const BATCH_SIZE = 50;
  for (let i = 0; i < sessions.length; i += BATCH_SIZE) {
    const batch = sessions.slice(i, i + BATCH_SIZE);
    await prisma.checkoutSession.createMany({ data: batch });
  }

  // Batch insert events
  for (let i = 0; i < events.length; i += BATCH_SIZE) {
    const batch = events.slice(i, i + BATCH_SIZE);
    await prisma.checkoutEvent.createMany({ data: batch });
  }

  // Batch insert offers
  for (let i = 0; i < offers.length; i += BATCH_SIZE) {
    const batch = offers.slice(i, i + BATCH_SIZE);
    await prisma.authorizedOffer.createMany({ data: batch });
  }

  // Batch insert orders
  for (let i = 0; i < orders.length; i += BATCH_SIZE) {
    const batch = orders.slice(i, i + BATCH_SIZE);
    await prisma.completedOrder.createMany({ data: batch });
  }

  console.log("  ✓ Dashboard data seeded successfully");
}

// ─── Standalone execution ───────────────────────────────────────────────────

async function main() {
  loadDotenv({ path: resolve(process.cwd(), ".env") });
  loadDotenv({ path: resolve(process.cwd(), "../../.env"), override: false });

  const merchantId = process.env.MERCHANT_ID ?? "mrc_dev_seed";
  const prisma = createPrismaClient();

  console.log(`\nDashboard seed for merchant: ${merchantId}`);
  try {
    await seedDashboardData(prisma, merchantId);
  } finally {
    await prisma.$disconnect();
  }
  console.log("Done.\n");
}

// Run standalone when executed directly
const isMain = process.argv[1]?.replace(/\\/g, "/").includes("dashboard-seed");
if (isMain) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
