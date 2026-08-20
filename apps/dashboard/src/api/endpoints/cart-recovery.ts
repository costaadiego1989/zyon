import { dashboardJson } from "../http/client.js";

const PREFIX = "/dashboard/cart-recovery";

export interface CartRecoveryMetrics {
  total_abandoned: number;
  total_attempts: number;
  total_recovered: number;
  recovery_rate_percent: number;
  revenue_recovered_brl: number;
}

export interface CartRecoveryStrategy {
  tier: "free_shipping" | "escalate_discount" | "cross_sell" | "address_objection" | "wait";
  enabled: boolean;
}

export interface CartRecoveryAttempt {
  id: string;
  session_id: string;
  strategy: string;
  status: "pending" | "sent" | "recovered" | "failed";
  created_at: string;
}

export function cartRecoveryEndpoints(base: string, f: typeof fetch) {
  return {
    async getCartRecoveryMetrics(): Promise<CartRecoveryMetrics> {
      return dashboardJson<CartRecoveryMetrics>(base, `${PREFIX}/metrics`, { method: "GET" }, f);
    },

    async getCartRecoveryAttempts(limit?: number, offset?: number): Promise<CartRecoveryAttempt[]> {
      const params = new URLSearchParams();
      if (limit) params.append("limit", limit.toString());
      if (offset) params.append("offset", offset.toString());
      const query = params.toString();
      const path = query ? `${PREFIX}/attempts?${query}` : `${PREFIX}/attempts`;
      const res = await dashboardJson<{ data: CartRecoveryAttempt[] } | CartRecoveryAttempt[]>(
        base, path, { method: "GET" }, f
      );
      return Array.isArray(res) ? res : res.data;
    },
  };
}
