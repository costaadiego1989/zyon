import { describe, it, expect } from "vitest";
import { normalizeCustomerPurchases, calculatePurchaseMetrics, formatCustomerPurchaseMoney } from "./customer-purchase-money.js";

describe("customer purchase money contracts", () => {
  it("reads both operations total and v1 total_minor as cents, with canonical precedence", () => {
    const history = normalizeCustomerPurchases([
      { order_id: "legacy", total: 1000, completed_at: "2026-10-03", currency: "BRL" },
      { order_id: "v1", total_minor: 2000, total: 9999, completed_at: "2026-10-03", currency: "BRL" },
    ]);
    expect(history.map(p => p.total_minor)).toEqual([1000, 2000]);
    expect(calculatePurchaseMetrics(history)).toEqual({ totalOrders: 2, totalRevenue: 30, avgTicket: 15 });
    expect(formatCustomerPurchaseMoney(history[0])).toMatch(/10,00/);
  });
  it("preserves explicit zero and an actually empty history", () => {
    const history = normalizeCustomerPurchases([{ order_id: "zero", total_minor: 0, total: 9999 }]);
    expect(calculatePurchaseMetrics(history)).toEqual({ totalOrders: 1, totalRevenue: 0, avgTicket: 0 });
    expect(formatCustomerPurchaseMoney(history[0])).toMatch(/0,00/);
    expect(calculatePurchaseMetrics([])).toEqual({ totalOrders: 0, totalRevenue: 0, avgTicket: 0 });
  });
  it.each([undefined, null, "1000", NaN, Infinity, -1, 10.5, Number.MAX_SAFE_INTEGER + 1])("shows unavailable for malformed amount %s without inventing zero", amount => {
    const history = normalizeCustomerPurchases([{ order_id: "bad", total_minor: amount }]);
    expect(history[0].total_minor).toBeNull();
    expect(calculatePurchaseMetrics(history)).toEqual({ totalOrders: 1, totalRevenue: null, avgTicket: null });
    expect(formatCustomerPurchaseMoney(history[0])).toBe("Valor indisponível");
  });
  it("does not silently replace an invalid canonical amount with the old field", () => {
    expect(normalizeCustomerPurchases([{ total_minor: null, total: 1000 }])[0].total_minor).toBeNull();
  });
  it("does not sum currencies into BRL but formats each recorded currency", () => {
    const history = normalizeCustomerPurchases([{ order_id: "br", total: 1000, currency: "BRL" }, { order_id: "us", total: 1500, currency: "USD" }]);
    expect(calculatePurchaseMetrics(history)).toEqual({ totalOrders: 2, totalRevenue: null, avgTicket: null });
    expect(formatCustomerPurchaseMoney(history[1])).toMatch(/15,00/);
    const yen = normalizeCustomerPurchases([{ total_minor: 1000, currency: "JPY" }]);
    expect(formatCustomerPurchaseMoney(yen[0])).toMatch(/1\.000/);
  });
  it("handles unknown records, invalid currency and sum overflow without NaN or exceptions", () => {
    const malformed = normalizeCustomerPurchases([null, "bad", { currency: "invalid", total: 1000 }]);
    expect(malformed[0].order_id).toBe("");
    expect(formatCustomerPurchaseMoney(malformed[2])).toBe("Valor indisponível");
    const overflow = normalizeCustomerPurchases([{ total: Number.MAX_SAFE_INTEGER }, { total: Number.MAX_SAFE_INTEGER }]);
    expect(calculatePurchaseMetrics(overflow).totalRevenue).toBeNull();
  });
});
