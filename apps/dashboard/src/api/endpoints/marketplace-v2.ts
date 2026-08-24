import { dashboardJson } from "../http/client.js";
import type {
  MarketplaceConfig,
  MarketplaceOrder,
  MarketplaceStats,
} from "../../pages/marketplace/types.js";

// ────────────────────────────────────────────────────────────────────────────────

export interface AvailableStore {
  id: string;
  name: string;
  category: string;
  commissionPercent: number;
  logoUrl: string | null;
  connected: boolean;
}

export interface ListAvailableStoresResponse {
  stores: AvailableStore[];
  nextCursor: string | null;
}

// ────────────────────────────────────────────────────────────────────────────────

export interface MarketplaceSettlement {
  id: string;
  orderId: string;
  lineItemId: string;
  totalAmountCents: number;
  commissionCents: number;
  sellerNetCents: number;
  status: SettlementStatus;
  returnWindowUntil: string;
  transferScheduledAt: string | null;
  chargebackWindowUntil: string;
  transferredAt: string | null;
  finalizedAt: string | null;
  chargebackAt: string | null;
  returnAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SettlementStatus =
  | "awaiting_return_window"
  | "transfer_scheduled"
  | "transferred"
  | "finalized"
  | "return_cancelled"
  | "chargeback_cancelled"
  | "chargeback_debt";

export type SettlementEvent =
  | "return_window_expired"
  | "buyer_returned"
  | "transfer_executed"
  | "chargeback_received"
  | "chargeback_window_expired";

export interface SettlementTimelineEntry {
  status: SettlementStatus;
  timestamp: string | null;
  label: string;
}

export interface MarketplaceSellerDebt {
  id: string;
  settlementId: string;
  amountCents: number;
  status: "outstanding" | "deducted" | "resolved";
  deductedFromSettlementId: string | null;
  createdAt: string;
  resolvedAt: string | null;
}

export interface SettlementDetail {
  settlement: MarketplaceSettlement;
  timeline: SettlementTimelineEntry[];
  availableTransitions: SettlementEvent[];
  debt: MarketplaceSellerDebt | null;
}

export interface ListSettlementsResponse {
  settlements: MarketplaceSettlement[];
  total: number;
  limit: number;
  offset: number;
}

// ────────────────────────────────────────────────────────────────────────────────

function mapConfigResponse(raw: any): MarketplaceConfig {
  return {
    id: raw.id ?? "",
    merchant_id: raw.merchant_id ?? "",
    enabled: raw.enabled ?? false,
    commission_percent: raw.commission_rate_bps != null
      ? Math.round(raw.commission_rate_bps / 100)
      : (raw.commission_percent ?? 0),
    return_window_days: raw.return_window_days ?? 14,
    settlement_window_days: raw.payout_delay_days ?? raw.settlement_window_days ?? 14,
    chargeback_window_days: raw.chargeback_window_days ?? 30,
    blocked_merchant_ids: raw.blocked_merchants ?? raw.blocked_merchant_ids ?? [],
    created_at: raw.created_at ?? "",
    updated_at: raw.updated_at ?? "",
  };
}

function mapConfigPayload(payload: Partial<Pick<MarketplaceConfig, "enabled" | "commission_percent" | "return_window_days" | "settlement_window_days" | "chargeback_window_days" | "blocked_merchant_ids">>) {
  const mapped: Record<string, unknown> = {};
  if (payload.enabled != null) mapped.enabled = payload.enabled;
  if (payload.commission_percent != null) mapped.commission_rate_bps = payload.commission_percent * 100;
  if (payload.return_window_days != null) mapped.return_window_days = payload.return_window_days;
  if (payload.settlement_window_days != null) mapped.payout_delay_days = payload.settlement_window_days;
  if (payload.chargeback_window_days != null) mapped.chargeback_window_days = payload.chargeback_window_days;
  if (payload.blocked_merchant_ids != null) mapped.blocked_merchants = payload.blocked_merchant_ids;
  return mapped;
}

export function marketplaceEndpoints(base: string, f: typeof fetch) {
  return {
    async getMarketplaceConfig(): Promise<MarketplaceConfig> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/config", { method: "GET" }, f);
      return mapConfigResponse(raw);
    },

    async updateMarketplaceConfig(
      payload: Partial<Pick<MarketplaceConfig, "enabled" | "commission_percent" | "return_window_days" | "settlement_window_days" | "chargeback_window_days" | "blocked_merchant_ids">>
    ): Promise<MarketplaceConfig> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/config", { method: "PATCH", jsonBody: mapConfigPayload(payload) }, f);
      return mapConfigResponse(raw);
    },

