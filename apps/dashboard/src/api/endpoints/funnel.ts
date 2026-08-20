import { dashboardJson } from "../http/client.js";

export interface FunnelData {
  steps: Array<{ name: string; label: string; count: number; percentage: number }>;
  transitions: Array<{ from: string; to: string; rate: number; dropOff: number; avgTimeSeconds: number }>;
  bottleneck: { step: string; dropOff: number; suggestion: string } | null;
  period: { from: string; to: string };
  totalSessions: number;
  overallConversion: number;
  breakdowns?: Record<string, any>;
  previous?: { steps: any[]; overallConversion: number; totalSessions: number };
}

export interface FunnelSessionsResponse {
  sessions: Array<{
    sessionId: string;
    buyerPhone: string;
    buyerEmail: string;
    buyerName: string;
    stage: "data_collection" | "shipping" | "payment" | "completed";
    lastActivityAt: string;
    abandonmentScore: number;
  }>;
  total: number;
  status: "active" | "all";
}

export function funnelEndpoints(base: string, f: typeof fetch) {
  return {
    async getCheckoutFunnel(
      merchantId: string,
      params: {
        period?: "today" | "7d" | "30d" | "90d";
        breakdown?: "none" | "device" | "buyer_type" | "payment_method";
        compare?: boolean;
      }
    ): Promise<FunnelData> {
      const query = new URLSearchParams();
      if (params.period) query.set("period", params.period);
      if (params.breakdown) query.set("breakdown", params.breakdown);
      if (params.compare) query.set("compare", "true");
      const url = query.toString()
        ? `/checkout/funnel/${encodeURIComponent(merchantId)}?${query}`
        : `/checkout/funnel/${encodeURIComponent(merchantId)}`;
      return dashboardJson<FunnelData>(base, url, { method: "GET" }, f);
    },

    async getStorefrontFunnel(
      merchantId: string,
      params: {
        period?: "today" | "7d" | "30d" | "90d";
        breakdown?: "none" | "device" | "buyer_type" | "payment_method";
        compare?: boolean;
      }
    ): Promise<FunnelData> {
      const query = new URLSearchParams();
      if (params.period) query.set("period", params.period);
      if (params.breakdown) query.set("breakdown", params.breakdown);
      if (params.compare) query.set("compare", "true");
      const url = query.toString()
        ? `/storefront/funnel/${encodeURIComponent(merchantId)}?${query}`
        : `/storefront/funnel/${encodeURIComponent(merchantId)}`;
      return dashboardJson<FunnelData>(base, url, { method: "GET" }, f);
    },

    async getCheckoutFunnelSessions(merchantId: string): Promise<FunnelSessionsResponse> {
      return dashboardJson<FunnelSessionsResponse>(
        base,
        `/checkout/funnel/${encodeURIComponent(merchantId)}/sessions`,
        { method: "GET" },
        f
      );
    },

    async getStorefrontFunnelSessions(merchantId: string): Promise<FunnelSessionsResponse> {
      return dashboardJson<FunnelSessionsResponse>(
        base,
        `/storefront/funnel/${encodeURIComponent(merchantId)}/sessions`,
        { method: "GET" },
        f
      );
    },
  };
}
