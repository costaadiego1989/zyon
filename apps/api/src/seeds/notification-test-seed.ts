/**
 * Notification test seed — creates a test order with Diego's contact info
 * so we can test email (Resend) and WhatsApp (BubbleWhats) notifications
 * when changing order status to "shipped" or "delivered".
 *
 * Usage:
 *   DATABASE_URL=postgresql://... MERCHANT_ID=mrc_xxx npx tsx src/seeds/notification-test-seed.ts
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { createPrismaClient } from "../shared/persistence/prisma-client.js";

loadDotenv({ path: resolve(import.meta.dirname ?? ".", "../.env") });

const MERCHANT_ID = process.env.MERCHANT_ID;
if (!MERCHANT_ID) {
  console.error("MERCHANT_ID env var required");
  process.exit(1);
}

const TEST_CUSTOMER = {
  full_name: "Diego Costa",
  email: "costaadiego1989@gmail.com",
  phone: "21993001883",
  document: "12345678900",
  address: {
    zip: "20040020",
    street: "Av. Rio Branco",
    number: "1",
    city: "Rio de Janeiro",
    state: "RJ",
  },
};

async function main() {
  const prisma = createPrismaClient();

  try {
    const sessionId = `notif_test_${Date.now().toString(36)}`;
    const externalOrderId = `ORD-NOTIF-TEST-001`;

    // Create checkout session with customer data
    await prisma.checkoutSession.create({
      data: {
        id: `sess_notif_${Date.now().toString(36)}`,
        merchantId: MERCHANT_ID!,
        sessionId,
        globalUserId: `guser_diego_test`,
        conversationId: `conv_notif_test`,
        cart: {
          items: [
            { name: "Camiseta Premium Preta", sku: "CAM-PREM-01", price: 4990, quantity: 2 },
            { name: "Calca Jogger Cinza", sku: "CALCA-JOG-01", price: 6010, quantity: 1 },
          ],
          total: 15990,
        },
        customer: TEST_CUSTOMER,
        abandonmentScore: 0,
        chatHistory: [],
        version: 0,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Create completed order (status: approved — ready to test shipped/delivered)
    await prisma.completedOrder.create({
      data: {
        id: `ord_notif_${Date.now().toString(36)}`,
        merchantId: MERCHANT_ID!,
        sessionId,
        externalOrderId,
        orderTotal: 15990,
        currency: "BRL",
        status: "approved",
        completedAt: new Date(),
      },
    });

    console.log("✅ Notification test seed created:");
    console.log(`   Session: ${sessionId}`);
    console.log(`   Order: ${externalOrderId}`);
    console.log(`   Customer: ${TEST_CUSTOMER.full_name}`);
    console.log(`   Email: ${TEST_CUSTOMER.email}`);
    console.log(`   WhatsApp: +55${TEST_CUSTOMER.phone}`);
    console.log("");
    console.log("To test:");
    console.log(`   1. Start API: pnpm dev`);
    console.log(`   2. Open dashboard → Pedidos e Envios`);
    console.log(`   3. Find order ${externalOrderId}`);
    console.log(`   4. Change status to "Enviado" → should trigger email + WhatsApp`);
    console.log(`   5. Change status to "Entregue" → should trigger email + WhatsApp`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
