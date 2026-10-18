import assert from "node:assert/strict";
import test from "node:test";
import { ListPlatformBillingReceivablesUseCase } from "./list-platform-billing-receivables.use-case.js";
import type { PlatformBillingReceivableRepository } from "../domain/ports/platform-billing-receivable-repository.port.js";

test("presents a due open charge as delinquency without relying on subscription past_due", async () => {
  const reads: unknown[] = [];
  const repository: PlatformBillingReceivableRepository = {
    async list() {
      return {
        items: [{
          id: "rec_1", merchantId: "merchant_1", merchantName: "Casa Zyon", provider: "asaas",
          providerPaymentId: "pay_1", providerSubscriptionId: "sub_1", status: "open", currency: "BRL",
          amountCents: 34900, dueAt: new Date("2020-09-14T12:00:00.000Z"),
          firstObservedAt: new Date("2026-09-10T10:00:00.000Z"),
          lastProviderEventAt: new Date("2020-09-14T12:00:00.000Z"),
        }],
        summary: {
          observedReceivableCount: 1, observedSince: new Date("2026-09-10T10:00:00.000Z"),
          openCount: 1, openBalanceCents: "34900", overdueCount: 1, overdueMerchantCount: 1,
          overdueBalanceCents: "34900", dueTodayCount: 0, dueTodayBalanceCents: "0",
          dueNext7DaysCount: 0, dueNext7DaysBalanceCents: "0", paymentConfirmedCount: 0,
          paymentConfirmedAmountCents: "0", incompleteAmountCount: 0, incompleteDueDateCount: 0,
        },
      };
    },
    async summary() { throw new Error("unexpected"); },
    async recordRead(input) { reads.push(input); },
  };
  const useCase = new ListPlatformBillingReceivablesUseCase(repository);
  const result = await useCase.execute({}, {
    actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test",
  });
  assert.equal(result.coverage.financial_metrics_available, true);
  assert.equal(result.summary.overdue_balance_cents, "34900");
  assert.equal(result.items[0]?.is_overdue_as_of, true);
  assert.deepEqual(reads, [{
    actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test",
    returnedItems: 1, totalObservedReceivables: 1,
  }]);
});

test("rejects an unknown receivable status", async () => {
  const repository = {
    list: async () => { throw new Error("unexpected"); },
    summary: async () => { throw new Error("unexpected"); },
    recordRead: async () => undefined,
  } as PlatformBillingReceivableRepository;
  const useCase = new ListPlatformBillingReceivablesUseCase(repository);
  await assert.rejects(
    () => useCase.execute({ status: "past_due" }, { actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test" }),
    /platform_billing_receivables_invalid_status/,
  );
});

test("presents observed Stripe invoices as a partial journal source", async () => {
  const repository: PlatformBillingReceivableRepository = {
    async list() {
      return {
        items: [{
          id: "rec_stripe", merchantId: "merchant_stripe", merchantName: "Stripe Store", provider: "stripe",
          providerPaymentId: "in_1", providerSubscriptionId: "sub_1", status: "paid", currency: "BRL",
          amountCents: 34900, paidAt: new Date("2026-10-02T10:00:00.000Z"),
          firstObservedAt: new Date("2026-10-02T10:00:00.000Z"),
          lastProviderEventAt: new Date("2026-10-02T10:00:00.000Z"),
        }],
        summary: {
          observedReceivableCount: 1, observedSince: new Date("2026-10-02T10:00:00.000Z"),
          openCount: 0, openBalanceCents: "0", overdueCount: 0, overdueMerchantCount: 0,
          overdueBalanceCents: "0", dueTodayCount: 0, dueTodayBalanceCents: "0",
          dueNext7DaysCount: 0, dueNext7DaysBalanceCents: "0", paymentConfirmedCount: 1,
          paymentConfirmedAmountCents: "34900", incompleteAmountCount: 0, incompleteDueDateCount: 0,
        },
      };
    },
    async summary() { throw new Error("unexpected"); },
    async recordRead() {},
  };
  const result = await new ListPlatformBillingReceivablesUseCase(repository).execute({}, {
    actorOperatorId: "operator_1", correlationId: "corr_1", environment: "test",
  });

  assert.equal(result.sources.stripe_subscription_charges.status, "partial");
  assert.equal(result.sources.mercadopago_subscription_charges.status, "partial");
  assert.equal(result.items[0]?.provider, "stripe");
  assert.equal(result.summary.confirmed_payment_amount_cents_since_capture, "34900");
});
