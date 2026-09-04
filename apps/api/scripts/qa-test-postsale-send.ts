#!/usr/bin/env tsx
/**
 * QA E2E — Trigger post-sale message send directly.
 * Bypasses the 5-min interval by invoking the send path once, with REAL adapters.
 * Verifies WhatsApp (BubbleWhats) + Email (Resend) actually deliver.
 *
 * Usage:
 *   cd apps/api
 *   DATABASE_URL=... npx tsx scripts/qa-test-postsale-send.ts
 */
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
loadDotenv({ path: resolve(process.cwd(), ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
import { PrismaScheduledMessageRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-scheduled-message.repository.js";
import { ProcessScheduledMessagesUseCase } from "../src/modules/post-sale/application/use-cases/process-scheduled-messages.use-case.js";
import { PostSaleAiCopywriterService } from "../src/modules/post-sale/application/services/post-sale-ai-copywriter.service.js";
import { BubbleWhatsAdapter } from "../src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.js";
import { ResendEmailAdapter } from "../src/modules/notifications/infrastructure/adapters/resend-email.adapter.js";

async function main() {
  console.log("[QA] Post-sale send test starting...");
  console.log("[QA] Config check:");
  console.log(`  BUBBLEWHATS_API_URL: ${process.env.BUBBLEWHATS_API_URL ? "SET" : "MISSING"}`);
  console.log(`  BUBBLEWHATS_TOKEN: ${process.env.BUBBLEWHATS_TOKEN ? "SET" : "MISSING"}`);
  console.log(`  RESEND_API_KEY: ${process.env.RESEND_API_KEY ? "SET" : "MISSING"}`);
  console.log(`  RESEND_FROM_EMAIL: ${process.env.RESEND_FROM_EMAIL || "(default)"}`);

  const prisma = createPrismaClient();
  const repo = new PrismaScheduledMessageRepository(prisma);
  const whatsapp = new BubbleWhatsAdapter();
  const email = new ResendEmailAdapter();
  const copywriter = new PostSaleAiCopywriterService();

  const useCase = new ProcessScheduledMessagesUseCase(repo, whatsapp, email, copywriter);

  console.log("\n[QA] Running ProcessScheduledMessagesUseCase.execute()...");
  const stats = await useCase.execute();

  console.log("\n[QA] RESULT:");
  console.log(`  Processed: ${stats.processed}`);
  console.log(`  Sent: ${stats.sent}`);
  console.log(`  Failed: ${stats.failed}`);

  // Show final status of test messages
  const msgs = await prisma.postSaleScheduledMessage.findMany({
    where: { id: { startsWith: "psm_test" } },
    select: { id: true, type: true, channel: true, status: true, sentAt: true, messageContent: true },
  });
  console.log("\n[QA] Test message final states:");
  for (const m of msgs) {
    console.log(`  ${m.id} [${m.channel}] → ${m.status}${m.sentAt ? " @ " + m.sentAt.toISOString() : ""}`);
    if (m.messageContent) console.log(`    content: ${m.messageContent.slice(0, 100)}`);
  }

  await prisma.$disconnect();
  console.log("\n[QA] Done.");
}

main().catch((e) => {
  console.error("[QA] FATAL:", e);
  process.exit(1);
});
