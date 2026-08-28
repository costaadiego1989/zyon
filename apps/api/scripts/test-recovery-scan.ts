import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { RecoveryScannerJob } from "../src/modules/cart-recovery/infrastructure/jobs/recovery-scanner.job.js";
import { PrismaRecoveryAttemptRepository } from "../src/modules/cart-recovery/infrastructure/repositories/prisma-recovery-attempt.repository.js";
import { PrismaStrategyPreferencesRepository } from "../src/modules/cart-recovery/infrastructure/repositories/prisma-strategy-preferences.repository.js";
import { PrismaCheckoutRepository } from "../src/modules/checkout/infrastructure/prisma/prisma-checkout.repository.js";
import { PrismaMerchantRepository } from "../src/modules/merchant/infrastructure/prisma-merchant.repository.js";
import { PrismaBuyerPurchaseHistoryRepository } from "../src/modules/buyer-purchase-history/infrastructure/prisma-buyer-purchase-history.repository.js";
import { PrismaBuyerAccountRepository } from "../src/modules/buyer-account/infrastructure/prisma-buyer-account.repository.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });
const MID = "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa";

const waSent: string[] = [], emailSent: string[] = [];
const wa = { send: async (m: any) => { waSent.push(m.phone); } };
const email = { send: async (m: any) => { emailSent.push(m.to); return { messageId: "x", status: "sent" as const }; } };

async function main() {
  const scanner = new RecoveryScannerJob(
    new PrismaCheckoutRepository(prisma as any) as any,
    new PrismaRecoveryAttemptRepository(prisma as any) as any,
    new PrismaMerchantRepository(prisma as any) as any,
    new PrismaStrategyPreferencesRepository(prisma as any) as any,
    new PrismaBuyerPurchaseHistoryRepository(prisma as any) as any,
    prisma as any,
    wa as any,
    email as any,
    new PrismaBuyerAccountRepository(prisma as any) as any,
  );
  await prisma.recoveryAttempt.deleteMany({ where: { merchantId: MID } });
  const stats = await scanner.scan();
  // Let fire-and-forget sends settle before reporting.
  await new Promise((r) => setTimeout(r, 500));
  console.log("scan stats:", JSON.stringify(stats));
  console.log("whatsapp sent:", waSent.length, "| email sent:", emailSent.length);
  console.log("whatsapp recipients:", JSON.stringify(waSent), "| email recipients:", JSON.stringify(emailSent));
  const byStatus = await prisma.recoveryAttempt.groupBy({ by: ["status"], where: { merchantId: MID }, _count: true });
  console.log("attempts by status:", JSON.stringify(byStatus));
  await prisma.$disconnect();
}
main().catch((e) => { console.error("ERR", e.message); process.exit(1); });
