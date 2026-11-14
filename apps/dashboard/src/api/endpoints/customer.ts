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
    getCustomerMetrics(input: {
      dateFrom: string;
      dateTo: string;
    }): Promise<CustomerMetricsResponse> {
      const params = new URLSearchParams({
        date_from: input.dateFrom,
        date_to: input.dateTo,
      });
      return dashboardJson<CustomerMetricsResponse>(
        base,
        `/analytics/customers?${params.toString()}`,
        { method: "GET" },
        f,
      );
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
