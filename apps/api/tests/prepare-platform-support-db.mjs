import { PrismaClient } from "@prisma/client";
import { readFile } from "node:fs/promises";

const database = process.env.PLATFORM_SUPPORT_TEST_DATABASE_URL;
if (!database) throw new Error("PLATFORM_SUPPORT_TEST_DATABASE_URL required");
const url = new URL(database);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || url.pathname !== "/support_test") throw new Error("requires_dedicated_local_support_test_database");
const prisma = new PrismaClient({ datasources: { db: { url: database } } });
try {
  const sql = await readFile(new URL("../prisma/deploy-migrations/20261018160000_platform_technical_support/migration.sql", import.meta.url), "utf8");
  await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("DROP TABLE IF EXISTS platform_support_reads, platform_support_notes, platform_support_messages, platform_support_tickets CASCADE");
    for (const statement of sql.split(";").map(part => part.trim()).filter(Boolean)) await tx.$executeRawUnsafe(statement);
  });
  console.log("Technical-support deployment migration applied to the dedicated local test database.");
} finally { await prisma.$disconnect(); }
