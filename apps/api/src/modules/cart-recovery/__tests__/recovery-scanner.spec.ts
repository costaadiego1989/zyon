import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryStrategyPreferencesRepository } from "../infrastructure/repositories/in-memory-strategy-preferences.repository.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";
import { InMemoryBuyerAccountRepository } from "../../buyer-account/infrastructure/in-memory-buyer-account.repository.js";
import { BuyerAccount } from "../../buyer-account/domain/entities/buyer-account.entity.js";

for (const eventLookup of ["empty", "failed"] as const) {
  test(`RecoveryScannerJob cannot invent abandonment when event lookup is ${eventLookup}`, async (context) => {
    // Exercise the public scan without scheduling the Nest lifecycle interval.
    // Math.random controls jitter; the clock advances without a real sleep.
    context.mock.method(Math, "random", () => 0.5);
    const now = new Date("2026-09-05T12:00:00Z");
    const inactiveAt = new Date(now.getTime() - 31 * 60 * 1000);
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now });

    const session = checkoutSession({
      triggerAgent: true,
      abandonmentScore: 0.95,
      customer: { email: "buyer@example.invalid" },
      createdAt: now.toISOString(),
      updatedAt: inactiveAt.toISOString(),
    });
    const sessions = new InMemoryCheckoutRepository();
    await sessions.saveSession(session);
    const attempts = new InMemoryRecoveryAttemptRepository();
    const saveAttempt = context.mock.method(attempts, "save");
    const preferences = new InMemoryStrategyPreferencesRepository();
    const selectStrategy = context.mock.method(preferences, "getConfig");
    const buyers = new InMemoryBuyerAccountRepository();
    await buyers.save(new BuyerAccount({
      globalUserId: session.globalUserId,
      email: "buyer@example.invalid",
      passwordHash: null,
      displayName: "Sandbox Buyer",
      phone: "sandbox-test-phone",
      createdAt: now,
      updatedAt: now,
    }));

    const eventQueries: unknown[] = [];
    const prisma = {
      checkoutEvent: {
        findMany: async (query: unknown) => {
          eventQueries.push(query);
          if (eventLookup === "failed") throw new Error("sandbox event store unavailable");
          return [];
        },
      },
      merchant: { findUnique: async () => ({ name: "Sandbox Store" }) },
    } as unknown as PrismaClient;
    let recoveryCalls = 0;
    const scanner = new RecoveryScannerJob(
      sessions,
      attempts,
      { getRules: async () => merchantRules(), updateRules: async () => merchantRules() },
      preferences,
      new InMemoryBuyerPurchaseHistoryRepository(),
      prisma,
      { execute: async () => { recoveryCalls++; return { created: true, attemptId: "unexpected" }; } },
      buyers,
    );

    const scan = scanner.scan();
    context.mock.timers.tick(15_000);
    const result = await scan;

    assert.equal(result.scanned, 1, "the high-score triggered session must reach the scanner");
    assert.equal(result.errors, 0);
    assert.deepEqual(eventQueries, [{
      where: { merchantId: session.merchantId, sessionId: session.sessionId },
      orderBy: { occurredAt: "asc" },
      select: { eventName: true },
    }], "the suppression must depend on the real scoped event lookup");
    assert.equal(selectStrategy.mock.callCount(), 0, "missing events must stop before strategy selection");
    assert.equal(saveAttempt.mock.callCount(), 0, "missing events must not create or update an attempt");
    assert.deepEqual(attempts.getAll(), []);
    assert.equal(recoveryCalls, 0, "missing events must not reach any delivery route");
    assert.deepEqual(await sessions.getSession(session.merchantId, session.sessionId), session);
    // The legacy attempted counter measures processed candidates, including
    // skipped sessions, so durable attempts and sender effects are checked above.
  });
}

for (const authority of ["completed_order", "approved_payment"] as const) {
  test(`RecoveryScannerJob suppresses recovery when ${authority.replace("_", " ")} is authoritative`, async (context) => {
    context.mock.method(Math, "random", () => 0.5);
    const now = new Date("2026-09-05T12:00:00Z");
    context.mock.timers.enable({ apis: ["setTimeout", "Date"], now });
    const session = checkoutSession({ triggerAgent: true, abandonmentScore: 0.95,
      updatedAt: new Date(now.getTime() - 31 * 60 * 1000).toISOString() });
    const sessions = new InMemoryCheckoutRepository();
    await sessions.saveSession(session);
    let recoveryCalls = 0;
    const prisma = {
      checkoutEvent: { async findMany() { return [{ eventName: "shipping_objection_detected" }]; } },
      merchant: { async findUnique() { return { name: "Sandbox Store" }; } },
      completedOrder: { async findFirst() { return authority === "completed_order" ? { id: "order" } : null; } },
      paymentIntent: { async findFirst() { return authority === "approved_payment" ? { id: "payment" } : null; } },
    } as unknown as PrismaClient;
    const scanner = new RecoveryScannerJob(
      sessions, new InMemoryRecoveryAttemptRepository(),
      { getRules: async () => merchantRules(), updateRules: async () => merchantRules() },
      new InMemoryStrategyPreferencesRepository(), new InMemoryBuyerPurchaseHistoryRepository(), prisma,
      { async execute() { recoveryCalls++; return { created: true, attemptId: "unexpected" }; } },
    );
    const scan = scanner.scan();
    context.mock.timers.tick(15_000);
    await scan;
    assert.equal(recoveryCalls, 0);
  });
}
