import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const p = createPrismaClient();
const conn = await (p as any).merchantPaymentConnection.findUnique({
  where: { merchantId_provider: { merchantId: "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa", provider: "stripe" } },
});
console.log("DB Stripe connection:", JSON.stringify(conn, null, 2));

// Also check what accounts exist on the Stripe platform
const STRIPE_KEY = process.env.STRIPE_SECRET_KEY_TEST!;
const res = await fetch("https://api.stripe.com/v1/accounts?limit=10", {
  headers: { Authorization: `Bearer ${STRIPE_KEY}` },
});
const accounts = await res.json();
console.log("\n=== STRIPE CONNECTED ACCOUNTS (test mode) ===");
for (const a of accounts.data ?? []) {
  console.log(`  ${a.id} | email=${a.email} | charges=${a.charges_enabled} | payouts=${a.payouts_enabled} | details_submitted=${a.details_submitted}`);
}

await p.$disconnect();
