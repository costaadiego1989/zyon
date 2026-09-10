import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { FinanceDashboardUseCase } from "./finance-dashboard.use-case.js";

type DecimalValue = { toNumber(): number };

const decimal = (value: number): DecimalValue => ({ toNumber: () => value });

describe("FinanceDashboardUseCase", () => {
  it("separates completed sales from confirmed refunds and never crosses merchants", async () => {
    const prisma = new FinancePrismaStub();
    const finance = new FinanceDashboardUseCase(prisma as unknown as PrismaClient);

    const summary = await finance.summary("merchant_a", { from: "2026-09-01", to: "2026-09-10" });

    assert.deepEqual(summary.metrics, {
      sales_confirmed_brl: 149.9,
      completed_orders: 2,
      average_order_value_brl: 74.95,
      refunds_confirmed_brl: 105.99,
    });
    assert.deepEqual(summary.payment_methods, [
      { method: "PIX", sales_brl: 100, orders: 1 },
      { method: "Cartão", sales_brl: 49.9, orders: 1 },
    ]);
    assert.deepEqual(summary.series, [
      { date: "2026-09-03", sales_brl: 100, refunds_brl: 0 },
      { date: "2026-09-04", sales_brl: 49.9, refunds_brl: 0 },
      { date: "2026-09-05", sales_brl: 0, refunds_brl: 25.99 },
      { date: "2026-09-06", sales_brl: 0, refunds_brl: 80 },
    ]);

    const transactions = await finance.transactions("merchant_a", {
      from: "2026-09-01",
      to: "2026-09-10",
      page: 1,
      limit: 2,
    });
    assert.equal(transactions.total, 4);
    assert.equal(transactions.items.length, 2);
    assert.equal(transactions.items[0]?.kind, "refund");
    assert.equal(transactions.items[0]?.amount_brl, -80);

    const cardTransactions = await finance.transactions("merchant_a", {
      from: "2026-09-01",
      to: "2026-09-10",
      page: 1,
      limit: 10,
      method: "Cartão",
    });
    assert.equal(cardTransactions.total, 2);

    const csv = await finance.exportCsv("merchant_a", {
      from: "2026-09-01",
      to: "2026-09-10",
      type: "sale",
      method: "card",
    });
    assert.match(csv, /ORDER-049/);
    assert.doesNotMatch(csv, /'=ORDER-100|ORDER-080|ORD-CANCELLED|ORDER-OTHER/);
    assert.equal(prisma.merchantIds.every((merchantId) => merchantId === "merchant_a"), true);
  });

  it("exports negative refunds as numeric CSV cells while protecting untrusted references", async () => {
    const prisma = new FinancePrismaStub();
    const finance = new FinanceDashboardUseCase(prisma as unknown as PrismaClient);

    const csv = await finance.exportCsv("merchant_a", {
      from: "2026-09-01",
      to: "2026-09-10",
      type: "refund",
    });

    assert.match(csv, /;'=ORDER-100;PIX;-25,99;COMPLETED;/);
    assert.doesNotMatch(csv, /;'-25,99;/);
  });

  it("rejects invalid periods before querying financial data", async () => {
    const prisma = new FinancePrismaStub();
    const finance = new FinanceDashboardUseCase(prisma as unknown as PrismaClient);

    await assert.rejects(
      finance.summary("merchant_a", { from: "2025-01-01", to: "2026-09-01" }),
      /finance_period_too_large/,
    );
    assert.equal(prisma.merchantIds.length, 0);
  });
});

class FinancePrismaStub {
  readonly merchantIds: string[] = [];

  readonly completedOrder = {
    findMany: async ({ where }: { where: any }) => {
      this.merchantIds.push(where.merchantId);
      return orders
        .filter((order) => order.merchantId === where.merchantId)
        .filter((order) => !where.completedAt || (order.completedAt >= where.completedAt.gte && order.completedAt < where.completedAt.lt))
        .filter((order) => !where.sessionId || where.sessionId.in.includes(order.sessionId))
        .filter((order) => !where.status.notIn.includes(order.status));
    },
  };

  readonly returnRefund = {
    findMany: async ({ where }: { where: any }) => {
      this.merchantIds.push(where.return.merchantId);
      return refunds
        .filter((refund) => refund.return.merchantId === where.return.merchantId)
        .filter((refund) => refund.status === where.status)
        .filter((refund) => refund.processedAt && refund.processedAt >= where.processedAt.gte && refund.processedAt < where.processedAt.lt);
    },
  };

  readonly paymentIntent = {
    findMany: async ({ where }: { where: any }) => {
      this.merchantIds.push(where.merchantId);
      if (where.status === "refunded") {
        return payments
          .filter((payment) => payment.merchantId === where.merchantId)
          .filter((payment) => payment.status === where.status)
          .filter((payment) => payment.updatedAt >= where.updatedAt.gte && payment.updatedAt < where.updatedAt.lt);
      }
      const ids = new Set<string>();
      const sessions = new Set<string>();
      for (const clause of where.OR ?? []) {
        for (const id of clause.id?.in ?? []) ids.add(id);
        for (const sessionId of clause.sessionId?.in ?? []) sessions.add(sessionId);
      }
      return payments.filter(
        (payment) =>
          payment.merchantId === where.merchantId &&
          (ids.has(payment.id) || sessions.has(payment.sessionId)),
      );
    },
  };
}

const orders = [
  { id: "order_pix", merchantId: "merchant_a", sessionId: "session_pix", externalOrderId: "=ORDER-100", orderTotal: decimal(100), currency: "BRL", status: "approved", completedAt: new Date("2026-09-03T15:00:00.000Z") },
  { id: "order_card", merchantId: "merchant_a", sessionId: "session_card", externalOrderId: "ORDER-049", orderTotal: decimal(49.9), currency: "BRL", status: "approved", completedAt: new Date("2026-09-04T15:00:00.000Z") },
  { id: "order_cancelled", merchantId: "merchant_a", sessionId: "session_cancelled", externalOrderId: "ORD-CANCELLED", orderTotal: decimal(900), currency: "BRL", status: "cancelled", completedAt: new Date("2026-09-05T15:00:00.000Z") },
  { id: "order_usd", merchantId: "merchant_a", sessionId: "session_usd", externalOrderId: "ORDER-USD", orderTotal: decimal(1), currency: "USD", status: "approved", completedAt: new Date("2026-09-05T15:00:00.000Z") },
  { id: "order_other", merchantId: "merchant_b", sessionId: "session_other", externalOrderId: "ORDER-OTHER", orderTotal: decimal(500), currency: "BRL", status: "approved", completedAt: new Date("2026-09-05T15:00:00.000Z") },
  { id: "order_provider_refund", merchantId: "merchant_a", sessionId: "session_provider_refund", externalOrderId: "ORDER-080", orderTotal: decimal(80), currency: "BRL", status: "approved", completedAt: new Date("2026-08-25T15:00:00.000Z") },
];

const refunds = [
  { id: "refund_pix", paymentIntentId: "payment_pix", amountInCents: 2599, status: "COMPLETED", processedAt: new Date("2026-09-05T15:00:00.000Z"), return: { merchantId: "merchant_a", orderId: "=ORDER-100" } },
  { id: "refund_pending", paymentIntentId: "payment_card", amountInCents: 4990, status: "PENDING", processedAt: new Date("2026-09-05T15:00:00.000Z"), return: { merchantId: "merchant_a", orderId: "ORDER-049" } },
  { id: "refund_other", paymentIntentId: "payment_other", amountInCents: 1000, status: "COMPLETED", processedAt: new Date("2026-09-05T15:00:00.000Z"), return: { merchantId: "merchant_b", orderId: "ORDER-OTHER" } },
];

const payments = [
  { id: "payment_pix", merchantId: "merchant_a", sessionId: "session_pix", method: "pix", status: "approved", updatedAt: new Date("2026-09-03T15:00:00.000Z") },
  { id: "payment_card", merchantId: "merchant_a", sessionId: "session_card", method: "credit_card", status: "approved", updatedAt: new Date("2026-09-04T15:00:00.000Z") },
  { id: "payment_other", merchantId: "merchant_b", sessionId: "session_other", method: "pix", status: "approved", updatedAt: new Date("2026-09-05T15:00:00.000Z") },
  { id: "payment_provider_refund", merchantId: "merchant_a", sessionId: "session_provider_refund", method: "card", status: "refunded", updatedAt: new Date("2026-09-06T15:00:00.000Z") },
];
