import assert from "node:assert/strict";
import test from "node:test";
import type {
  BillingCustomerInput,
  BillingProviderPort,
  CreateSubscriptionInput,
} from "../domain/ports/billing-provider.port.js";
import { InMemoryPaymentPlatformRepository } from "../infrastructure/in-memory-payment-platform.repository.js";
import { AsaasBillingProvider } from "../infrastructure/asaas-billing.provider.js";
import { CancelSubscriptionUseCase } from "./payment-platform/billing/cancel-subscription.use-case.js";
import { HandleAsaasBillingWebhookUseCase } from "./payment-platform/billing/handle-asaas-billing-webhook.use-case.js";
import { ReconcileScheduledSubscriptionCancellationsUseCase } from "./payment-platform/billing/reconcile-scheduled-subscription-cancellations.use-case.js";

test("scheduled cancellation stops recurrence now and deletes it only after the paid period", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const provider = new StubBillingProvider();
  const now = new Date("2026-09-11T12:00:00.000Z");
  const periodEnd = new Date("2026-09-18T12:00:00.000Z");
  await repository.saveBilling({
    merchantId: "merchant_scheduled",
    provider: "asaas",
    planKey: "growth",
    asaasSubscriptionId: "sub_scheduled",
    status: "active",
    currentPeriodEnd: periodEnd.toISOString(),
    pendingPlanKey: "starter",
    pendingPlanEffectiveAt: periodEnd.toISOString(),
  });

  const cancellation = new CancelSubscriptionUseCase(repository, provider);
  const scheduled = await cancellation.execute({ merchantId: "merchant_scheduled" });

  assert.equal(scheduled?.status, "active");
  assert.equal(scheduled?.cancelAtPeriodEnd, true);
  assert.ok(scheduled?.providerCancellationScheduledAt);
  assert.deepEqual(provider.inactivated, ["sub_scheduled"]);
  assert.deepEqual(provider.cancelled, []);

  const reconcile = new ReconcileScheduledSubscriptionCancellationsUseCase(repository, provider);
  assert.deepEqual(await reconcile.execute({ now }), { suspended: 0, finalized: 0, failed: 0 });

  assert.deepEqual(
    await reconcile.execute({ now: new Date(periodEnd.getTime() + 1) }),
    { suspended: 0, finalized: 1, failed: 0 },
  );
  const finalized = await repository.getBilling("merchant_scheduled");
  assert.equal(finalized?.status, "cancelled");
  assert.equal(finalized?.cancelAtPeriodEnd, false);
  assert.equal(finalized?.providerCancellationScheduledAt, undefined);
  assert.equal(finalized?.pendingPlanKey, undefined);
  assert.deepEqual(provider.cancelled, ["sub_scheduled"]);

  // A second worker run sees the finalized local state and makes no duplicate
  // provider request.
  assert.deepEqual(
    await reconcile.execute({ now: new Date(periodEnd.getTime() + 60_000) }),
    { suspended: 0, finalized: 0, failed: 0 },
  );
  assert.deepEqual(provider.cancelled, ["sub_scheduled"]);
});

test("reconciliation resumes a cancellation recorded before provider suspension", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const provider = new StubBillingProvider();
  const now = new Date("2026-09-11T12:00:00.000Z");
  await repository.saveBilling({
    merchantId: "merchant_restart",
    provider: "asaas",
    planKey: "scale",
    asaasSubscriptionId: "sub_restart",
    status: "active",
    currentPeriodEnd: new Date(now.getTime() + 86_400_000).toISOString(),
    cancelAtPeriodEnd: true,
  });

  const result = await new ReconcileScheduledSubscriptionCancellationsUseCase(
    repository,
    provider,
  ).execute({ now });

  assert.deepEqual(result, { suspended: 1, finalized: 0, failed: 0 });
  assert.deepEqual(provider.inactivated, ["sub_restart"]);
  assert.ok((await repository.getBilling("merchant_restart"))?.providerCancellationScheduledAt);
});

