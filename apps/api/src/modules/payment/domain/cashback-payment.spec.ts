import test from "node:test";
import assert from "node:assert/strict";
import { assertPaymentAmount, orderTotalCents, type PaymentAmountBreakdown } from "./payment-amount.js";

const amount = (patch: Partial<PaymentAmountBreakdown> = {}): PaymentAmountBreakdown => ({
  version: 1, currency: "BRL", itemsSubtotalCents: 10000, discountCents: 0,
  shippingCents: 1500, platformFeeCents: 99, totalCents: 11599, ...patch,
});

test("CB-17 legacy totals remain valid with cashback absent", () => {
  const snapshot = amount();
  assert.doesNotThrow(() => assertPaymentAmount(snapshot, 11599, "BRL"));
  assert.equal(orderTotalCents(snapshot, 11599), 11500);
});

test("CB-13 cashback is separate from discount, shipping and platform fee", () => {
  const snapshot = amount({ cashbackCents: 2000, cashbackReservationId: "reservation-1", totalCents: 9599 });
  assert.doesNotThrow(() => assertPaymentAmount(snapshot, 9599, "BRL"));
  assert.equal(orderTotalCents(snapshot, 9599), 9500);
  assert.equal(snapshot.discountCents, 0);
  assert.equal(snapshot.shippingCents, 1500);
  assert.equal(snapshot.platformFeeCents, 99);
});

test("CB-15 cashback cannot authorize a different provider capture", () => {
  const snapshot = amount({ cashbackCents: 2000, cashbackReservationId: "reservation-1", totalCents: 9599 });
  assert.throws(() => assertPaymentAmount(snapshot, 11599, "BRL"), /payment_amount_breakdown_invalid/);
});

test("CB-13 a monetary cashback reduction requires its reservation", () => {
  assert.throws(() => assertPaymentAmount(amount({ cashbackCents: 2000, totalCents: 9599 }), 9599, "BRL"), /payment_amount_breakdown_invalid/);
});

test("CB-15 cashback cannot consume freight or another commercial discount", () => {
  const snapshot = amount({ discountCents: 9000, cashbackCents: 2000, cashbackReservationId: "r", totalCents: 599 });
  assert.throws(() => assertPaymentAmount(snapshot, 599, "BRL"), /payment_amount_breakdown_invalid/);
});

test("CB-15 invalid cashback cents and currency are rejected", () => {
  for (const cashbackCents of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => assertPaymentAmount(amount({ cashbackCents, cashbackReservationId: "r" }), 11599, "BRL"));
  }
  assert.throws(() => assertPaymentAmount(amount(), 11599, "USD"));
});
