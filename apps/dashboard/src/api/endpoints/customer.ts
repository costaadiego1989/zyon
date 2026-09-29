import { dashboardJson } from "../http/client.js";
import type { TenantCustomer, CursorPage, DashboardOverview, TenantPayment } from "../types.js";
import type { StoreOverview, TimeseriesResponse } from "@zyon/shared-types";

export type CustomerMetricsResponse = {
  total_customers: number;
  new_customers: number;
  returning_customers: number;
  repeat_rate: number;
  period_from: string;
  period_to: string;
};

export function customerEndpoints(base: string, f: typeof fetch) {
  return {
    async getCustomers(limit?: number): Promise<TenantCustomer[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return (
        await dashboardJson<CursorPage<TenantCustomer>>(
          base,
          `/customers${query}`,
          { method: "GET" },
          f,
        )
      ).data;
    },
    async getCustomersPage(limit?: number, cursor?: string): Promise<CursorPage<TenantCustomer>> {
      const params = new URLSearchParams();
      if (limit) params.set("limit", String(limit));
      if (cursor) params.set("cursor", cursor);
      const query = params.toString() ? `?${params.toString()}` : "";
      return dashboardJson<CursorPage<TenantCustomer>>(
        base,
        `/customers${query}`,
        { method: "GET" },
        f,
      );
    },
    getCustomerDetail(customerId: string): Promise<unknown> {
      return dashboardJson(
        base,
        `/customers/${encodeURIComponent(customerId)}`,
        { method: "GET" },
        f,
      );
    },
    async getCustomerMetrics(input: {
      dateFrom: string;
      dateTo: string;
    }): Promise<CustomerMetricsResponse> {
      const params = new URLSearchParams({
        date_from: input.dateFrom,
        date_to: input.dateTo,
      });
      const response = await dashboardJson<CustomerMetricsResponse | { data: CustomerMetricsResponse; meta: unknown }>(
        base,
        `/analytics/customers?${params.toString()}`,
        { method: "GET" },
        f,
      );
      // The public analytics controller wraps its metrics in { data, meta }.
      const metrics = response && typeof response === "object" && "data" in response && "meta" in response
        ? response.data
        : response;
      if (!metrics || typeof metrics !== "object"
        || ![metrics.total_customers, metrics.new_customers, metrics.returning_customers].every(value => Number.isSafeInteger(value) && value >= 0)
        || typeof metrics.repeat_rate !== "number" || !Number.isFinite(metrics.repeat_rate)
        || metrics.repeat_rate < 0 || metrics.repeat_rate > 1) {
        throw new Error("customer_metrics_invalid_response");
      }
      return metrics;
    },
  };
}

export function paymentEndpoints(base: string, f: typeof fetch) {
  return {
    async getPayments(limit?: number): Promise<TenantPayment[]> {
      const query = limit ? `?limit=${encodeURIComponent(String(limit))}` : "";
      return (
        await dashboardJson<CursorPage<TenantPayment>>(
          base,
          `/payments${query}`,
          { method: "GET" },
          f,
        )
      ).data;
    },
    getDashboardOverview(merchantId: string, period: string): Promise<DashboardOverview> {
      return dashboardJson<DashboardOverview>(
        base,
        `/checkout/dashboard/overview/${encodeURIComponent(merchantId)}?period=${encodeURIComponent(period)}`,
        { method: "GET" },
        f,
      );
    },
    getStoreOverview(merchantId: string, period: string): Promise<StoreOverview> {
      return dashboardJson<StoreOverview>(
        base,
        `/checkout/dashboard/store-overview/${encodeURIComponent(merchantId)}?period=${encodeURIComponent(period)}`,
        { method: "GET" },
        f,
      );
    },
    getTimeseries(merchantId: string, period: string): Promise<TimeseriesResponse> {
      return dashboardJson<TimeseriesResponse>(
        base,
        `/checkout/dashboard/overview/timeseries/${encodeURIComponent(merchantId)}?period=${encodeURIComponent(period)}`,
        { method: "GET" },
        f,
      );
    },
  };
}
