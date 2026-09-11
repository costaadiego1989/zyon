import test from "node:test";
import assert from "node:assert/strict";
import {
  ChargebackPaymentHoldUseCase,
  CreatePaymentHoldUseCase,
  MakePaymentHoldsPayoutReadyUseCase,
  RefundPaymentHoldUseCase,
} from "../application/payment-hold.use-cases.js";
import { PaymentHoldLifecycleService } from "../application/payment-hold-lifecycle.service.js";

type Hold = Record<string, any> & { id: string; paymentIntentId: string; status: string; holdUntil: Date };

class InMemoryPaymentHoldStore {
  private readonly holds: Hold[] = [];
  private sequence = 0;
  readonly paymentHold: any;

  constructor() {
    this.paymentHold = {
      findUnique: async ({ where }: any) =>
        this.holds.find(hold => hold.paymentIntentId === where.paymentIntentId || hold.id === where.id) ?? null,
      create: async ({ data }: any) => {
      if (this.holds.some(hold => hold.paymentIntentId === data.paymentIntentId)) {
        const error = new Error("unique_payment_intent");
        (error as any).code = "P2002";
        throw error;
      }
      const hold: Hold = { id: `hold_${++this.sequence}`, ...data, createdAt: new Date(), updatedAt: new Date() };
      this.holds.push(hold);
      return hold;
      },
      updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const hold of this.holds) {
        if (where.status && hold.status !== where.status) continue;
        if (where.holdUntil?.lte && hold.holdUntil > where.holdUntil.lte) continue;
        Object.assign(hold, data, { updatedAt: new Date() });
        count += 1;
      }
      return { count };
      },
      update: async ({ where, data }: any) => {
      const hold = this.holds.find(candidate => candidate.id === where.id);
      if (!hold) throw new Error("hold_not_found");
      Object.assign(hold, data, { updatedAt: new Date() });
      return hold;
      },
    };
  }

  async seed(data: Record<string, any>): Promise<Hold> {
    const { id: _ignored, ...createData } = data;
    return this.paymentHold.create({ data: createData });
  }

  all(): Hold[] {
    return this.holds;
  }
}

function createHoldInput(overrides: Record<string, unknown> = {}) {
  return {
    merchantId: "mrc_1",
    paymentIntentId: "pay_int_1",
    provider: "stripe" as const,
    providerPaymentId: "pi_1",
    payoutDestination: "acct_merchant_1",
    totalAmountCents: 10_099,
    platformFeeCents: 249,
    holdDays: 14,
    ...overrides,
  };
}

test("creates one immutable hold and accepts an exact webhook retry", async () => {
  const store = new InMemoryPaymentHoldStore();
  const create = new CreatePaymentHoldUseCase(store as any);

  const first = await create.execute(createHoldInput());
  const retry = await create.execute(createHoldInput());

  assert.equal(first.holdId, retry.holdId);
  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].merchantNetCents, 9_850);
  assert.equal(store.all()[0].status, "held");
});

test("refuses a retry whose immutable money or destination differs", async () => {
  const store = new InMemoryPaymentHoldStore();
  const create = new CreatePaymentHoldUseCase(store as any);
  await create.execute(createHoldInput());

  await assert.rejects(
    () => create.execute(createHoldInput({ payoutDestination: "acct_other" })),
    /payment_hold_identity_conflict/,
  );
});

test("end of return window only makes the hold payout-ready", async () => {
  const store = new InMemoryPaymentHoldStore();
  const due = new Date("2026-09-01T00:00:00.000Z");
  await store.seed({
    ...createHoldInput({ paymentIntentId: "pay_due" }),
    id: "ignored",
    status: "held",
    holdUntil: due,
  });
  await store.seed({
    ...createHoldInput({ paymentIntentId: "pay_later" }),
    id: "ignored",
    status: "held",
    holdUntil: new Date("2026-10-01T00:00:00.000Z"),
  });

  const result = await new MakePaymentHoldsPayoutReadyUseCase(store as any).execute(new Date("2026-09-02T00:00:00.000Z"));

  assert.equal(result.payoutReady, 1);
  assert.equal(store.all().find(hold => hold.paymentIntentId === "pay_due")?.status, "payout_ready");
  assert.equal(store.all().find(hold => hold.paymentIntentId === "pay_later")?.status, "held");
  assert.equal(store.all().some(hold => hold.status === "released"), false);
});

test("refund and chargeback block an unpaid hold, but create recovery work after payout", async () => {
  const store = new InMemoryPaymentHoldStore();
  await store.seed({ ...createHoldInput({ paymentIntentId: "pay_refund" }), id: "ignored", status: "payout_ready", holdUntil: new Date() });
  await store.seed({ ...createHoldInput({ paymentIntentId: "pay_chargeback" }), id: "ignored", status: "released", holdUntil: new Date() });

  const refund = await new RefundPaymentHoldUseCase(store as any).execute("pay_refund");
  const chargeback = await new ChargebackPaymentHoldUseCase(store as any).execute("pay_chargeback");

  assert.equal(refund, "refunded");
  assert.equal(chargeback, "chargeback_debt");
});

test("approved delayed payment creates a hold; legacy payment remains untouched", async () => {
  const store = new InMemoryPaymentHoldStore();
  const lifecycle = new PaymentHoldLifecycleService(new CreatePaymentHoldUseCase(store as any));
  const base = {
    id: "pay_delayed",
    merchantId: "mrc_1",
    sessionId: "chk_1",
    idempotencyKey: "idem_1",
    amountCents: 10_099,
    currency: "BRL",
    method: "card" as const,
    status: "approved" as const,
    providerPaymentId: "pi_1",
    statusHistory: [],
  };

  await lifecycle.createForApprovedPayment({
    ...base,
    creation: { state: "complete", input: { ...createHoldInput(), merchantId: "mrc_1", sessionId: "chk_1", intentId: "pay_delayed", amountCents: 10_099, currency: "BRL", method: "card", settlementMode: "delayed_merchant_payout", merchantPayoutDestination: "acct_merchant_1", platformFeeCents: 249 } },
  });
  await lifecycle.createForApprovedPayment({ ...base, id: "pay_legacy", creation: undefined });

  assert.equal(store.all().length, 1);
  assert.equal(store.all()[0].paymentIntentId, "pay_delayed");
});
