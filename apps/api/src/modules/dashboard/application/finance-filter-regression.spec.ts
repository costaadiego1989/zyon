import assert from "node:assert/strict";
import { test } from "node:test";
import type { PrismaClient } from "@prisma/client";
import { FinanceDashboardUseCase } from "./finance-dashboard.use-case.js";

test("missing method and translated searches select the same movements in summary, list and CSV", async () => {
  const queries: any[] = [];
  const orders = ["card", "missing"].map((id, index) => ({ id, sessionId: id, externalOrderId: `ORDER-${id}`, orderTotal: index ? 1 : 29.9, currency: "BRL", status: "approved", completedAt: new Date("2026-10-02T15:00:00Z") }));
  const prisma = {
    completedOrder: { findMany: async (query: any) => { queries.push(query.where); return orders; } },
    returnRefund: { findMany: async () => [] },
    paymentIntent: { findMany: async (query: any) => query.where.status ? [] : [{ id: "payment", sessionId: "card", method: "card", status: "paid" }] },
  };
  const finance = new FinanceDashboardUseCase(prisma as unknown as PrismaClient);
  const period = { from: "2026-10-01", to: "2026-10-06" };
  const summary = await finance.summary("merchant", period);
  assert.deepEqual(summary.payment_methods, [{ method: "Cartão", completed_orders_gross_brl: 29.9, orders: 1 }, { method: "Não informado", completed_orders_gross_brl: 1, orders: 1 }]);
  const missing = await finance.transactions("merchant", { ...period, method: "Não informado" });
  assert.deepEqual(missing.items.map(row => row.order_reference), ["ORDER-missing"]);
  const missingCsv = await finance.exportCsv("merchant", { ...period, method: "Não informado" });
  assert.match(missingCsv, /ORDER-missing;Não informado;1,00/);
  assert.doesNotMatch(missingCsv, /ORDER-card/);
  for (const query of ["Cartão", " cartao ", "CARD"]) {
    const page = await finance.transactions("merchant", { ...period, q: query });
    assert.deepEqual(page.items.map(row => row.order_reference), ["ORDER-card"]);
    const csv = await finance.exportCsv("merchant", { ...period, q: query });
    assert.match(csv, /ORDER-card;Cartão;29,90/);
    assert.doesNotMatch(csv, /ORDER-missing/);
  }
  assert.equal(queries.every(where => where.merchantId === "merchant"), true);
});
