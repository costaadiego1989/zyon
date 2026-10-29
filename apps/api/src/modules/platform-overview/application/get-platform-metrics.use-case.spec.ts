import assert from "node:assert/strict";
import test from "node:test";
import { GetPlatformMetricsUseCase, parsePlatformMetricsPeriod } from "./get-platform-metrics.use-case.js";

test("metrics present confirmed movement separately from the current receivable position", async () => {
  const reads: unknown[] = [];
  const metrics = {
    snapshot: async () => ({
      financial: {
        observedReceivableCount: 4,
        observedSince: new Date("2026-09-01T12:00:00.000Z"),
        confirmedPaymentCount: 2n,
        confirmedKnownAmountCents: 39800n,
        incompleteAmountCount: 1n,
        series: [{ bucket: "2026-09-12", confirmedPaymentCount: 2n, confirmedKnownAmountCents: 39800n, incompleteAmountCount: 1n }],
      },
      subscriptions: {
        activeContractCount: 3,
        activeContractWithKnownAmountCount: 2,
        activeContractMissingAmountCount: 1,
        contractedMrrKnownCents: 29800n,
      },
      ai: {
        chat: { eventCount: 3n, totalTokens: 900n, unpricedEventCount: 1n, costs: [{ status: "estimated" as const, currency: "USD", costMicros: 220000n, eventCount: 2n }] },
        voice: { eventCount: 2n, totalTokens: 400n, unpricedEventCount: 0n, costs: [] },
        series: [{ bucket: "2026-09-12", chatEventCount: 3n, voiceEventCount: 2n, chatTotalTokens: 900n, voiceTotalTokens: 400n, costs: [] }],
      },
    }),
    recordRead: async (input: unknown) => { reads.push(input); },
  };
  const receivables = {
    summary: async () => ({
      observedReceivableCount: 4,
      openCount: 1,
      openBalanceCents: "19900",
      overdueCount: 1,
      overdueMerchantCount: 1,
      overdueBalanceCents: "9900",
      dueTodayCount: 0,
      dueNext7DaysCount: 1,
      nextDueAt: new Date("2026-09-17T12:00:00.000Z"),
    }),
  };
  const useCase = new GetPlatformMetricsUseCase(metrics, receivables);

  const result = await useCase.execute({
    from: "2026-09-01T03:00:00.000Z",
    to: "2026-10-01T03:00:00.000Z",
    granularity: "day",
  }, {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.equal(result.period.timezone, "America/Sao_Paulo");
  assert.equal(result.period.end_exclusive, true);
  assert.equal(result.financial.received?.confirmed_known_amount_cents, "39800");
  assert.equal(result.financial.current_position?.overdue_known_balance_cents, "9900");
  assert.equal(result.financial.contracted_mrr.known_amount_cents, "29800");
  assert.equal(result.financial.contracted_mrr.active_contract_missing_amount_count, 1);
  assert.equal(result.ai.chat.total_tokens, "900");
  assert.equal(result.ai.voice.event_count, "2");
  assert.equal(result.coverage.platform_fees.status, "unavailable");
  assert.equal(reads.length, 1);
});

test("metrics keep financial movement unavailable until a billing event is captured", async () => {
  const metrics = {
    snapshot: async () => ({
      financial: {
        observedReceivableCount: 0,
        confirmedPaymentCount: 0n,
        confirmedKnownAmountCents: 0n,
        incompleteAmountCount: 0n,
        series: [],
      },
      subscriptions: { activeContractCount: 0, activeContractWithKnownAmountCount: 0, activeContractMissingAmountCount: 0, contractedMrrKnownCents: 0n },
      ai: {
        chat: { eventCount: 0n, totalTokens: 0n, unpricedEventCount: 0n, costs: [] },
        voice: { eventCount: 0n, totalTokens: 0n, unpricedEventCount: 0n, costs: [] },
        series: [],
      },
    }),
    recordRead: async () => undefined,
  };
  const receivables = {
    summary: async () => ({
      observedReceivableCount: 0,
      openCount: 0,
      overdueCount: 0,
      overdueMerchantCount: 0,
      dueTodayCount: 0,
      dueNext7DaysCount: 0,
    }),
  };
  const useCase = new GetPlatformMetricsUseCase(metrics, receivables);

  const result = await useCase.execute({}, { actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" });

  assert.equal(result.coverage.financial.status, "unavailable");
  assert.equal(result.financial.received, null);
  assert.equal(result.financial.current_position, null);
});

test("metrics reject non-UTC, inverted and oversized periods", () => {
  assert.throws(() => parsePlatformMetricsPeriod({ from: "2026-09-01", to: "2026-09-02T00:00:00.000Z" }), /platform_metrics_invalid_from/);
  assert.throws(() => parsePlatformMetricsPeriod({ from: "2026-09-02T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }), /platform_metrics_invalid_period/);
  assert.throws(() => parsePlatformMetricsPeriod({ from: "2025-01-01T00:00:00.000Z", to: "2026-09-01T00:00:00.000Z" }), /platform_metrics_invalid_period/);
  assert.throws(() => parsePlatformMetricsPeriod({ granularity: "week" }), /platform_metrics_invalid_granularity/);
});
