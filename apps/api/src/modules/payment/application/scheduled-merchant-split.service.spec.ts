import test from "node:test";
import assert from "node:assert/strict";
import { ScheduledMerchantSplitService } from "./scheduled-merchant-split.service.js";

function fixture() {
  const fulfilledAt = new Date("2026-10-13T20:00:00Z");
  const capture = { provider: "stripe", environment: "test", accountFingerprint: "original-account", providerPaymentId: "pi_original",
    amountCents: 599, currency: "BRL", sourceId: "ch_original", balanceTransactionId: "txn_original", providerFeeCents: 61,
    netAmountCents: 538, availableAt: "2026-11-12T20:00:00Z", fundsAvailable: false };
  const hold: any = { id: "hold_owned", merchantId: "mrc_owned", paymentIntentId: "intent_owned", provider: "stripe", providerPaymentId: "pi_original",
    payoutDestination: "acct_owned", totalAmountCents: 599, platformFeeCents: 198, providerFeeCents: 61, merchantNetCents: 340,
    holdDays: 7, holdAnchor: "fulfillment", status: "awaiting_fulfillment", holdUntil: null, captureEvidence: capture };
  const input = { merchantId: "mrc_owned", sessionId: "checkout_owned", intentId: "intent_owned", provider: "stripe", amountCents: 599, currency: "BRL",
    method: "card", platformFeeCents: 198, settlementMode: "delayed_merchant_payout", merchantPayoutDestination: "acct_owned", merchantPayoutHoldDays: 7,
    merchantPayoutAnchor: "fulfillment", providerAccountFingerprint: "original-account" };
  const payment: any = { id: "intent_owned", status: "approved", creation: { input } };
  const order: any = { id: "order_owned", status: "approved", completedAt: new Date("2026-10-12T20:00:00Z"), fulfilledAt,
    fulfillmentJson: { schemaVersion: 1, units: [{ id: "unit_1", name: "Teste de pagamento", variantId: "variant_1", productType: "service", strategy: "service",
      quantity: 1, completedQuantity: 1, status: "completed", selectedOptions: [] }] } };
  const state = { returnOpened: false, providerState: "pending", submissions: 0, unknownSubmission: false, observations: [] as any[] };
  const matches = (where: any) => (!where.status || (typeof where.status === "string" ? hold.status === where.status : where.status.in.includes(hold.status))) &&
    (!where.holdUntil || (where.holdUntil.lte ? hold.holdUntil && hold.holdUntil <= where.holdUntil.lte : hold.holdUntil === where.holdUntil)) &&
    (!where.fulfilledAt || hold.fulfilledAt !== null);
  const prisma: any = {
    paymentHold: { findMany: async ({ where }: any) => matches(where) ? [hold] : [], updateMany: async ({ where, data }: any) => {
      if (!matches(where)) return { count: 0 }; Object.assign(hold, data); return { count: 1 };
    } },
    completedOrder: { findFirst: async () => order },
    paymentIntent: { findFirst: async ({ where }: any) => where.status && payment.status !== where.status ? null : payment },
    return: { findFirst: async () => state.returnOpened ? { id: "return_owned" } : null },
    $queryRawUnsafe: async (sql: string) => sql.includes("SELECT h.id") ? [{ id: hold.id }] : [], $transaction: async (fn: any) => fn(prisma),
  };
  const provider: any = {
    readCapture: async () => ({ ...capture }),
    submit: async (request: any) => { state.submissions++; assert.equal(request.amountCents, 340); assert.equal(request.destination, "acct_owned");
      if (state.unknownSubmission) throw new Error("provider_timeout_after_post");
      return { state: "pending", providerTransferId: "tr_owned" }; },
    reconcile: async () => ({ state: state.providerState, providerTransferId: "tr_owned" }),
  };
  const ledger: any = { appendObservation: async (observation: any) => { state.observations.push(observation); } };
  return { hold, order, capture, input, payment, state, service: new ScheduledMerchantSplitService(prisma, provider, ledger) };
}

test("no split date starts at payment; missing or incomplete fulfillment retains the merchant share", async () => {
  for (const incomplete of ["missing", "partial", "future", "no_show"]) {
    const f = fixture();
    if (incomplete === "missing") f.order.fulfilledAt = null;
    if (incomplete === "partial") f.order.fulfillmentJson.units[0].completedQuantity = 0;
    if (incomplete === "future") f.order.fulfilledAt = new Date("2026-10-30T20:00:00Z");
    if (incomplete === "no_show") f.order.fulfillmentJson.units[0].status = "no_show";
    await f.service.execute(new Date("2026-10-20T20:00:00Z"));
    assert.equal(f.hold.status, "awaiting_fulfillment"); assert.equal(f.hold.holdUntil, null); assert.equal(f.state.submissions, 0);
  }
});

