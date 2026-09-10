import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GetPaymentAllocationHistoryUseCase } from "./get-payment-allocation-history.use-case.js";
import { InMemoryPaymentSettlementLedgerRepository } from "../../payment/infrastructure/in-memory-payment-settlement-ledger.repository.js";

describe("GetPaymentAllocationHistoryUseCase", () => {
  it("returns only the authenticated merchant's immutable plan and provider observations", async () => {
    const ledger = new InMemoryPaymentSettlementLedgerRepository();
    await appendPlan(ledger, "merchant_a", "intent_shared");
    await ledger.appendObservation({
      merchantId: "merchant_a",
      paymentIntentId: "intent_shared",
      provider: "asaas",
      status: "confirmed",
      currency: "BRL",
      providerSettlementId: "asaas:split:platform-a",
      providerPaymentId: "payment_a",
      confirmedGrossCents: 1_000,
      confirmedPlatformFeeCents: 99,
      confirmedProviderFeeCents: 0,
      occurredAt: new Date("2026-09-10T10:01:00.000Z"),
      confirmedAt: new Date("2026-09-10T10:01:00.000Z"),
      entries: [{
        entryKey: "platform_fee",
        confirmedAmountCents: 99,
        providerTransferId: "platform-a",
      }],
    });
    await ledger.appendObservation({
      merchantId: "merchant_a",
      paymentIntentId: "intent_shared",
      provider: "asaas",
      status: "blocked",
      currency: "BRL",
      providerSettlementId: "asaas:block:platform-a",
      occurredAt: new Date("2026-09-10T10:02:00.000Z"),
      entries: [],
    });
    await appendPlan(ledger, "merchant_b", "intent_shared", 2_000);

    const history = await new GetPaymentAllocationHistoryUseCase(ledger).execute({
      merchantId: "merchant_a",
      paymentIntentId: "intent_shared",
    });

    assert.equal(history.payment_intent_id, "intent_shared");
    assert.match(history.scope_note, /n.o representa saldo dispon.vel, valor liquidado, repasse conclu.do ou concilia..o completa/i);
    assert.deepEqual(history.snapshots.map(snapshot => [snapshot.kind, snapshot.observation_status]), [
      ["planned_allocation", undefined],
      ["provider_observation", "confirmed"],
      ["provider_observation", "blocked"],
    ]);
    assert.deepEqual(history.snapshots[1]?.provider_observed, {
      gross_cents: 1_000,
      platform_fee_cents: 99,
      merchant_net_cents: undefined,
      provider_fee_cents: 0,
    });
    assert.equal(history.snapshots[1]?.allocations[0]?.provider_observed_amount_cents, 99);
    assert.equal("recipient_reference" in (history.snapshots[0]?.allocations[0] ?? {}), false);

    const foreign = await new GetPaymentAllocationHistoryUseCase(ledger).execute({
      merchantId: "merchant_b",
      paymentIntentId: "intent_shared",
    });
    assert.equal(foreign.snapshots.length, 1);
    assert.equal(foreign.snapshots[0]?.planned.gross_cents, 2_000);

    const notOwned = await new GetPaymentAllocationHistoryUseCase(ledger).execute({
      merchantId: "merchant_c",
      paymentIntentId: "intent_shared",
    });
    assert.deepEqual(notOwned.snapshots, []);
  });

  it("rejects a missing tenant or payment intent before querying the ledger", async () => {
    const useCase = new GetPaymentAllocationHistoryUseCase(new InMemoryPaymentSettlementLedgerRepository());
    await assert.rejects(
      useCase.execute({ merchantId: "merchant_a", paymentIntentId: "  " }),
      /payment_allocation_history_fields_required/,
    );
  });
});

async function appendPlan(
  ledger: InMemoryPaymentSettlementLedgerRepository,
  merchantId: string,
  paymentIntentId: string,
  grossCents = 1_000,
): Promise<void> {
  await ledger.appendPlanned({
    merchantId,
    paymentIntentId,
    provider: "asaas",
    currency: "BRL",
    plannedGrossCents: grossCents,
    plannedPlatformFeeCents: 99,
    plannedMerchantNetCents: grossCents - 99,
    plannedProviderFeeCents: 0,
    occurredAt: new Date("2026-09-10T10:00:00.000Z"),
    entries: [
      {
        entryKey: "platform_fee",
        entryType: "platform_fee",
        direction: "credit",
        recipientType: "platform",
        recipientReference: "platform-wallet-not-exposed",
        plannedAmountCents: 99,
      },
      {
        entryKey: "merchant_payout",
        entryType: "merchant_payout",
        direction: "credit",
        recipientType: "merchant",
        recipientReference: "merchant-wallet-not-exposed",
        plannedAmountCents: grossCents - 99,
      },
    ],
  });
}
