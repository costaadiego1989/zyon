import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { PrismaRecoveryAttemptRepository } from "../infrastructure/repositories/prisma-recovery-attempt.repository.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";

const from = new Date("2026-09-01T00:00:00.000Z");
const to = new Date("2026-09-05T00:00:00.000Z");

test("recovery metrics count observed attempts without inventing abandonment or revenue", async () => {
  let query: unknown;
  const prisma = {
    recoveryAttempt: {
      findMany: async (args: unknown) => {
        query = args;
        return [
          { status: "sent", strategyJson: { type: "address_objection" } },
          { status: "recovered", strategyJson: { type: "address_objection" } },
        ];
      },
    },
  } as unknown as PrismaClient;
  const result = await new PrismaRecoveryAttemptRepository(prisma).getMetrics("merchant-a", from, to);
  assert.deepEqual(query, {
    where: { merchantId: "merchant-a", createdAt: { gte: from, lte: to } },
    select: { strategyJson: true, status: true },
  });
  assert.deepEqual(result, {
    total_abandoned: null,
    recovery_attempts: 2,
    recovered: 1,
    recovery_rate: 0.5,
    revenue_recovered_cents: null,
    top_strategy: "address_objection",
  });
});

test("an empty sample has no measured recovery rate in either repository", async () => {
  const prisma = { recoveryAttempt: { findMany: async () => [] } } as unknown as PrismaClient;
  for (const repository of [new PrismaRecoveryAttemptRepository(prisma), new InMemoryRecoveryAttemptRepository()]) {
    const result = await repository.getMetrics("merchant-a", from, to);
    assert.equal(result.recovery_attempts, 0);
    assert.equal(result.recovered, 0);
    assert.equal(result.recovery_rate, null);
    assert.equal(result.total_abandoned, null);
    assert.equal(result.revenue_recovered_cents, null);
  }
});

test("a database failure cannot produce successful fabricated metrics", async () => {
  const error = new Error("database unavailable");
  const prisma = { recoveryAttempt: { findMany: async () => { throw error; } } } as unknown as PrismaClient;
  await assert.rejects(new PrismaRecoveryAttemptRepository(prisma).getMetrics("merchant-a", from, to), error);
});