test("split is scheduled at fulfillment plus exactly seven days, with no bank-settlement days added", async () => {
  const f = fixture();
  assert.equal((await f.service.execute(new Date("2026-10-13T20:00:00Z"))).scheduled, 1);
  assert.equal(f.hold.holdUntil.toISOString(), "2026-10-20T20:00:00.000Z");
  await f.service.execute(new Date("2026-10-20T19:59:59.999Z"));
  assert.equal(f.state.submissions, 0);
  const due = await f.service.execute(new Date("2026-10-20T20:00:00Z"));
  assert.equal(due.submitted, 1); assert.equal(f.hold.status, "payout_submitted"); assert.equal(f.state.submissions, 1);
  assert.equal(f.state.observations.length, 0);
});

test("provider reservation stays pending; release needs the exact confirmed receipt and conserves actual fees", async () => {
  const f = fixture();
  await f.service.execute(new Date("2026-10-20T20:00:00Z"));
  await f.service.execute(new Date("2026-10-21T20:00:00Z"));
  assert.equal(f.state.submissions, 1); assert.equal(f.hold.releasedAt, undefined);
  f.state.providerState = "confirmed";
  assert.equal((await f.service.execute(new Date("2026-11-12T20:00:00Z"))).released, 1);
  assert.equal(f.hold.status, "released");
  const observation = f.state.observations[0];
  assert.equal(observation.confirmedGrossCents, observation.confirmedPlatformFeeCents + observation.confirmedProviderFeeCents + observation.confirmedMerchantNetCents);
  assert.equal(observation.confirmedMerchantNetCents, 340);
  await f.service.execute(new Date("2026-11-13T20:00:00Z"));
  assert.equal(f.state.submissions, 1); assert.equal(f.state.observations.length, 1);
});

test("a return request or payment chargeback prevents the split even after its due date", async () => {
  for (const reason of ["return", "chargeback", "cancelled-order"]) {
    const f = fixture();
    if (reason === "return") f.state.returnOpened = true;
    if (reason === "chargeback") f.payment.status = "chargeback_pending";
    if (reason === "cancelled-order") f.order.status = "cancelled";
    await f.service.execute(new Date("2026-10-21T20:00:00Z"));
    assert.equal(f.state.submissions, 0); assert.equal(f.state.observations.length, 0);
  }
});

test("fee, source or recipient changes cannot redirect the saved merchant allocation", async () => {
  for (const field of ["source", "fee", "recipient"]) {
    const f = fixture();
    if (field === "source") f.hold.captureEvidence = { ...f.capture, sourceId: "ch_foreign" };
    if (field === "fee") f.hold.captureEvidence = { ...f.capture, providerFeeCents: 62 };
    if (field === "recipient") f.input.merchantPayoutDestination = "acct_foreign";
    await f.service.execute(new Date("2026-10-21T20:00:00Z"));
    assert.equal(f.state.submissions, 0); assert.equal(f.state.observations.length, 0);
  }
});

test("an ambiguous transfer submission is reconciled by reads and is never submitted twice", async () => {
  const f = fixture(); f.state.unknownSubmission = true;
  await f.service.execute(new Date("2026-10-20T20:00:00Z"));
  assert.equal(f.hold.status, "payout_submitted");
  await f.service.execute(new Date("2026-10-21T20:00:00Z"));
  assert.equal(f.state.submissions, 1);
  f.state.providerState = "confirmed";
  assert.equal((await f.service.execute(new Date("2026-11-12T20:00:00Z"))).released, 1);
  assert.equal(f.state.submissions, 1);
});

test("rescheduling or removing fulfilled quantities blocks an already scheduled split", async () => {
  const f = fixture();
  await f.service.execute(new Date("2026-10-13T20:00:00Z"));
  f.order.fulfillmentJson.units[0].status = "scheduled";
  f.order.fulfillmentJson.units[0].completedQuantity = 0;
  await f.service.execute(new Date("2026-10-21T20:00:00Z"));
  assert.equal(f.state.submissions, 0);
});
