import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Logger } from "@nestjs/common";

const logger = new Logger("PrismaPool");

export function createPrismaClient(connectionString = process.env.DATABASE_URL): PrismaClient {
  if (!connectionString) {
    throw new Error("DATABASE_URL_required_for_prisma_checkout_repository");
  }

  const poolSize = parseInt(process.env.DB_POOL_SIZE || "20", 10);

  const adapter = new PrismaPg(
    {
      connectionString,
      max: poolSize,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 15_000,
      allowExitOnIdle: false,
      keepAlive: true,
      keepAliveInitialDelayMillis: 10_000,
    },
    {
      onPoolError: (err: Error) => {
        logger.error("pool.error", { error: err.message });
      },
      disposeExternalPool: true,
    },
  );
  return new PrismaClient({ adapter });
}
