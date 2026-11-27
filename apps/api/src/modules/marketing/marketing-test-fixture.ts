import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaMarketingRepository } from "./infrastructure/prisma-marketing.repository.js";
import type { MarketingContact } from "./domain/marketing.js";

export function marketingTestFixture() {
  const url =
    process.env.MARKETING_TEST_DATABASE_URL ??
    "postgresql://marketing:marketing-local-only@127.0.0.1:15447/marketing";
  if (!new URL(url).hostname.match(/^(127\.0\.0\.1|localhost)$/))
    throw new Error("marketing_tests_require_local_database");
  const db = new PrismaClient({ datasources: { db: { url } } });
  const repository = new PrismaMarketingRepository(db);
  const merchantId = `marketing-test-${randomUUID()}`;
  const now = "2026-11-27T12:00:00.000Z";
  const contact = (
    overrides: Partial<MarketingContact> = {}
  ): MarketingContact => ({
    id: randomUUID(),
    merchantId,
    identityKey: randomUUID(),
    accountId: null,
    phone: null,
    name: null,
    email: null,
    origin: "whatsapp",
    channels: ["whatsapp"],
    stage: "new",
    stageAt: now,
    firstSeenAt: now,
    lastSeenAt: now,
    version: 0,
    purchaseCount: 0,
    totalSpentCents: 0,
    lastPurchaseAt: null,
    interests: [],
    ...overrides,
  });
  const cleanup = async () => {
    for (const table of [
      "marketing_messages",
      "marketing_conversations",
      "marketing_campaign_recipients",
      "marketing_campaigns",
      "marketing_contacts",
      "marketing_consents",
      "marketing_stage_history",
      "marketing_settings",
      "marketing_event_receipts",
      "marketing_purchase_receipts",
      "marketing_commercial_dispatches",
      "marketing_history_jobs",
      "marketing_suppressions",
    ]) {
      await db.$executeRawUnsafe(
        `DELETE FROM ${table} WHERE merchant_id=$1`,
        merchantId
      );
    }
    await db.$disconnect();
  };
  return { db, repository, merchantId, now, contact, cleanup };
}
