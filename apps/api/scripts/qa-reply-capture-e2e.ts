#!/usr/bin/env tsx
/**
 * QA E2E — Reply Capture with REAL catalog products.
 *
 * Creates a checkout session + completed order whose cart references real
 * products from the merchant catalog, then simulates an NPS reply "9" and
 * verifies reviews are created for every product in the order.
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
loadDotenv({ path: resolve(process.cwd(), ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
import { PrismaNpsRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-nps.repository.js";
import { PrismaReviewRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-review.repository.js";
import { SubmitNpsUseCase } from "../src/modules/post-sale/application/use-cases/submit-nps.use-case.js";
import { SubmitReviewUseCase } from "../src/modules/post-sale/application/use-cases/submit-review.use-case.js";
import { PostSaleReplyHandlerAdapter } from "../src/modules/post-sale/infrastructure/adapters/post-sale-reply-handler.adapter.js";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const noopBus = { publish: async () => {}, subscribe: () => {}, handlersFor: () => [] };

async function main() {
  const prisma = createPrismaClient();

  // ─── SETUP: pick 3 REAL products from the catalog ────────────────
  console.log("═══ SETUP: pick real catalog products ═══");
  const products = await (prisma as any).product.findMany({
    where: { merchantId: MERCHANT_ID, isActive: true, deletedAt: null },
    take: 3,
    orderBy: { createdAt: "asc" },
  });
  if (products.length === 0) {
    console.log("✗ No catalog products. Run catalog-seed first.");
    await prisma.$disconnect();
    return;
  }
  console.log(`✓ Using ${products.length} real products:`);
  products.forEach((p: any) => console.log(`    - ${p.name} (${p.id})`));

  // ─── SETUP: create checkout session + completed order ────────────
  const sessionId = "sess_reply_e2e";
  const orderId = "ORD-REPLY-E2E";
  const cart = {
    items: products.map((p: any) => ({ product_id: p.id, name: p.name, price: 100, quantity: 1 })),
  };

  await (prisma as any).completedOrder?.deleteMany({ where: { merchantId: MERCHANT_ID, sessionId } }).catch(() => {});
  await (prisma as any).checkoutSession?.deleteMany({ where: { merchantId: MERCHANT_ID, sessionId } }).catch(() => {});

  await (prisma as any).checkoutSession.create({
    data: {
      merchantId: MERCHANT_ID, sessionId, globalUserId: "guser_reply_test",
      conversationId: "conv_reply_e2e", cart, createdAt: new Date(), updatedAt: new Date(),
    },
  });
  await (prisma as any).completedOrder.create({
    data: {
      merchantId: MERCHANT_ID, sessionId, externalOrderId: orderId,
      orderTotal: 300, currency: "BRL", status: "approved", completedAt: new Date(),
    },
  });
  console.log(`✓ Order ${orderId} created with ${cart.items.length} real products`);

  // Clean prior test rows
  await (prisma as any).npsResponse?.deleteMany({ where: { merchantId: MERCHANT_ID, buyerId: "buyer_reply_test" } }).catch(() => {});
  await (prisma as any).productReview?.deleteMany({ where: { buyerId: "buyer_reply_test", orderId } }).catch(() => {});

  // ─── ACT: buyer replies NPS "9" ──────────────────────────────────
  console.log("\n═══ ACT: buyer replies NPS score 9 ═══");
  const submitNps = new SubmitNpsUseCase(new PrismaNpsRepository(prisma) as any, noopBus as any);
  const submitReview = new SubmitReviewUseCase(new PrismaReviewRepository(prisma) as any, noopBus as any);
  const handler = new PostSaleReplyHandlerAdapter(submitNps, submitReview, prisma);

  await handler.handleNpsReply({
    merchantId: MERCHANT_ID, buyerId: "buyer_reply_test", orderId, score: 9, feedback: "produto excelente, entrega rápida",
  });

  // ─── VERIFY ───────────────────────────────────────────────────────
  console.log("\n═══ VERIFY ═══");
  const nps = await (prisma as any).npsResponse.findFirst({ where: { merchantId: MERCHANT_ID, buyerId: "buyer_reply_test" }, orderBy: { createdAt: "desc" } });
  console.log(nps ? `✓ NPS: score=${nps.score}, classification=${nps.classification}, feedback="${nps.feedback}"` : "✗ No NPS");

  const reviews = await (prisma as any).productReview.findMany({ where: { buyerId: "buyer_reply_test", orderId } });
  console.log(`✓ Reviews created: ${reviews.length} (expected ${cart.items.length})`);
  reviews.forEach((r: any) => console.log(`    → product=${r.productId}, rating=${r.rating}/5, status=${r.moderationStatus}`));

  console.log(`\n  → ${reviews.length === cart.items.length ? "PASS ✓ — all order products got a review" : "MISMATCH"}`);

  await prisma.$disconnect();
  console.log("\n═══ DONE ═══");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
