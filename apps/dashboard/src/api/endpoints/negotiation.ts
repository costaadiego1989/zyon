import { dashboardJson } from "../http/client.js";
import type {
  NegotiationPolicy,
  NegotiationPolicyResponse,
  NegotiationSession,
  NegotiationStats,
  NegotiationEvaluateBridgeResponse,
  CursorPage,
} from "../types.js";

export function negotiationEndpoints(base: string, f: typeof fetch) {
  return {
    getNegotiationPolicy(): Promise<NegotiationPolicyResponse> {
      return dashboardJson(base, "/merchant-negotiation-policy", { method: "GET" }, f);
    },
    putNegotiationPolicy(payload: NegotiationPolicy): Promise<NegotiationPolicyResponse> {
      return dashboardJson(base, "/merchant-negotiation-policy", { method: "PUT", jsonBody: payload }, f);
    },
    getNegotiationSessions(params?: { limit?: number; cursor?: string }): Promise<CursorPage<NegotiationSession>> {
      const query = new URLSearchParams();
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.cursor) query.set("cursor", params.cursor);
      const qs = query.toString();
      return dashboardJson(base, `/negotiations/sessions${qs ? `?${qs}` : ""}`, { method: "GET" }, f);
    },
    getNegotiationStats(period?: string): Promise<NegotiationStats> {
      const qs = period ? `?period=${encodeURIComponent(period)}` : "";
      return dashboardJson(base, `/negotiations/stats${qs}`, { method: "GET" }, f);
    },
    evaluateNegotiation(
      payload: Record<string, unknown>
    ): Promise<NegotiationEvaluateBridgeResponse> {
      return dashboardJson(base, "/negotiations/evaluate", { method: "POST", jsonBody: payload }, f);
    },
  };
}
