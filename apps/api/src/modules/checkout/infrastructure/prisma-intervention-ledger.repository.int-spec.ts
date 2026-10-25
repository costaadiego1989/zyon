import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { PrismaInterventionLedgerRepository } from "./prisma-intervention-ledger.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "PrismaInterventionLedgerRepository counts and orders last occurrence per session",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    const prisma = createPrismaClient();
    const merchantId = `mrc_led_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;
    const sessionId = `chk_${crypto.randomUUID().replace(/-/g, "").slice(0, 24)}`;

    try {
      const sut = new PrismaInterventionLedgerRepository(prisma);
      await sut.record({
        merchantId,
        sessionId,
        occurredAtUnix: 1_704_067_000,
        reason: "agent_trigger_allowed"
      });
      await sut.record({
        merchantId,
        sessionId,
        occurredAtUnix: 1_704_067_200,
        reason: "agent_trigger_allowed"
      });

      assert.equal(await sut.countForSession(merchantId, sessionId), 2);
      assert.equal(await sut.lastOccurredAt(merchantId, sessionId), 1_704_067_200);

      await sut.record({
        merchantId,
        sessionId,
        occurredAtUnix: 1_704_067_100,
        reason: "agent_trigger_allowed"
      });
      assert.equal(await sut.countForSession(merchantId, sessionId), 3);
      assert.equal(await sut.lastOccurredAt(merchantId, sessionId), 1_704_067_200);
    } finally {
      await prisma.checkoutIntervention.deleteMany({ where: { merchantId } });
      await prisma.$disconnect();
    }
  }
);
