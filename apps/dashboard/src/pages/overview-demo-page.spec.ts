import { describe, expect, it } from "vitest";
import type { CheckoutSession, DashboardOverview, SupportTicket } from "@zyon/shared-types";
import { buildPilotMetrics } from "./overview-demo-page.js";

const now = "2026-05-21T00:00:00.000Z";

function session(input: Partial<CheckoutSession>): CheckoutSession {
  return {
    merchantId: "mrc_1",
    sessionId: input.sessionId ?? "chk_1",
    globalUserId: "buyer_1",
    conversationId: "conv_1",
    cart: { currency: "BRL", total: 100, items: [] },
    abandonmentScore: 0.2,
    triggerAgent: false,
    chatHistory: [],
    createdAt: now,
    updatedAt: now,
    ...input
  };
}

function ticket(input: Pick<SupportTicket, "id" | "status">): SupportTicket {
  return {
    id: input.id,
    merchantId: "mrc_1",
    buyerMessage: "Preciso de ajuda",
    status: input.status,
    source: "widget",
    createdAt: now,
    updatedAt: now
  };
}

describe("buildPilotMetrics", () => {
  it("deriva metricas de pedidos, ofertas, frete e suporte para o painel piloto", () => {
    const overview: DashboardOverview = {
      merchant_id: "mrc_1",
      conversations_started: 4,
      offers_viewed: 5,
      offers_accepted: 2,
      orders_completed: 3,
      conversion_rate_with_agent: 0.75,
      average_discount: 3,
      average_shipping_subsidy: 5,
      incremental_revenue: 300,
      recent_sessions: [
        session({ sessionId: "chk_paid", shipping: { customerPrice: 19.9, method: "PAC" } }),
        session({ sessionId: "chk_free", shipping: { customerPrice: 0, method: "Gratis" } }),
        session({ sessionId: "chk_pending" })
      ],
      recent_offers: []
    };

    const metrics = buildPilotMetrics(overview, [
      ticket({ id: "sup_1", status: "open" }),
      ticket({ id: "sup_2", status: "in_progress" }),
      ticket({ id: "sup_3", status: "resolved" })
    ]);

    expect(metrics.completedOrders).toBe(3);
    expect(metrics.conversionRate).toBe(0.75);
    expect(metrics.offersAccepted).toBe(2);
    expect(metrics.offersViewed).toBe(5);
    expect(metrics.offerAcceptanceRate).toBe(0.4);
    expect(metrics.selectedShippingSessions).toBe(2);
    expect(metrics.pendingShippingSessions).toBe(1);
    expect(metrics.averageSelectedShipping).toBeCloseTo(9.95);
    expect(metrics.openSupportTickets).toBe(2);
    expect(metrics.resolvedSupportTickets).toBe(1);
    expect(metrics.incrementalRevenue).toBe(300);
  });

  it("mantem suporte como indisponivel quando o operador nao esta logado", () => {
    const metrics = buildPilotMetrics(null, null);

    expect(metrics.openSupportTickets).toBeNull();
    expect(metrics.resolvedSupportTickets).toBeNull();
    expect(metrics.completedOrders).toBe(0);
  });
});
