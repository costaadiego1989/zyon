import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformBillingSubscriptionsUseCase } from "./list-platform-billing-subscriptions.use-case.js";
import type {
  PlatformBillingSubscriptionPage,
  PlatformBillingSubscriptionQuery,
  PlatformBillingSubscriptionRepository,
  PlatformBillingSubscriptionsReadAudit,
} from "../domain/ports/platform-billing-subscription-repository.port.js";

test("lists local subscription snapshots and audits the normalized global read", async () => {
  const repository = new InMemoryPlatformBillingSubscriptionRepository();
  const useCase = new ListPlatformBillingSubscriptionsUseCase(repository);

  const result = await useCase.execute(
    { limit: "25", status: "past_due", provider: "asaas" },
    auditContext(),
  );

  assert.equal(result.summary.past_due_local_state_records, 1);
  assert.equal(result.items[0]?.term_end_kind, "billing_period");
  assert.equal(result.sources.delinquency.status, "partial");
  assert.equal(result.sources.next_due_date.status, "partial");
  assert.deepEqual(repository.query && {
    cursor: repository.query.cursor,
    limit: repository.query.limit,
    status: repository.query.status,
    provider: repository.query.provider,
  }, {
    cursor: undefined,
    limit: 25,
    status: "past_due",
    provider: "asaas",
  });
  assert.deepEqual(repository.audit, {
    ...auditContext(),
    returnedItems: 1,
    totalRecords: 1,
    status: "past_due",
    provider: "asaas",
  });
});

test("rejects malformed global billing filters before reading any data", async () => {
  const repository = new InMemoryPlatformBillingSubscriptionRepository();
  const useCase = new ListPlatformBillingSubscriptionsUseCase(repository);

  await assert.rejects(
    () => useCase.execute({ status: "paid" }, auditContext()),
    /platform_billing_invalid_status/,
  );
  await assert.rejects(
    () => useCase.execute({ cursor: "../../merchant" }, auditContext()),
    /platform_billing_invalid_cursor/,
  );
  assert.equal(repository.query, undefined);
});

test("does not return global billing data if the read audit cannot be persisted", async () => {
  const repository = new InMemoryPlatformBillingSubscriptionRepository();
  repository.auditFailure = new Error("platform_audit_unavailable");
  const useCase = new ListPlatformBillingSubscriptionsUseCase(repository);

  await assert.rejects(
    () => useCase.execute({}, auditContext()),
    /platform_audit_unavailable/,
  );
});

class InMemoryPlatformBillingSubscriptionRepository implements PlatformBillingSubscriptionRepository {
  query?: PlatformBillingSubscriptionQuery;
  audit?: PlatformBillingSubscriptionsReadAudit;
  auditFailure?: Error;

  async list(input: PlatformBillingSubscriptionQuery): Promise<PlatformBillingSubscriptionPage> {
    this.query = input;
    return {
      items: [{
        merchantId: "merchant_1",
        merchantName: "Loja 1",
        provider: "asaas",
        status: "past_due",
        planKey: "growth",
        billingCycle: "monthly",
        billingAmountCents: 34900,
        termEndsAt: new Date("2026-09-20T00:00:00.000Z"),
        termEndKind: "billing_period",
        cancelAtPeriodEnd: false,
        createdAt: new Date("2026-09-01T00:00:00.000Z"),
        updatedAt: new Date("2026-09-15T00:00:00.000Z"),
      }],
      summary: {
        totalRecords: 1,
        recordsByStatus: { past_due: 1 },
        activeLocalRecords: 0,
        activeTrials: 0,
        pastDueLocalStateRecords: 1,
        cancellationAtPeriodEndRecords: 0,
        missingTermEndRecords: 0,
      },
    };
  }

  async recordRead(input: PlatformBillingSubscriptionsReadAudit): Promise<void> {
    if (this.auditFailure) throw this.auditFailure;
    this.audit = input;
  }
}

function auditContext() {
  return {
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
  };
}
