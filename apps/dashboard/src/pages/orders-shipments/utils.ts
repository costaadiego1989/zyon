import type { TenantOrder } from "../../api-client.js";

// ── Constants ────────────────────────────────────────────────────────────────

export const STATUS_LABELS: Record<string, string> = {
  approved: "Aprovado",
  cancelled: "Cancelado",
  pending: "Aguardando",
  paid: "Pago",
  shipped: "Em trânsito",
  delivered: "Entregue",
  processing: "Processando",
  failed: "Falhou",
  refunded: "Reembolsado",
  returned: "Devolvido",
};

// ── Types ────────────────────────────────────────────────────────────────────

export type OrderMetrics = {
  totalOrders: number;
  approvedCount: number;
  approvalRate: number;
  totalRevenue: number;
  trackedCount: number;
  averageOrderValue: number;
};

// ── Pure utility functions ───────────────────────────────────────────────────

export function computeOrderMetrics(orders: TenantOrder[]): OrderMetrics {
  if (orders.length === 0) {
    return {
      totalOrders: 0,
      approvedCount: 0,
      approvalRate: 0,
      totalRevenue: 0,
      trackedCount: 0,
      averageOrderValue: 0,
    };
  }

  const approved = orders.filter((o) => o.status === "approved");
  const totalRevenue = approved.reduce((sum, o) => sum + o.total, 0);
  const trackedCount = orders.filter((o) => o.tracking_code !== null).length;

  return {
    totalOrders: orders.length,
    approvedCount: approved.length,
    approvalRate: approved.length / orders.length,
    totalRevenue,
    trackedCount,
    averageOrderValue: approved.length > 0 ? totalRevenue / approved.length : 0,
  };
}

export function filterOrders(
  orders: TenantOrder[],
  status: string,
  query: string,
): TenantOrder[] {
  let filtered = orders;

  if (status !== "all") {
    filtered = filtered.filter((o) => o.status === status);
  }

  if (query.trim()) {
    const q = query.trim().toLowerCase();
    filtered = filtered.filter((o) => {
      if (o.external_order_id.toLowerCase().includes(q)) return true;
      const label = customerLabel(o.customer);
      if (label !== "-" && label.toLowerCase().includes(q)) return true;
      return false;
    });
  }

  return filtered;
}

export function customerLabel(customer: Record<string, unknown> | null): string {
  if (!customer) return "-";
  const name = customer.full_name;
  const email = customer.email;
  return typeof name === "string"
    ? name
    : typeof email === "string"
      ? email
      : "-";
}

const ZERO_DECIMAL_CURRENCIES = new Set([
  "JPY", "KRW", "VND", "IDR", "CLP", "TWD", "BIF", "GNF", "MGA",
  "PYG", "RWF", "UGX", "VUV", "XAF", "XOF", "XPF"
]);

export function formatMinor(value: number, currency: string): string {
  const divisor = ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 1 : 100;
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency,
  }).format(value / divisor);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

export function formatPhone(value: string | null | undefined): string {
  if (!value) return "—";
  const digits = value.replace(/\D/g, "");
  if (digits.length === 11) return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return value;
}
