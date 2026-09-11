import test from "node:test";
import assert from "node:assert/strict";
import { HandleAsaasTransferWebhookUseCase } from "./handle-asaas-transfer-webhook.use-case.js";

type Hold = Record<string, any>;

class TransferHoldStore {
  constructor(readonly hold: Hold) {}

  readonly paymentHold = {
    findFirst: async ({ where }: any) => this.hold.payoutReference === where.payoutReference ? this.hold : null,
    updateMany: async ({ where, data }: any) => {
      if (where.id !== this.hold.id || where.provider !== this.hold.provider || where.payoutReference !== this.hold.payoutReference) return { count: 0 };
      const statuses = where.status?.in ?? (where.status ? [where.status] : []);
      if (statuses.length && !statuses.includes(this.hold.status)) return { count: 0 };
      const allowedTransferIds = where.OR?.map((item: any) => item.payoutProviderTransferId) ?? [];
      if (allowedTransferIds.length && !allowedTransferIds.includes(this.hold.payoutProviderTransferId)) return { count: 0 };
      Object.assign(this.hold, data);
      return { count: 1 };
    },
  };
}

function makeHold(overrides: Record<string, unknown> = {}): Hold {
  return {
    id: "hold_1",
    merchantId: "merchant_1",
    paymentIntentId: "pay_1",
    provider: "asaas",
    providerPaymentId: "payment_1",
    merchantNetCents: 9_850,
    payoutReference: "zyon:payment-hold:hold_1",
    payoutProviderTransferId: "transfer_1",
    status: "payout_submitted",
    ...overrides,
  };
}

function doneEvent(id = "evt_transfer_done") {
  return {
    id,
    event: "TRANSFER_DONE",
    transfer: {
      id: "transfer_1",
      value: 98.5,
      externalReference: "zyon:payment-hold:hold_1",
      status: "DONE",
    },
  };
}

test("TRANSFER_DONE releases only the matched hold and appends the merchant payout receipt", async () => {
  const store = new TransferHoldStore(makeHold());
  const processed = new Set<string>();
  const observations: any[] = [];
  const useCase = new HandleAsaasTransferWebhookUseCase(store as any, {
    recordProcessedProviderEvent: async (key: any) => {
      if (processed.has(key.eventId)) return false;
      processed.add(key.eventId);
      return true;
    },
    deleteProcessedProviderEvent: async (key: any) => void processed.delete(key.eventId),
  } as any, {
    appendObservation: async (observation: any) => void observations.push(observation),
  } as any);

  const first = await useCase.execute("test-token", doneEvent(), "test-token");
  const duplicate = await useCase.execute("test-token", doneEvent(), "test-token");

  assert.deepEqual(first, { outcome: "processed", effect: "payout_transfer_released" });
  assert.deepEqual(duplicate, { outcome: "duplicate" });
  assert.equal(store.hold.status, "released");
  assert.equal(store.hold.payoutProviderTransferId, "transfer_1");
  assert.ok(store.hold.payoutConfirmedAt instanceof Date);
  assert.ok(store.hold.releasedAt instanceof Date);
  assert.equal(observations.length, 1);
  assert.equal(observations[0].providerSettlementId, "asaas:transfer:transfer_1");
  assert.deepEqual(observations[0].entries, [{
    entryKey: "merchant_payout",
    confirmedAmountCents: 9_850,
    providerTransferId: "transfer_1",
    providerReference: "zyon:payment-hold:hold_1",
  }]);
});

test("TRANSFER_DONE records proof but preserves recovery work after a refund", async () => {
  const store = new TransferHoldStore(makeHold({ status: "refund_reversal_required" }));
  const observations: any[] = [];
  const useCase = new HandleAsaasTransferWebhookUseCase(store as any, {
    recordProcessedProviderEvent: async () => true,
    deleteProcessedProviderEvent: async () => undefined,
  } as any, {
    appendObservation: async (observation: any) => void observations.push(observation),
  } as any);

  const result = await useCase.execute("test-token", doneEvent("evt_recovery"), "test-token");

  assert.deepEqual(result, { outcome: "processed", effect: "payout_transfer_done_reversal_required" });
  assert.equal(store.hold.status, "refund_reversal_required");
  assert.ok(store.hold.payoutConfirmedAt instanceof Date);
  assert.equal(store.hold.releasedAt, undefined);
  assert.equal(observations.length, 1);
});

test("TRANSFER_FAILED marks the claimed transfer as failed", async () => {
  const store = new TransferHoldStore(makeHold());
  const useCase = new HandleAsaasTransferWebhookUseCase(store as any, {
    recordProcessedProviderEvent: async () => true,
    deleteProcessedProviderEvent: async () => undefined,
  } as any);

  const result = await useCase.execute("test-token", {
    ...doneEvent("evt_transfer_failed"),
    event: "TRANSFER_FAILED",
    transfer: { ...doneEvent().transfer, failReason: "INSUFFICIENT_BALANCE" },
  }, "test-token");

  assert.deepEqual(result, { outcome: "processed", effect: "payout_transfer_failed" });
  assert.equal(store.hold.status, "payout_failed");
  assert.equal(store.hold.failureCode, "INSUFFICIENT_BALANCE");
});
