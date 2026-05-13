import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL_required_for_prisma_checkout_repository");
  }

  const adapter = new PrismaPg(
    {
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
    {
      onPoolError: (err: Error) => {
        console.error("[PrismaPool] Unexpected pool error:", err.message);
      },
      disposeExternalPool: true,
    },
  );
  return new PrismaClient({ adapter });
}
