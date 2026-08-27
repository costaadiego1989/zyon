import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });

import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
import { BubbleWhatsAdapter } from "../src/modules/notifications/infrastructure/adapters/bubblewhats.adapter.js";
import { PrismaPostSaleTemplateRepository } from "../src/modules/post-sale/infrastructure/repositories/prisma-post-sale-template.repository.js";
import { PostSaleAiCopywriterService } from "../src/modules/post-sale/application/services/post-sale-ai-copywriter.service.js";

const MERCHANT_ID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";
const PHONE = "5521993001883";

const prisma = createPrismaClient();
const templateRepo = new PrismaPostSaleTemplateRepository(prisma);
const copywriter = new PostSaleAiCopywriterService(templateRepo);
const whatsapp = new BubbleWhatsAdapter();

// Generate NPS message
const msg = await copywriter.generate({ type: "nps", buyerName: "Diego", productName: "Tênis Runner Pro", merchantId: MERCHANT_ID, buyerId: "buyer_test" });
console.log("[SEND] NPS message:", msg.slice(0, 120));

// Send via WhatsApp
await whatsapp.send({ phone: PHONE, message: msg });
console.log("[SEND] ✓ WhatsApp sent to", PHONE);

// Delete old sessions for this phone + create new one with NPS context
await (prisma as any).whatsAppSession.deleteMany({ where: { buyerPhone: PHONE, merchantId: MERCHANT_ID } });
const session = await (prisma as any).whatsAppSession.create({
  data: {
    merchantId: MERCHANT_ID,
    buyerPhone: PHONE,
    deviceId: "post-sale-outbound",
    currentOptions: JSON.stringify([]),
    previousOptions: JSON.stringify([]),
    currentPage: 0,
    lastActivityAt: new Date(),
    status: "active",
    postSaleContext: { stage: "awaiting_nps", orderId: "ORD-REPLY-E2E", buyerId: "buyer_reply_test", askedAt: new Date().toISOString() },
  },
});
console.log("[CTX] ✓ Session created:", session.id);
console.log("[CTX] postSaleContext:", JSON.stringify(session.postSaleContext));
console.log("\n[READY] Mensagem enviada. Responda com um número 0-10 no WhatsApp.");
console.log("[READY] Monitorando logs da API para captura de resposta...");

await prisma.$disconnect();
