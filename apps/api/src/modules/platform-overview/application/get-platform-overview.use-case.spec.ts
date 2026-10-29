import assert from "node:assert/strict";
import test from "node:test";
import { GetPlatformOverviewUseCase } from "./get-platform-overview.use-case.js";

test("overview preserves source counts and audits the operator read", async () => {
  const auditCalls: unknown[] = [];
  const repository = {
    snapshot: async (now: Date) => ({
      generatedAt: now,
      merchants: { registered: 4, activeUsers: 6 },
      subscriptions: { byStatus: { active: 2, trialing: 1 }, activeRecords: 2, activeTrials: 1 },
      feedback: { received: 3 },
      aiChat: {
        periodStartedAt: new Date("2026-09-01T00:00:00.000Z"),
        usageEvents: 5,
        totalTokens: 1234,
        pricedUsageEvents: 3,
        unpricedUsageEvents: 2,
        knownCostMicros: 42n,
      },
    }),
    recordRead: async (input: unknown) => { auditCalls.push(input); },
  };
  const health = { readiness: async () => ({ ready: true as const, db: "connected" as const, redis: "not_configured" as const }) };
  const receivables = {
    summary: async () => ({
      observedReceivableCount: 2,
      observedSince: new Date("2026-09-14T12:00:00.000Z"),
      openCount: 1,
      openBalanceCents: "19900",
      overdueCount: 1,
      overdueMerchantCount: 1,
      overdueBalanceCents: "9900",
      dueTodayCount: 0,
      dueTodayBalanceCents: "0",
      dueNext7DaysCount: 1,
      dueNext7DaysBalanceCents: "19900",
      nextDueAt: new Date("2026-09-16T12:00:00.000Z"),
      paymentConfirmedCount: 1,
      paymentConfirmedAmountCents: "9900",
      incompleteAmountCount: 0,
      incompleteDueDateCount: 0,
    }),
  };
  const useCase = new GetPlatformOverviewUseCase(repository, health as never, receivables);

  const result = await useCase.execute({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.equal(result.merchants.registered, 4);
  assert.equal(result.subscriptions.active_records, 2);
  assert.equal(result.ai_chat.known_cost_micros, "42");
  assert.equal(result.receivables.overdue_count, 1);
  assert.equal(result.receivables.overdue_known_balance_cents, "9900");
  assert.equal(result.receivables.confirmed_payment_count_since_capture, 1);
  assert.equal(result.sources.receivables.status, "partial");
  assert.match(result.sources.receivables.description, /Asaas, Stripe e Mercado Pago/);
  assert.match(result.sources.infrastructure.description, /snapshots locais/);
  assert.equal(result.sources.delinquency.status, "partial");
  assert.deepEqual(auditCalls, [{ actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" }]);
});

test("overview keeps financial values absent until an authenticated charge is captured", async () => {
  const repository = {
    snapshot: async (now: Date) => ({
      generatedAt: now,
      merchants: { registered: 0, activeUsers: 0 },
      subscriptions: { byStatus: {}, activeRecords: 0, activeTrials: 0 },
      feedback: { received: 0 },
      aiChat: {
        periodStartedAt: now,
        usageEvents: 0,
        totalTokens: 0,
        pricedUsageEvents: 0,
        unpricedUsageEvents: 0,
        knownCostMicros: 0n,
      },
    }),
    recordRead: async () => undefined,
  };
  const health = { readiness: async () => ({ ready: true as const, db: "connected" as const, redis: "connected" as const }) };
  const receivables = {
    summary: async () => ({
      observedReceivableCount: 0,
      openCount: 0,
      overdueCount: 0,
      overdueMerchantCount: 0,
      dueTodayCount: 0,
      dueNext7DaysCount: 0,
      paymentConfirmedCount: 0,
      incompleteAmountCount: 0,
      incompleteDueDateCount: 0,
    }),
  };
  const useCase = new GetPlatformOverviewUseCase(repository, health as never, receivables);

  const result = await useCase.execute({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.equal(result.receivables.financial_metrics_available, false);
  assert.equal(result.receivables.open_count, null);
  assert.equal(result.receivables.overdue_known_balance_cents, null);
  assert.equal(result.receivables.confirmed_payment_count_since_capture, null);
});
