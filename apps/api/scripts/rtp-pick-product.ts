import { config } from "dotenv";
import { resolve } from "path";
config({ path: resolve(import.meta.dirname ?? __dirname, "..", ".env") });
import { createPrismaClient } from "../src/shared/persistence/prisma-client.js";
const prisma = createPrismaClient();
async function main() {
  const p = await prisma.product.findFirst({
    where: { merchantId: process.env.RTP_MERCHANT_ID!, isActive: true, deletedAt: null },
    select: { id: true, name: true, slug: true },
  });
  // also grab a variant if the schema requires variant-level purchase
  let variant = null as null | { id: string; price: unknown };
  if (p) {
    variant = await prisma.productVariant.findFirst({ where: { productId: p.id }, select: { id: true, price: true } });
  }
  console.log("PICK=" + JSON.stringify({ product: p, variant }));
}
main().catch((e) => console.error("ERR", e instanceof Error ? e.message : e)).finally(() => prisma.$disconnect());
