import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { RecoveryScannerJob } from "../infrastructure/jobs/recovery-scanner.job.js";
import { InMemoryRecoveryAttemptRepository } from "../infrastructure/repositories/in-memory-recovery-attempt.repository.js";
import { InMemoryStrategyPreferencesRepository } from "../infrastructure/repositories/in-memory-strategy-preferences.repository.js";
import { InMemoryCheckoutRepository } from "../../checkout/infrastructure/repositories/in-memory-checkout.repository.js";
import { checkoutSession, merchantRules } from "../../checkout/__tests__/checkout-test-fixtures.js";
import { InMemoryBuyerPurchaseHistoryRepository } from "../../buyer-purchase-history/infrastructure/in-memory-buyer-purchase-history.repository.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

async function fixture(context: TestContext) {
  const now = new Date("2026-11-14T12:00:00Z");
  context.mock.method(Math, "random", () => 0.5);
  context.mock.timers.enable({ apis: ["setTimeout", "setInterval", "Date"], now });
  const session = checkoutSession({ triggerAgent: true, abandonmentScore: 0.95,
    updatedAt: new Date(now.getTime() - 31 * 60_000).toISOString() });
  const sessions = new InMemoryCheckoutRepository();
  await sessions.saveSession(session);
  const attempts = new InMemoryRecoveryAttemptRepository();
  const preferences = new InMemoryStrategyPreferencesRepository();
  await preferences.saveConfig(session.merchantId, { active_strategy: "offer_coupon", coupon_code: "SAVE" });
  const prisma = {
    checkoutEvent: { findMany: async () => [{ eventName: "shipping_objection_detected" }] },
    merchant: { findUnique: async () => ({ name: "Synthetic store" }) },
    completedOrder: { findFirst: async (): Promise<{ id: string } | null> => null },
    paymentIntent: { findFirst: async () => null },
  };
  let recoveries = 0;
  const attemptRecovery = { execute: async () => { recoveries++; return { created: true, attemptId: "synthetic-attempt" }; } };
  const scanner = new RecoveryScannerJob(sessions, attempts,
    { getRules: async () => merchantRules(), updateRules: async () => merchantRules() },
    preferences, new InMemoryBuyerPurchaseHistoryRepository(), prisma as unknown as PrismaClient,
    attemptRecovery);
  return { scanner, session, sessions, attempts, prisma, attemptRecovery, recoveries: () => recoveries };
}

test("RecoveryScanner lifecycle", async t => {
  await t.test("destroy resolves the owned jitter and drains the scan without a later query", async context => {
    const f = await fixture(context);
    const query = context.mock.method(f.sessions, "findSessionsWithTrigger", async () => []);
    let settled = false;
    const scan = f.scanner.scan().then(result => { settled = true; return result; });
    try {
      await f.scanner.onModuleDestroy();
      assert.equal(settled, true, "destroy must drain the scan during its owned jitter");
      assert.equal(query.mock.callCount(), 0);
      assert.equal(f.recoveries(), 0);
    } finally {
      context.mock.timers.tick(5000);
      await scan;
    }
    assert.equal(query.mock.callCount(), 0, "stopped jitter must never resume database work");
  });

  await t.test("destroy waits for an entered query and its result cannot start candidate processing", async context => {
    const f = await fixture(context), entered = deferred<void>(), result = deferred<Array<typeof f.session>>();
    context.mock.method(f.sessions, "findSessionsWithTrigger", async () => { entered.resolve(); return result.promise; });
    const candidateRead = context.mock.method(f.attempts, "existsForSession");
    const scan = f.scanner.scan();
    context.mock.timers.tick(2500);
    await entered.promise;
    let stopped = false;
    const stop = Promise.resolve(f.scanner.onModuleDestroy()).then(() => { stopped = true; });
    try {
      await Promise.resolve();
      assert.equal(stopped, false, "destroy must wait while the actual query is pending");
    } finally {
      result.resolve([f.session]);
      await scan;
      await stop;
    }
    assert.equal(stopped, true);
    assert.equal(candidateRead.mock.callCount(), 0);
    assert.equal(f.recoveries(), 0);
    assert.deepEqual(f.attempts.getAll(), []);
    assert.deepEqual(await f.sessions.getSession(f.session.merchantId, f.session.sessionId), f.session);
  });

  await t.test("stop during final eligibility waits for the query and prevents further authority reads or dispatch", async context => {
    const f = await fixture(context), entered = deferred<void>(), result = deferred<{ id: string } | null>();
    context.mock.method(f.prisma.completedOrder, "findFirst", async () => { entered.resolve(); return result.promise; });
    const paymentRead = context.mock.method(f.prisma.paymentIntent, "findFirst");
    const scan = f.scanner.scan();
    context.mock.timers.tick(2500);
    await entered.promise;
    let stopped = false;
    const stop = Promise.resolve(f.scanner.onModuleDestroy()).then(() => { stopped = true; });
    try {
      await Promise.resolve();
      assert.equal(stopped, false);
    } finally {
      result.resolve(null);
      await scan;
      await stop;
    }
    assert.equal(paymentRead.mock.callCount(), 0);
    assert.equal(f.recoveries(), 0);
    assert.deepEqual(f.attempts.getAll(), []);
  });

  await t.test("start init and direct scan cannot resurrect a destroyed job", async context => {
    const f = await fixture(context);
    const query = context.mock.method(f.sessions, "findSessionsWithTrigger", async () => []);
    await f.scanner.onModuleDestroy();
    f.scanner.start();
    f.scanner.onModuleInit();
    const scan = f.scanner.scan();
    context.mock.timers.tick(120_000);
    await scan;
    await f.scanner.onModuleDestroy();
    assert.equal(query.mock.callCount(), 0);
    assert.equal(f.recoveries(), 0);
  });

  await t.test("destroy drains a recovery already dispatched and retains the processed-candidate counter", async context => {
    const f = await fixture(context), entered = deferred<void>(), result = deferred<{ created: boolean; attemptId: string }>();
    let deliveryCompleted = false;
    const dispatch = context.mock.method(f.attemptRecovery, "execute", async () => {
      entered.resolve();
      const receipt = await result.promise;
      deliveryCompleted = true;
      return receipt;
    });
    const scan = f.scanner.scan();
    context.mock.timers.tick(2500);
    await entered.promise;
    let stopped = false;
    const stop = Promise.resolve(f.scanner.onModuleDestroy()).then(() => { stopped = true; });
    try {
      await Promise.resolve();
      assert.equal(stopped, false);
      assert.equal(deliveryCompleted, false);
    } finally {
      result.resolve({ created: true, attemptId: "synthetic-settled-attempt" });
      await stop;
    }
    const summary = await scan;
    assert.equal(deliveryCompleted, true);
    assert.equal(dispatch.mock.callCount(), 1);
    assert.deepEqual(summary, { scanned: 1, attempted: 1, errors: 0 });
  });
});
