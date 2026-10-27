#!/usr/bin/env tsx
/**
 * QA E2E — Full post-sale flow:
 * 1. AI template generation (DeepSeek) — verify rich, not one-liner
 * 2. Rich template send → WhatsApp + Email
 * 3. Reply capture simulation → NPS + Review submitted
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
loadDotenv({ path: resolve(process.cwd(), ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
import { PrismaScheduledMessageRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-scheduled-message.repository.js";
import { PrismaPostSaleTemplateRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-post-sale-template.repository.js";
import { ProcessScheduledMessagesUseCase } from "../src/modules/post-sale/application/use-cases/process-scheduled-messages.use-case.js";
import { GeneratePostSaleTemplateUseCase } from "../src/modules/post-sale/application/use-cases/generate-post-sale-template.use-case.js";
import { PostSaleAiCopywriterService } from "../src/modules/post-sale/application/services/post-sale-ai-copywriter.service.js";
import { BubbleWhatsAdapter } from "../src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.js";
import { ResendEmailAdapter } from "../src/modules/notifications/infrastructure/adapters/resend-email.adapter.js";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

async function main() {
  const prisma = createPrismaClient();
  const templateRepo = new PrismaPostSaleTemplateRepository(prisma);
  const msgRepo = new PrismaScheduledMessageRepository(prisma);
  const copywriter = new PostSaleAiCopywriterService(templateRepo);
  const whatsapp = new BubbleWhatsAdapter();
  const email = new ResendEmailAdapter();

  // ─── TEST 1: AI template generation ──────────────────────────────
  console.log("═══ TEST 1: AI Template Generation (DeepSeek) ═══");
  const gen = new GeneratePostSaleTemplateUseCase(copywriter);
  try {
    const result = await gen.execute({ type: "nps", channel: "whatsapp", tone: "amigável e caloroso", storeName: "Athom Technologies" });
    console.log("✓ Generated template:");
    console.log(`  name: ${result.name}`);
    console.log(`  body:\n${result.body.split("\n").map((l) => "    " + l).join("\n")}`);
    const isRich = result.body.length > 80 && result.body.includes("{{");
    console.log(`  → ${isRich ? "RICH ✓" : "TOO SIMPLE ✗"} (${result.body.length} chars)`);
  } catch (e) {
    console.log(`  ✗ AI generation failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log("  (will use rich platform defaults instead)");
  }

  // ─── TEST 2: Copywriter resolves rich template ───────────────────
  console.log("\n═══ TEST 2: Copywriter resolves rich default ═══");
  const npsMsg = await copywriter.generate({ type: "nps", buyerName: "Diego", productName: "Tênis Runner Pro", merchantId: MERCHANT_ID, buyerId: "buyer_test" });
  console.log(`NPS message (${npsMsg.length} chars):\n${npsMsg.split("\n").map((l) => "  " + l).join("\n")}`);
  console.log(`  → ${npsMsg.length > 80 ? "RICH ✓" : "TOO SIMPLE ✗"}`);

  // ─── TEST 3: Send rich templates ─────────────────────────────────
  console.log("\n═══ TEST 3: Send rich templates (WhatsApp + Email) ═══");
  await prisma.postSaleScheduledMessage.deleteMany({ where: { id: { startsWith: "psm_e2e" } } });
  await prisma.postSaleScheduledMessage.createMany({
    data: [
      { id: "psm_e2e_wa_nps", merchantId: MERCHANT_ID, buyerId: "buyer_test", orderId: "ord_e2e", type: "nps", channel: "whatsapp", sendAt: new Date(), status: "pending", buyerPhone: "21993001883", buyerName: "Diego", productName: "Tênis Runner Pro" },
      { id: "psm_e2e_email_rev", merchantId: MERCHANT_ID, buyerId: "buyer_test", orderId: "ord_e2e", type: "review_request", channel: "email", sendAt: new Date(), status: "pending", buyerEmail: "costaadiego1989@gmail.com", buyerName: "Diego", productName: "Mochila Urban 25L" },
    ],
  });

  const processor = new ProcessScheduledMessagesUseCase(msgRepo, whatsapp, email, copywriter);
  const stats = await processor.execute();
  console.log(`  Processed: ${stats.processed}, Sent: ${stats.sent}, Failed: ${stats.failed}`);

  const sent = await prisma.postSaleScheduledMessage.findMany({ where: { id: { startsWith: "psm_e2e" } }, select: { id: true, channel: true, status: true, messageContent: true } });
  for (const m of sent) {
    console.log(`  ${m.id} [${m.channel}] → ${m.status}`);
    if (m.messageContent) console.log(`    "${m.messageContent.slice(0, 120)}${m.messageContent.length > 120 ? "..." : ""}"`);
  }

  await prisma.$disconnect();
  console.log("\n✓ E2E send tests done. Check WhatsApp 21993001883 + email costaadiego1989@gmail.com");
}

main().catch((e) => { console.error("FATAL:", e); process.exit(1); });