test("scheduled cancellation finalizes locally when the provider already removed the subscription", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  const provider = new StubBillingProvider();
  provider.inactivateResult = false;
  await repository.saveBilling({
    merchantId: "merchant_remote_missing",
    provider: "asaas",
    planKey: "growth",
    asaasSubscriptionId: "sub_missing",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
  });

  await new CancelSubscriptionUseCase(repository, provider).execute({
    merchantId: "merchant_remote_missing",
  });
  const billing = await repository.getBilling("merchant_remote_missing");
  assert.equal(billing?.status, "cancelled");
  assert.equal(billing?.cancelAtPeriodEnd, false);
});

test("Asaas inactivation event preserves access until deletion and late payment cannot revive it", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({
    merchantId: "merchant_webhook",
    provider: "asaas",
    planKey: "growth",
    asaasSubscriptionId: "sub_webhook",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
    cancelAtPeriodEnd: true,
    providerCancellationScheduledAt: new Date().toISOString(),
  });
  const handler = new HandleAsaasBillingWebhookUseCase(repository);

  await handler.execute({ event: "SUBSCRIPTION_INACTIVATED", subscriptionId: "sub_webhook" });
  assert.equal((await repository.getBilling("merchant_webhook"))?.status, "active");

  await handler.execute({ event: "SUBSCRIPTION_DELETED", subscriptionId: "sub_webhook" });
  assert.equal((await repository.getBilling("merchant_webhook"))?.status, "cancelled");

  await handler.execute({ event: "PAYMENT_CONFIRMED", subscriptionId: "sub_webhook" });
  assert.equal((await repository.getBilling("merchant_webhook"))?.status, "cancelled");
});

test("unsolicited Asaas inactivation still revokes the local paid plan", async () => {
  const repository = new InMemoryPaymentPlatformRepository();
  await repository.saveBilling({
    merchantId: "merchant_external_inactivation",
    provider: "asaas",
    planKey: "growth",
    asaasSubscriptionId: "sub_external_inactivation",
    status: "active",
    currentPeriodEnd: new Date(Date.now() + 86_400_000).toISOString(),
  });

  await new HandleAsaasBillingWebhookUseCase(repository).execute({
    event: "SUBSCRIPTION_INACTIVATED",
    subscriptionId: "sub_external_inactivation",
  });

  const billing = await repository.getBilling("merchant_external_inactivation");
  assert.equal(billing?.status, "cancelled");
  assert.equal(billing?.cancelAtPeriodEnd, false);
});

test("Asaas provider uses INACTIVE for scheduled cancellation and accepts a repeated delete", async () => {
  const requests: Array<{ method?: string; body?: unknown }> = [];
  const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
    requests.push({
      method: init?.method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    return new Response(null, { status: requests.length === 1 ? 200 : 404 });
  }) as typeof fetch;
  const provider = new AsaasBillingProvider(
    "https://api-sandbox.asaas.com",
    "sandbox-key",
    fetchImpl,
  );

  assert.equal(await provider.ensureSubscriptionInactive("sub_1"), true);
  await provider.cancelSubscription("sub_1");
  assert.deepEqual(requests, [
    { method: "PUT", body: { status: "INACTIVE" } },
    { method: "DELETE", body: undefined },
  ]);
});

class StubBillingProvider implements BillingProviderPort {
  inactivated: string[] = [];
  cancelled: string[] = [];
  inactivateResult = true;

  async createCustomer(_input: BillingCustomerInput) {
    return { customerId: "cus_stub" };
  }

  async createSubscription(_input: CreateSubscriptionInput) {
    return { subscriptionId: "sub_stub", status: "ACTIVE" };
  }

  async updateSubscription() {
    return { status: "ACTIVE" };
  }

  async ensureSubscriptionInactive(subscriptionId: string) {
    this.inactivated.push(subscriptionId);
    return this.inactivateResult;
  }

  async cancelSubscription(subscriptionId: string) {
    this.cancelled.push(subscriptionId);
  }

  async getSubscription() {
    return { status: "ACTIVE", nextDueDate: "2026-10-01" };
  }
}
