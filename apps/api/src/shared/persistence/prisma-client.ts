import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL_required_for_prisma_checkout_repository");
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
