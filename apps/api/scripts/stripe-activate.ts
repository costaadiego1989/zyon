import { config } from "dotenv";
import { resolve } from "node:path";
config({ path: resolve(process.cwd(), ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const p = createPrismaClient();
const MID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

// Force Stripe connection to active for testing (account acct_1U4ByVLXuUaROxMi has details_submitted=true)
await (p as any).merchantPaymentConnection.update({
  where: { merchantId_provider: { merchantId: MID, provider: "stripe" } },
  data: {
    status: "active",
    externalAccountId: "acct_1U4ByVLXuUaROxMi",
    chargesEnabled: true,
    payoutsEnabled: false,
    lastSyncedAt: new Date(),
  },
});
console.log("✓ Stripe connection set to active (acct_1U4ByVLXuUaROxMi)");

// Verify
const conn = await (p as any).merchantPaymentConnection.findUnique({
  where: { merchantId_provider: { merchantId: MID, provider: "stripe" } },
});
console.log("Status:", conn.status, "| Charges:", conn.chargesEnabled, "| Account:", conn.externalAccountId);
await p.$disconnect();
