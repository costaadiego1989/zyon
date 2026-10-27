/**
 * Simulates a status change to "shipped" to test notification dispatch.
 * Calls the API directly via HTTP (same as dashboard would).
 *
 * Usage:
 *   DATABASE_URL=postgresql://... npx tsx src/seeds/notification-test-seed.ts
 *   Then: npx tsx src/seeds/test-status-change.ts
 */
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: resolve(import.meta.dirname ?? ".", "../.env") });

const API_URL = process.env.API_URL || "http://localhost:3009";

// First, login to get a session cookie
async function login(): Promise<string> {
  // Try using the test seed endpoint to get a token for test_001
  const resp = await fetch(`${API_URL}/__test__/seed`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchantId: "test_001" }),
  });
  if (resp.ok) {
    const data = await resp.json() as { token?: string };
    if (data.token) return data.token;
  }

  throw new Error(`Cannot authenticate. Status: ${resp.status}. Try logging in via dashboard first.`);
}

async function main() {
  // Get order ID
  const { createPrismaClient } = await import("../shared/persistence/prisma-client.js");
  const prisma = createPrismaClient();
  const order = await prisma.completedOrder.findFirst({
    where: { externalOrderId: "ORD-NOTIF-TEST-001" },
  });
  await prisma.$disconnect();

  if (!order) {
    console.error("❌ Order ORD-NOTIF-TEST-001 not found. Run notification-test-seed.ts first.");
    process.exit(1);
  }

  console.log(`Order: ${order.id} (status: ${order.status})`);
  console.log(`Changing status to "shipped"...`);

  // Call status change endpoint
  const resp = await fetch(`${API_URL}/orders/${order.id}/status`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-merchant-id": "test_001",
    },
    body: JSON.stringify({ status: "shipped" }),
  });

  const body = await resp.text();
  console.log(`Response: ${resp.status}`);
  console.log(body);

  if (resp.ok) {
    console.log("\n✅ Status changed. Check:");
    console.log("   - API logs for BubbleWhats message send");
    console.log("   - API logs for Resend email (or RESEND_API_KEY warning)");
    console.log("   - WhatsApp +5521993001883 for notification");
    console.log("   - Email costaadiego1989@gmail.com");
  }
}

main().catch(console.error);
