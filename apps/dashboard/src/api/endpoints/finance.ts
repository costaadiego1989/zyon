import { dashboardFetch, dashboardJson } from "../http/client.js";

export type FinanceTransactionKind = "sale" | "refund";

export interface FinanceFilters {
  from: string;
  to: string;
}

export interface FinanceSummary {
  period: { from: string; to: string; time_zone: string };
  generated_at: string;
  currency: "BRL";
  metrics: {
    completed_orders_gross_brl: number;
    completed_orders: number;
    average_completed_order_value_brl: number;
    refunds_confirmed_brl: number;
  };
  series: Array<{ date: string; completed_orders_gross_brl: number; refunds_brl: number }>;
  payment_methods: Array<{ method: string; completed_orders_gross_brl: number; orders: number }>;
  scope_note: string;
}

export interface FinanceTransaction {
  id: string;
  kind: FinanceTransactionKind;
  occurred_at: string;
  amount_brl: number;
  currency: "BRL";
  order_reference: string;
  payment_method: string | null;
  status: string;
  payment_intent_id: string | null;
}

export interface FinanceTransactionsPage {
  period: { from: string; to: string; time_zone: string };
  generated_at: string;
  currency: "BRL";
  page: number;
  limit: number;
  total: number;
  items: FinanceTransaction[];
}

export interface FinanceTransactionsFilters extends FinanceFilters {
  page?: number;
  limit?: number;
  type?: "all" | FinanceTransactionKind;
  method?: string;
  q?: string;
}

function queryFor(filters: FinanceTransactionsFilters): string {
  const params = new URLSearchParams({ from: filters.from, to: filters.to });
  if (filters.page) params.set("page", String(filters.page));
  if (filters.limit) params.set("limit", String(filters.limit));
  if (filters.type && filters.type !== "all") params.set("type", filters.type);
  if (filters.method) params.set("method", filters.method);
  if (filters.q?.trim()) params.set("q", filters.q.trim());
  return params.toString();
}

export function financeEndpoints(base: string, f: typeof fetch) {
  return {
    getFinanceSummary(filters: FinanceFilters): Promise<FinanceSummary> {
      return dashboardJson<FinanceSummary>(base, `/dashboard/finance/summary?${queryFor(filters)}`, { method: "GET" }, f);
    },
    getFinanceTransactions(filters: FinanceTransactionsFilters): Promise<FinanceTransactionsPage> {
      return dashboardJson<FinanceTransactionsPage>(base, `/dashboard/finance/transactions?${queryFor(filters)}`, { method: "GET" }, f);
    },
    getFinanceCsv(filters: FinanceTransactionsFilters): Promise<Response> {
      return dashboardFetch(base, `/dashboard/finance/export.csv?${queryFor(filters)}`, { method: "GET" }, f);
    },
  };
}
