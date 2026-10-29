import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma } from "@prisma/client";
import { widgetPaymentAuthorityFixture } from "../../../payment/domain/widget-checkout-payment.fixture.js";
import { assertWidgetPaymentOrderInTransaction } from "./widget-payment-order-authority.js";
import { PrismaCheckoutRepository } from "../prisma/prisma-checkout.repository.js";
import type { PrismaClient } from "@prisma/client";

function fixture() {
  const f = widgetPaymentAuthorityFixture(), row = { ...f.scope, version: 3, status: "approved", approvedAmountCents: 12849,
    providerPaymentId: "synthetic-provider", acceptedOfferId: null };
  const locks: string[] = [], queries: unknown[] = [];
  const tx = { async $queryRaw(query: TemplateStringsArray) { locks.push(query.join("?")); return []; },
    paymentIntent: { async findFirst(query: unknown) { queries.push(query); return row; } },
    checkoutSession: { async findUnique() { throw new Error("must_not_read_mutable_checkout"); } },
    productVariant: { async findMany() { throw new Error("must_not_reprice_paid_order"); } },
  } as unknown as Prisma.TransactionClient;
  return { ...f, row, locks, queries, tx };
}
test("paid widget order proves actual approved row under same transaction fences, without repricing", async () => {
  const f = fixture(); await assertWidgetPaymentOrderInTransaction(f.tx, "merchant", "checkout", f.authority, "payment", "synthetic-provider");
  assert.equal(f.queries.length, 1); assert.match(f.locks[0]!, /merchants.*FOR UPDATE/);
  assert.ok(f.locks.some(sql => sql.includes("payment_intents") && sql.includes("FOR UPDATE")));
});
for (const fault of ["id", "merchant", "session", "pending", "refunded", "provider", "amount", "approved", "version", "missing", "identity", "input", "coupon"] as const)
  test(`actual ${fault} cannot authorize frozen order`, async () => {
    const f = fixture();
    if (fault === "id") f.row.id = "foreign";
    if (fault === "merchant") f.row.merchantId = "foreign";
    if (fault === "session") f.row.sessionId = "foreign";
    if (fault === "pending") f.row.status = "pending";
    if (fault === "refunded") f.row.status = "refunded";
    if (fault === "provider") f.row.providerPaymentId = "foreign";
    if (fault === "amount") f.row.amountCents++;
    if (fault === "approved") f.row.approvedAmountCents--;
    if (fault === "version") f.row.version = 0;
    if (fault === "missing") Reflect.deleteProperty(f.row.creation, "widgetCheckoutAuthority");
    if (fault === "identity") f.row.creation.widgetCheckoutAuthority.acceptanceEventId = "foreign";
    if (fault === "input") f.row.creation.input.intentId = "foreign";
    if (fault === "coupon") Reflect.set(f.row.creation, "couponAuthority", undefined);
    // The expected proof is a previously detached approval, not the row alias.
    await assert.rejects(assertWidgetPaymentOrderInTransaction(f.tx, "merchant", "checkout", widgetPaymentAuthorityFixture().authority,
      "payment", "synthetic-provider"), /payment_widget_checkout_authority_conflict/);
  });
test("a valid parsed authority cannot stand in for a missing real journal", async () => {
  const f = fixture(), tx = { ...f.tx, paymentIntent: { async findFirst() { return null; } } } as unknown as Prisma.TransactionClient;
  await assert.rejects(assertWidgetPaymentOrderInTransaction(tx, "merchant", "checkout", f.authority, "payment", "synthetic-provider"));
});
test("repository refuses detached widget order assertion outside the commit transaction", async () => {
  const f = fixture(), repo = new PrismaCheckoutRepository({} as PrismaClient);
  await assert.rejects(repo.assertWidgetPaymentOrderAuthority("merchant", "checkout", f.authority, "payment", "synthetic-provider"), /payment_widget_checkout_authority_conflict/);
  assert.equal(f.queries.length, 0);
});
test("repository delegates widget proof only on its same transaction-bound instance", async () => {
  const f = fixture(), repo = new PrismaCheckoutRepository(f.tx, true);
  await repo.assertWidgetPaymentOrderAuthority("merchant", "checkout", f.authority, "payment", "synthetic-provider");
  assert.equal(f.queries.length, 1);
});
