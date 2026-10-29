import assert from "node:assert/strict";
import test from "node:test";
import { PrismaPlatformBillingSubscriptionRepository } from "./prisma-platform-billing-subscription.repository.js";

test("persists a non-financial audit record for global subscription reads", async () => {
  const events: unknown[] = [];
  const repository = new PrismaPlatformBillingSubscriptionRepository({
    platformAuditEvent: {
      create: async (input: unknown) => { events.push(input); },
    },
  } as never);

  await repository.recordRead({
    actorOperatorId: "operator_1",
    correlationId: "corr_1",
    environment: "test",
    returnedItems: 3,
    totalRecords: 10,
    status: "past_due",
    provider: "asaas",
  });

  assert.deepEqual(events, [{
    data: {
      actorOperatorId: "operator_1",
      action: "platform.billing.subscriptions.read",
      permission: "platform:billing:read",
      environment: "test",
      targetType: "platform_billing_subscriptions",
      correlationId: "corr_1",
      outcome: "succeeded",
      details: {
        source: "local_subscription_snapshots",
        returnedItems: 3,
        totalRecords: 10,
        status: "past_due",
        provider: "asaas",
      },
    },
  }]);
});
