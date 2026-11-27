import { dashboardJson } from "../http/client.js";
import type { CartRecoveryMetrics } from "./cart-recovery-metrics.js";
export type { CartRecoveryMetrics } from "./cart-recovery-metrics.js";

const PREFIX = "/dashboard/cart-recovery";

export type CartRecoveryStrategyKey =
  | "offer_free_shipping"
  | "personalized_cross_sell"
  | "offer_coupon"
  | "advanced_rule";

export type CartRecoveryStrategyPreferences = Record<CartRecoveryStrategyKey, boolean>;

export interface CartRecoveryStrategyConfig {
  active_strategy: CartRecoveryStrategyKey;
  coupon_code?: string;
  rule_id?: string;
}

export interface CartRecoveryAttempt {
  id: string;
  session_id: string;
  strategy: string;
  status: "pending" | "sent" | "recovered" | "failed" | "expired" | "unknown";
  channel?: "in_session" | "none" | "whatsapp_template" | "email";
  created_at: string;
  sent_at?: string | null;
  customer?: { name: string | null; email: string | null; phone: string | null };
  contact_source?: "send_snapshot" | "current_profile";
  recipient?: string | null;
  delivery_status?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
}

export interface RecoveryMessage {
  id: string; correlation_id: string; channel: string; status: string;
  name: string | null; email: string | null; phone: string | null;
  recipient: string; body: string; subject: string | null; template: string | null;
  provider_message_id: string | null; reason: string | null;
  created_at: string; sent_at: string | null; delivered_at: string | null; read_at: string | null; failed_at: string | null;
}
export interface RecoveryAttemptDetail {
  id: string; session_id: string; status: string; channel: string; strategy: string;
  created_at: string; sent_at: string | null; recovered_at: string | null; recovered_order_id: string | null;
  abandonment_reason: string; last_activity_at: string | null;
  reason: string | null; fallback_reason: string | null; provider_message_id: string | null;
  messages: RecoveryMessage[];
  follow_ups: Array<{ id: string; step: number; due_at: string; sent_at: string | null; status: string; channel: string | null; reason: string | null; fallback_reason: string | null; provider_message_id: string | null }>;
}

export function cartRecoveryEndpoints(base: string, f: typeof fetch) {
  return {
    async getCartRecoveryAttemptPage(limit: number, offset: number, status = "", channel = ""): Promise<{ data: CartRecoveryAttempt[]; total: number }> {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (status) params.set("status", status);
      if (channel) params.set("channel", channel);
      return dashboardJson(base, `${PREFIX}/attempts?${params}`, { method: "GET" }, f);
    },
    async getCartRecoveryAttempt(id: string): Promise<RecoveryAttemptDetail> {
      return dashboardJson(base, `${PREFIX}/attempts/${encodeURIComponent(id)}`, { method: "GET" }, f);
    },
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

    async getCartRecoveryStrategies(): Promise<CartRecoveryStrategyPreferences> {
      const res = await dashboardJson<{ strategies: CartRecoveryStrategyPreferences }>(
        base, `${PREFIX}/strategies`, { method: "GET" }, f
      );
      return res.strategies;
    },

    async patchCartRecoveryStrategies(
      strategies: Partial<CartRecoveryStrategyPreferences>,
    ): Promise<CartRecoveryStrategyPreferences> {
      const res = await dashboardJson<{ strategies: CartRecoveryStrategyPreferences }>(
        base, `${PREFIX}/strategies`, {
          method: "PATCH",
          jsonBody: { strategies },
        }, f
      );
      return res.strategies;
    },

    async getCartRecoveryConfig(): Promise<CartRecoveryStrategyConfig> {
      const res = await dashboardJson<{ config: CartRecoveryStrategyConfig }>(
        base, `${PREFIX}/config`, { method: "GET" }, f
      );
      return res.config;
    },

    async patchCartRecoveryConfig(
      cfg: Partial<CartRecoveryStrategyConfig>,
    ): Promise<CartRecoveryStrategyConfig> {
      const res = await dashboardJson<{ config: CartRecoveryStrategyConfig }>(
        base, `${PREFIX}/config`, {
          method: "PATCH",
          jsonBody: cfg,
        }, f
      );
      return res.config;
    },
  };
}