    async getMarketplaceOrders(): Promise<MarketplaceOrder[]> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/orders", { method: "GET" }, f);
      const list = Array.isArray(raw) ? raw : (raw?.orders ?? []);
      return list;
    },

    async getMarketplaceStats(): Promise<MarketplaceStats> {
      const raw = await dashboardJson<any>(base, "/marketplace/dashboard/stats", { method: "GET" }, f);
      return {
        pending_orders: raw.pendingOrders ?? raw.pending_orders ?? 0,
        monthly_revenue: raw.monthlyRevenueCents != null
          ? raw.monthlyRevenueCents / 100
          : (raw.monthly_revenue ?? 0),
        items_shipped: raw.itemsShipped ?? raw.items_shipped ?? 0,
        fulfillment_rate: raw.fulfillmentRate ?? raw.fulfillment_rate ?? 0,
      };
    },

    async getMarketplaceSettlements(filters?: {
      status?: SettlementStatus;
      created_after?: Date;
      created_before?: Date;
      limit?: number;
      offset?: number;
    }): Promise<ListSettlementsResponse> {
      const params = new URLSearchParams();
      if (filters?.status) params.set("status", filters.status);
      if (filters?.created_after) params.set("created_after", filters.created_after.toISOString());
      if (filters?.created_before) params.set("created_before", filters.created_before.toISOString());
      if (filters?.limit) params.set("limit", String(filters.limit));
      if (filters?.offset) params.set("offset", String(filters.offset));

      const url = params.toString() ? `/marketplace/dashboard/settlements?${params}` : "/marketplace/dashboard/settlements";
      return dashboardJson<ListSettlementsResponse>(base, url, { method: "GET" }, f);
    },

    async getMarketplaceSettlementDetail(settlementId: string): Promise<SettlementDetail> {
      return dashboardJson<SettlementDetail>(
        base,
        `/marketplace/dashboard/settlements/${encodeURIComponent(settlementId)}`,
        { method: "GET" },
        f
      );
    },

    async markMarketplaceItemShipped(lineItemId: string, trackingNumber: string): Promise<void> {
      return dashboardJson(
        base,
        `/marketplace/orders/line-items/${encodeURIComponent(lineItemId)}/ship`,
        { method: "POST", jsonBody: { tracking_number: trackingNumber } },
        f
      );
    },

    async markMarketplaceItemDelivered(lineItemId: string): Promise<void> {
      return dashboardJson(
        base,
        `/marketplace/orders/line-items/${encodeURIComponent(lineItemId)}/deliver`,
        { method: "POST" },
        f
      );
    },

    async getMarketplaceDebts(status?: "outstanding" | "deducted" | "resolved"): Promise<{
      debts: MarketplaceSellerDebt[];
      totalOutstandingCents: number;
      totalDeductedCents: number;
      totalResolvedCents: number;
    }> {
      const url = status
        ? `/marketplace/dashboard/debts?status=${status}`
        : "/marketplace/dashboard/debts";
      return dashboardJson(base, url, { method: "GET" }, f);
    },

    async getMarketplaceDebtDetail(debtId: string): Promise<{
      debt: MarketplaceSellerDebt;
      originSettlement: { id: string; orderId: string } | null;
      deductionHistory: Array<{ deductedFromSettlementId: string; deductedAt: string | null }>;
    }> {
      return dashboardJson(
        base,
        `/marketplace/dashboard/debts/${encodeURIComponent(debtId)}`,
        { method: "GET" },
        f
      );
    },

    async getMarketplaceChargebacks(): Promise<{
      chargebacks: Array<{
        settlement: MarketplaceSettlement;
        debt: MarketplaceSellerDebt | null;
        type: "chargeback_cancelled" | "chargeback_debt";
      }>;
      totalDebtCents: number;
      totalCancelled: number;
      totalWithDebt: number;
    }> {
      return dashboardJson(base, "/marketplace/dashboard/chargebacks", { method: "GET" }, f);
    },

    async getMarketplaceEvents(params?: { since?: string }): Promise<{
      events: Array<{
        id: string;
        type: string;
        settlementId: string;
        amountCents: number;
        createdAt: string;
      }>;
    }> {
      const qs = params?.since ? `?since=${encodeURIComponent(params.since)}` : "";
      return dashboardJson(base, `/marketplace/dashboard/events${qs}`, { method: "GET" }, f);
    },

    async listAvailableStores(params?: {
      category?: string;
      search?: string;
      limit?: number;
      cursor?: string;
    }): Promise<ListAvailableStoresResponse> {
      const query = new URLSearchParams();
      if (params?.category) query.set("category", params.category);
      if (params?.search) query.set("search", params.search);
      if (params?.limit) query.set("limit", String(params.limit));
      if (params?.cursor) query.set("cursor", params.cursor);
      const qs = query.toString();
      return dashboardJson(
        base,
        `/marketplace/stores${qs ? `?${qs}` : ""}`,
        { method: "GET" },
        f
      );
    },

    async connectStore(sellerId: string): Promise<{ connected: boolean }> {
      return dashboardJson(
        base,
        `/marketplace/stores/${encodeURIComponent(sellerId)}/connect`,
        { method: "POST", jsonBody: {} },
        f
      );
    },

    async disconnectStore(sellerId: string): Promise<{ connected: boolean }> {
      return dashboardJson(
        base,
        `/marketplace/stores/${encodeURIComponent(sellerId)}/connect`,
        { method: "DELETE" },
        f
      );
    },

    async getMyConnections(): Promise<{
      connections: Array<{ sellerMerchantId: string; createdAt: string }>;
    }> {
      return dashboardJson(base, "/marketplace/stores/my-connections", { method: "GET" }, f);
    },
  };
}
