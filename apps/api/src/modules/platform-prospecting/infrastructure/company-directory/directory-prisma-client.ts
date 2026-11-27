import { PrismaClient } from "../../../../../node_modules/.prisma/company-directory/index.js";
import { assertSameProspectingDatabase } from "../prospecting-config.js";

/** Dedicated URL and pool. Never inherits DATABASE_URL or a merchant connection. */
export function createDirectoryPrismaClient(config: { databaseUrl: string; directoryDatabaseUrl: string; directoryPoolSize: number }): PrismaClient {
  assertSameProspectingDatabase(config.databaseUrl, config.directoryDatabaseUrl);
  if (!Number.isSafeInteger(config.directoryPoolSize) || config.directoryPoolSize < 1 || config.directoryPoolSize > 20) throw new Error("config_invalid:DIRECTORY_POOL_SIZE");
  const url = new URL(config.directoryDatabaseUrl);
  if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error("config_invalid:DIRECTORY_DATABASE_URL");
  if (url.searchParams.has("schema") && url.searchParams.get("schema") !== "company_directory") throw new Error("config_invalid:DIRECTORY_SCHEMA");
  url.searchParams.set("schema", "company_directory");
  url.searchParams.set("connection_limit", String(config.directoryPoolSize));
  return new PrismaClient({ datasources: { db: { url: url.href } } });
}
