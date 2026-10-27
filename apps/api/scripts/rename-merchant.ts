import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL || "postgresql://atendeai:atendeai_dev@127.0.0.1:5434/aacp_dev?schema=public",
});

async function main() {
  const updated = await prisma.merchant.update({
    where: { id: "mrc_3fe4436c-bde8-4b3b-b773-3d4374a414fa" },
    data: { name: "Cosmos" },
  });
  console.log("Updated merchant name to:", updated.name);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
