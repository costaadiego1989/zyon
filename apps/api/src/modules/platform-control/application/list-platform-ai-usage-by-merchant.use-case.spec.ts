import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformAiUsageByMerchantUseCase } from "./list-platform-ai-usage-by-merchant.use-case.js";
import type {
  PlatformAiUsageMerchantQuery,
  PlatformAiUsageReadAudit,
  PlatformAiUsageRepository,
} from "../domain/ports/platform-ai-usage-repository.port.js";
import type { PlatformAiUsageMerchant } from "../domain/platform-ai-usage.js";

test("lists server chat and client-forwarded provider voice usage by merchant and audits the global read", async () => {
  const repository = new InMemoryPlatformAiUsageRepository();
  const useCase = new ListPlatformAiUsageByMerchantUseCase(repository);

  const result = await useCase.execute({
    from: "2026-09-01T00:00:00.000Z",
    to: "2026-09-02T00:00:00.000Z",
    limit: "25",
  }, {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  });

  assert.deepEqual(repository.query, {
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-02T00:00:00.000Z"),
    limit: 25,
  });
  assert.deepEqual(repository.audit, {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
    from: new Date("2026-09-01T00:00:00.000Z"),
    to: new Date("2026-09-02T00:00:00.000Z"),
    limit: 25,
    itemCount: 1,
  });
  assert.equal(result.period.timezone, "UTC");
  assert.equal(result.period.end_exclusive, true);
  assert.deepEqual(result.coverage.voice, {
    status: "partial",
    attribution: "client_forwarded_provider_event",
    source: "openai_realtime_client_forwarded",
    provider: "openai",
    channel: "voice",
    caveat: "browser_forwarded_usage_requires_provider_invoice_reconciliation",
  });
  assert.deepEqual(result.items[0], {
    merchant_id: "merchant_1",
    merchant_name: "Store One",
    chat: {
      event_count: "4",
      prompt_tokens: "120",
      completion_tokens: "80",
      total_tokens: "200",
    },
    voice: {
      component_event_count: "3",
      response_count: "1",
      session_count: "1",
      failed_response_count: "0",
      prompt_tokens: "130",
      completion_tokens: "60",
      total_tokens: "190",
    },
    costs: {
      estimated: {
        event_count: "3",
        by_currency: [{ currency: "USD", cost_micros: "600", event_count: "3" }],
        caveat: "estimated_price_version_not_provider_invoice",
      },
      provider_reported: {
        event_count: "1",
        by_currency: [{ currency: "USD", cost_micros: "700", event_count: "1" }],
        caveat: "provider_reported_event_cost_not_reconciled_invoice",
      },
      reconciled: {
        event_count: "2",
        by_currency: [{ currency: "USD", cost_micros: "650", event_count: "2" }],
        caveat: "provider_reconciliation_reference_recorded",
      },
      unpriced: {
        event_count: "4",
        total_tokens: "210",
        caveat: "no_effective_price_version",
      },
      other_cost_status_event_count: "0",
    },
  });
});

test("rejects a non-UTC timestamp before it can query or audit", async () => {
  const repository = new InMemoryPlatformAiUsageRepository();
  const useCase = new ListPlatformAiUsageByMerchantUseCase(repository);

  await assert.rejects(
    () => useCase.execute({
      from: "2026-09-01T00:00:00-03:00",
      to: "2026-09-02T00:00:00.000Z",
    }, {
      actorOperatorId: "operator_1",
      correlationId: "corr_1",
      environment: "test",
    }),
    /platform_ai_usage_invalid_from/,
  );
  assert.equal(repository.query, undefined);
  assert.equal(repository.audit, undefined);
});

test("rejects an impossible UTC calendar date before it can query or audit", async () => {
  const repository = new InMemoryPlatformAiUsageRepository();
  const useCase = new ListPlatformAiUsageByMerchantUseCase(repository);

  await assert.rejects(
    () => useCase.execute({
      from: "2026-02-30T00:00:00.000Z",
      to: "2026-03-02T00:00:00.000Z",
    }, {
      actorOperatorId: "operator_1",
      correlationId: "corr_1",
      environment: "test",
    }),
    /platform_ai_usage_invalid_from/,
  );
  assert.equal(repository.query, undefined);
  assert.equal(repository.audit, undefined);
});

class InMemoryPlatformAiUsageRepository implements PlatformAiUsageRepository {
  query?: PlatformAiUsageMerchantQuery;
  audit?: PlatformAiUsageReadAudit;

  async listByMerchant(input: PlatformAiUsageMerchantQuery): Promise<PlatformAiUsageMerchant[]> {
    this.query = input;
    return [{
      merchantId: "merchant_1",
      merchantName: "Store One",
      chat: { eventCount: 4n, promptTokens: 120n, completionTokens: 80n, totalTokens: 200n },
      voice: {
        eventCount: 3n,
        responseCount: 1n,
        sessionCount: 1n,
        failedResponseCount: 0n,
        promptTokens: 130n,
        completionTokens: 60n,
        totalTokens: 190n,
      },
      estimatedEventCount: 3n,
      providerReportedEventCount: 1n,
      reconciledEventCount: 2n,
      unpricedEventCount: 4n,
      unpricedTokens: 210n,
      otherCostStatusEventCount: 0n,
      estimatedCosts: [{ currency: "USD", costMicros: 600n, eventCount: 3n }],
      providerReportedCosts: [{ currency: "USD", costMicros: 700n, eventCount: 1n }],
      reconciledCosts: [{ currency: "USD", costMicros: 650n, eventCount: 2n }],
    }];
  }

  async recordRead(input: PlatformAiUsageReadAudit): Promise<void> {
    this.audit = input;
  }
}
