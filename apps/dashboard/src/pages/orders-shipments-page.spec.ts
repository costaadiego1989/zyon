import { describe, expect, it } from "vitest";
import {
  computeOrderMetrics,
  filterOrders,
  STATUS_LABELS,
} from "./orders-shipments-page.js";
import type { TenantOrder } from "../api-client.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeOrder(overrides: Partial<TenantOrder> = {}): TenantOrder {
  return {
    id: "ord_1",
    session_id: "sess_1",
    external_order_id: "EXT-001",
    status: "approved",
    total: 10050,
    currency: "BRL",
    tracking_code: null,
    customer: { full_name: "João Silva", email: "joao@example.com" },
    cart: { items: [] },
    completed_at: "2026-06-15T14:30:00Z",
    cancelled_at: null,
    cancellation_reason: null,
    payment_method: null,
    payment_provider: null,
    paid_at: null,
    ...overrides,
  };
}

// ── STATUS_LABELS ────────────────────────────────────────────────────────────

describe("STATUS_LABELS", () => {
  it("maps approved to Aprovado", () => {
    expect(STATUS_LABELS.approved).toBe("Aprovado");
  });

  it("maps cancelled to Cancelado", () => {
    expect(STATUS_LABELS.cancelled).toBe("Cancelado");
  });

  it("maps pending to Aguardando", () => {
    expect(STATUS_LABELS.pending).toBe("Aguardando");
  });

  it("maps processing to Processando", () => {
    expect(STATUS_LABELS.processing).toBe("Processando");
  });

  it("maps failed to Falhou", () => {
    expect(STATUS_LABELS.failed).toBe("Falhou");
  });

  it("maps refunded to Reembolsado", () => {
    expect(STATUS_LABELS.refunded).toBe("Reembolsado");
  });
});

// ── computeOrderMetrics ──────────────────────────────────────────────────────

describe("computeOrderMetrics", () => {
  it("returns zeros for empty array", () => {
    const metrics = computeOrderMetrics([]);
    expect(metrics.totalOrders).toBe(0);
    expect(metrics.approvedCount).toBe(0);
    expect(metrics.approvalRate).toBe(0);
    expect(metrics.totalRevenue).toBe(0);
    expect(metrics.trackedCount).toBe(0);
    expect(metrics.averageOrderValue).toBe(0);
  });

  it("computes correct counts for mixed orders", () => {
    const orders = [
      makeOrder({ id: "1", status: "approved", total: 5000, tracking_code: "TR1" }),
      makeOrder({ id: "2", status: "approved", total: 3000, tracking_code: null }),
      makeOrder({ id: "3", status: "cancelled", total: 2000, tracking_code: null }),
    ];
    const metrics = computeOrderMetrics(orders);
    expect(metrics.totalOrders).toBe(3);
    expect(metrics.approvedCount).toBe(2);
    expect(metrics.approvalRate).toBeCloseTo(2 / 3);
    expect(metrics.totalRevenue).toBe(8000);
    expect(metrics.trackedCount).toBe(1);
    expect(metrics.averageOrderValue).toBe(4000);
  });

  it("computes average only from approved orders", () => {
    const orders = [
      makeOrder({ id: "1", status: "approved", total: 10000 }),
      makeOrder({ id: "2", status: "cancelled", total: 50000 }),
    ];
    const metrics = computeOrderMetrics(orders);
    expect(metrics.averageOrderValue).toBe(10000);
  });

  it("counts tracked orders regardless of status", () => {
    const orders = [
      makeOrder({ id: "1", status: "approved", tracking_code: "TR1" }),
      makeOrder({ id: "2", status: "cancelled", tracking_code: "TR2" }),
      makeOrder({ id: "3", status: "approved", tracking_code: null }),
    ];
    const metrics = computeOrderMetrics(orders);
    expect(metrics.trackedCount).toBe(2);
  });
});

// ── filterOrders ─────────────────────────────────────────────────────────────

describe("filterOrders", () => {
  const orders = [
    makeOrder({ id: "1", status: "approved", external_order_id: "EXT-100", customer: { full_name: "Maria Souza" } }),
    makeOrder({ id: "2", status: "approved", external_order_id: "EXT-200", customer: { full_name: "João Silva" } }),
    makeOrder({ id: "3", status: "cancelled", external_order_id: "EXT-300", customer: { full_name: "Ana Lima" } }),
    makeOrder({ id: "4", status: "cancelled", external_order_id: "EXT-400", customer: null }),
    makeOrder({ id: "5", status: "approved", external_order_id: "EXT-500", customer: { email: "pedro@test.com" } }),
  ];

  it("returns all orders when status is 'all' and query is empty", () => {
    expect(filterOrders(orders, "all", "")).toHaveLength(5);
  });

  it("filters by approved status", () => {
    const result = filterOrders(orders, "approved", "");
    expect(result).toHaveLength(3);
    expect(result.every((o) => o.status === "approved")).toBe(true);
  });

  it("filters by cancelled status", () => {
    const result = filterOrders(orders, "cancelled", "");
    expect(result).toHaveLength(2);
    expect(result.every((o) => o.status === "cancelled")).toBe(true);
  });

  it("searches by partial external_order_id", () => {
    const result = filterOrders(orders, "all", "EXT-10");
    expect(result).toHaveLength(1);
    expect(result[0].external_order_id).toBe("EXT-100");
  });

  it("searches by customer name case-insensitively", () => {
    const result = filterOrders(orders, "all", "maria");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
  });

  it("combines status filter with search", () => {
    const result = filterOrders(orders, "approved", "silva");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("2");
  });

  it("handles null customer gracefully in search", () => {
    const result = filterOrders(orders, "all", "xyz");
    expect(result).toHaveLength(0);
  });

  it("searches by customer email", () => {
    const result = filterOrders(orders, "all", "pedro");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("5");
  });

  it("filters by startDate (inclusive)", () => {
    const result = filterOrders(orders, "all", "", "2026-06-16");
    expect(result).toHaveLength(0);
  });

  it("filters by endDate (inclusive of day end)", () => {
    const result = filterOrders(orders, "all", "", undefined, "2026-06-15");
    expect(result).toHaveLength(5);
  });
});
