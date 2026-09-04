import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
const prisma = createPrismaClient();
async function main() {
  const m = await prisma.merchant.findUnique({
    where: { id: process.env.RTP_MERCHANT_ID! },
    select: { storeSettings: true },
  });
  const ss = (m?.storeSettings ?? {}) as Record<string, unknown>;
  console.log("SLUG=" + JSON.stringify(ss.slug ?? null));
}
main().catch((e) => console.error(e)).finally(() => prisma.$disconnect());
