import { describe, expect, it, vi, type Mock } from "vitest";
import type { CheckoutSession, DashboardOverview, SupportTicket } from "@zyon/shared-types";
import { buildPilotMetrics, formatPercent, formatCurrency, formatCompactCurrency, relativeTime } from "./overview-demo-page.js";
import { createDashboardApi, normalizeApiBase } from "../api-client.js";

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FetchMock = Mock<(...args: any[]) => Promise<Response>>;

function makeFetch(responseBody: unknown, status = 200): FetchMock {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: () =>
      Promise.resolve(
        typeof responseBody === "string" ? responseBody : JSON.stringify(responseBody),
      ),
  } as Response) as FetchMock;
}

function capturedUrl(fetchMock: FetchMock): string {
  return (fetchMock.mock.calls[0] as [string, ...unknown[]])[0] as string;
}

function asF(m: FetchMock): typeof fetch {
  return m as unknown as typeof fetch;
}

const BASE = "http://localhost:3000";

// ── buildPilotMetrics ─────────────────────────────────────────────────────────

describe("buildPilotMetrics", () => {
  it("deriva métricas de pedidos, ofertas, frete e suporte para o painel piloto", () => {
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
        session({ sessionId: "chk_free", shipping: { customerPrice: 0, method: "Grátis" } }),
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

  it("mantém suporte como indisponível quando o operador não está logado", () => {
    const metrics = buildPilotMetrics(null, null);

    expect(metrics.openSupportTickets).toBeNull();
    expect(metrics.resolvedSupportTickets).toBeNull();
    expect(metrics.completedOrders).toBe(0);
  });

  it("retorna taxas zeradas quando não há ofertas visualizadas", () => {
    const overview: DashboardOverview = {
      merchant_id: "mrc_1",
      conversations_started: 0,
      offers_viewed: 0,
      offers_accepted: 0,
      orders_completed: 0,
      conversion_rate_with_agent: 0,
      average_discount: 0,
      average_shipping_subsidy: 0,
      incremental_revenue: 0,
      recent_sessions: [],
      recent_offers: []
    };

    const metrics = buildPilotMetrics(overview, []);

    expect(metrics.offerAcceptanceRate).toBe(0);
    expect(metrics.averageSelectedShipping).toBe(0);
    expect(metrics.selectedShippingSessions).toBe(0);
    expect(metrics.pendingShippingSessions).toBe(0);
  });
});

// ── getDashboardOverview (api-client) ─────────────────────────────────────────

describe("getDashboardOverview", () => {
  it("chama GET /checkout/dashboard/overview/:merchantId com o merchant correto", async () => {
    const overviewPayload: DashboardOverview = {
      merchant_id: "mrc_test",
      conversations_started: 10,
      offers_viewed: 20,
      offers_accepted: 8,
      orders_completed: 5,
      conversion_rate_with_agent: 0.5,
      average_discount: 7,
      average_shipping_subsidy: 3,
      incremental_revenue: 1500,
      recent_sessions: [],
      recent_offers: []
    };
    const f = makeFetch(overviewPayload);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    const result = await api.getDashboardOverview("mrc_test");

    expect(result).toEqual(overviewPayload);
    const url = capturedUrl(f);
    expect(url).toBe(`${normalizeApiBase(BASE)}/v1/checkout/dashboard/overview/mrc_test`);
  });

  it("propaga DashboardHttpError quando o endpoint retorna erro", async () => {
    const f = makeFetch("not_found", 404);
    const api = createDashboardApi({ baseUrl: BASE, fetchImpl: asF(f) });

    await expect(api.getDashboardOverview("mrc_missing")).rejects.toThrow();
  });
});

// ── Formatters ────────────────────────────────────────────────────────────────

describe("formatters", () => {
  describe("formatPercent", () => {
    it("converte decimal para porcentagem arredondada", () => {
      expect(formatPercent(0.756)).toBe("76%");
      expect(formatPercent(0)).toBe("0%");
      expect(formatPercent(1)).toBe("100%");
    });
  });

  describe("formatCurrency", () => {
    it("formata valor em BRL com separadores pt-BR", () => {
      const result = formatCurrency(1234.5);
      expect(result).toContain("R$");
      expect(result).toContain("1.234");
    });
  });

  describe("formatCompactCurrency", () => {
    it("usa sufixo mil para valores >= 1000", () => {
      const result = formatCompactCurrency(2500);
      expect(result).toContain("R$");
      expect(result).toContain("2,5");
      expect(result).toContain("mil");
    });

    it("usa formato normal para valores < 1000", () => {
      const result = formatCompactCurrency(500);
      expect(result).toContain("R$");
      expect(result).not.toContain("mil");
    });
  });

  describe("relativeTime", () => {
    it("retorna -- para data inválida", () => {
      expect(relativeTime("invalid")).toBe("--");
    });

    it("retorna 'agora' para timestamps recentes", () => {
      const justNow = new Date(Date.now() - 10000).toISOString();
      expect(relativeTime(justNow)).toBe("agora");
    });

    it("retorna minutos com acento correto 'há'", () => {
      const fiveMinAgo = new Date(Date.now() - 5 * 60000).toISOString();
      expect(relativeTime(fiveMinAgo)).toBe("há 5 min");
    });

    it("retorna horas com acento correto 'há'", () => {
      const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60000).toISOString();
      expect(relativeTime(twoHoursAgo)).toBe("há 2 h");
    });

    it("retorna dias com acento correto 'há'", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60000).toISOString();
      expect(relativeTime(threeDaysAgo)).toBe("há 3 d");
    });
  });
});

// ── Portuguese accent correctness ─────────────────────────────────────────────

describe("Portuguese accent strings", () => {
  it("relativeTime usa 'há' com acento grave", () => {
    const tenMinAgo = new Date(Date.now() - 10 * 60000).toISOString();
    const result = relativeTime(tenMinAgo);
    expect(result).toMatch(/^há /);
    expect(result).not.toMatch(/^ha /);
  });
});
