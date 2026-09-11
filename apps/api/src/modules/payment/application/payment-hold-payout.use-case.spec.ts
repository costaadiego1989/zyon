import test from "node:test";
import assert from "node:assert/strict";
import { PayoutSubmissionError } from "../domain/ports/payment-payout-provider.port.js";
import { SubmitReadyPaymentHoldsUseCase } from "./payment-hold-payout.use-case.js";

type Hold = Record<string, any> & { id: string; status: string; holdUntil: Date };

class HoldStore {
  readonly holds: Hold[];
  readonly paymentHold: any;

  constructor(holds: Hold[]) {
    this.holds = holds;
    this.paymentHold = {
      findMany: async ({ where, take }: any) => this.holds
        .filter(hold => hold.status === where.status && hold.holdUntil <= where.holdUntil.lte)
        .slice(0, take),
      updateMany: async ({ where, data }: any) => {
        const matching = this.holds.filter(hold =>
          (!where.id || hold.id === where.id) &&
          (!where.status || hold.status === where.status) &&
          (!where.payoutReference || hold.payoutReference === where.payoutReference),
        );
        matching.forEach(hold => Object.assign(hold, data));
        return { count: matching.length };
      },
    };
  }
}

function readyHold(overrides: Record<string, unknown> = {}): Hold {
  return {
    id: "hold_1",
    provider: "asaas",
    payoutDestination: "wallet_merchant_1",
    merchantNetCents: 9_850,
    status: "payout_ready",
    holdUntil: new Date("2026-09-01T00:00:00.000Z"),
    ...overrides,
  };
}

test("claims a ready Asaas hold once and waits for TRANSFER_DONE", async () => {
  const store = new HoldStore([readyHold()]);
  const calls: any[] = [];
  const useCase = new SubmitReadyPaymentHoldsUseCase(store as any, {
    submitAsaasInternalPayout: async (input: unknown) => {
      calls.push(input);
      return { providerTransferId: "tr_asaas_1", state: "submitted" as const };
    },
  });

  const first = await useCase.execute(new Date("2026-09-02T00:00:00.000Z"));
  const second = await useCase.execute(new Date("2026-09-02T00:01:00.000Z"));

  assert.deepEqual(first, { claimed: 1, submitted: 1, failed: 0, unresolved: 0 });
  assert.deepEqual(second, { claimed: 0, submitted: 0, failed: 0, unresolved: 0 });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    payoutDestination: "wallet_merchant_1",
    amountCents: 9_850,
    payoutReference: "zyon:payment-hold:hold_1",
  });
  assert.equal(store.holds[0].status, "payout_submitted");
  assert.equal(store.holds[0].payoutProviderTransferId, "tr_asaas_1");
  assert.equal(store.holds[0].releasedAt, undefined);
});

test("does not retry an ambiguous provider submission", async () => {
  const store = new HoldStore([readyHold()]);
  const useCase = new SubmitReadyPaymentHoldsUseCase(store as any, {
    submitAsaasInternalPayout: async () => {
      throw new PayoutSubmissionError("asaas_transfer_submission_unknown", false);
    },
  });

  const result = await useCase.execute(new Date("2026-09-02T00:00:00.000Z"));

  assert.deepEqual(result, { claimed: 1, submitted: 0, failed: 0, unresolved: 1 });
  assert.equal(store.holds[0].status, "payout_submitted");
  assert.equal(store.holds[0].failureCode, "asaas_transfer_submission_unknown");
});
