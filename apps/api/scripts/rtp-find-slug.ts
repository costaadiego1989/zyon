// RTP audit: discover storefront slug + product counts for the tenant. E3 reads only.
import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";

const prisma = createPrismaClient();
const merchantId = process.env.RTP_MERCHANT_ID!;

async function main() {
  const m = await prisma.merchant.findUnique({
    where: { id: merchantId },
    select: { id: true, name: true, storeSettings: true, plan: true, theme: true },
  });
  const products = await prisma.product.findMany({
    where: { merchantId },
    select: { id: true, name: true, slug: true, isActive: true, deletedAt: true },
    take: 50,
  });
  const activeCount = products.filter((p) => p.isActive && !p.deletedAt).length;
  console.log(
    "RTP_SLUG_START" +
      JSON.stringify({
        merchant: {
          id: m?.id,
          name: m?.name,
          plan: m?.plan,
          storeSettings: m?.storeSettings,
        },
        products_total: products.length,
        products_active: activeCount,
        product_sample: products.slice(0, 8).map((p) => ({ name: p.name, slug: p.slug, active: p.isActive, deleted: !!p.deletedAt })),
      }) +
      "RTP_SLUG_END",
  );
}
main().catch((e) => { console.error("ERR", e instanceof Error ? e.message : e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
