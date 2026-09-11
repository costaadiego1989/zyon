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

export interface FinanceMerchantPayouts {
  generated_at: string;
  currency: "BRL";
  scope_note: string;
  items: Array<{
    id: string;
    order_id: string | null;
    payment_intent_id: string;
    provider: string;
    status: string;
    amount_brl: number;
    eligible_at: string;
    submitted_at: string | null;
    confirmed_at: string | null;
    provider_transfer_id: string | null;
    failure_code: string | null;
  }>;
}

export interface PaymentAllocationHistory {
  payment_intent_id: string;
  scope_note: string;
  snapshots: Array<{
    sequence: number;
    kind: "planned_allocation" | "provider_observation";
    observation_status?: "confirmed" | "blocked";
    provider: string;
    currency: "BRL";
    occurred_at: string;
    confirmed_at?: string;
    planned: {
      gross_cents: number;
      platform_fee_cents: number;
      merchant_net_cents: number;
      provider_fee_cents: number;
    };
    provider_observed?: {
      gross_cents?: number;
      platform_fee_cents?: number;
      merchant_net_cents?: number;
      provider_fee_cents?: number;
    };
    allocations: Array<{
      key: "platform_fee" | "merchant_payout";
      type: "platform_fee" | "merchant_payout";
      recipient_type: "platform" | "merchant";
      planned_amount_cents: number;
      provider_observed_amount_cents?: number;
      provider_transfer_id?: string;
      provider_reference?: string;
    }>;
  }>;
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
    getMerchantPayouts(): Promise<FinanceMerchantPayouts> {
      return dashboardJson<FinanceMerchantPayouts>(base, "/dashboard/finance/payouts", { method: "GET" }, f);
    },
    getPaymentAllocationHistory(paymentIntentId: string): Promise<PaymentAllocationHistory> {
      return dashboardJson<PaymentAllocationHistory>(base, `/dashboard/finance/payment-intents/${encodeURIComponent(paymentIntentId)}/allocation-history`, { method: "GET" }, f);
    },
    getFinanceCsv(filters: FinanceTransactionsFilters): Promise<Response> {
      return dashboardFetch(base, `/dashboard/finance/export.csv?${queryFor(filters)}`, { method: "GET" }, f);
    },
  };
}
