import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "intent memory enforces consent ownership and cascades erasure",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantA = `mrc_intent_${crypto.randomUUID()}`;
    const merchantB = `mrc_intent_${crypto.randomUUID()}`;
    const buyer = `buyer_${crypto.randomUUID()}`;
    const record = (merchantId: string, id: string) => ({
      id,
      merchantId,
      globalUserId: buyer,
      primaryIntent: "price_sensitive",
      urgency: "high",
      budgetTier: "budget",
      categoryFocus: ["sku-1"],
      painPoints: ["price"],
      conversionLikelihoodPct: 45,
      behavioralSignalsJson: { items_viewed: 2 },
      generatedAt: new Date(),
    });

    try {
      const expiresAt = new Date(Date.now() + 60_000);
      await prisma.buyerIntentMemoryConsent.createMany({
        data: [
          { merchantId: merchantA, globalUserId: buyer, optedIn: true, expiresAt },
          { merchantId: merchantB, globalUserId: buyer, optedIn: true, expiresAt },
        ],
      });
      await prisma.customerIntentRecord.create({ data: record(merchantA, `int_${crypto.randomUUID()}`) });
      await prisma.customerIntentRecord.create({ data: record(merchantB, `int_${crypto.randomUUID()}`) });

      await assert.rejects(
        prisma.customerIntentRecord.create({ data: record(`mrc_missing_${crypto.randomUUID()}`, `int_${crypto.randomUUID()}`) }),
      );

      await prisma.buyerIntentMemoryConsent.delete({
        where: { merchantId_globalUserId: { merchantId: merchantA, globalUserId: buyer } },
      });
      assert.equal(await prisma.customerIntentRecord.count({ where: { merchantId: merchantA, globalUserId: buyer } }), 0);
      assert.equal(await prisma.customerIntentRecord.count({ where: { merchantId: merchantB, globalUserId: buyer } }), 1);
    } finally {
      await prisma.buyerIntentMemoryConsent.deleteMany({ where: { merchantId: { in: [merchantA, merchantB] } } });
      await prisma.$disconnect();
    }
  },
);
