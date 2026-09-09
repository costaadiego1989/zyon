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

// Linear progression of order statuses. Used to disable backward transitions.
export const STATUS_ORDER: readonly string[] = ["paid", "shipped", "delivered"];

// "cancelled" is terminal and not part of the forward-only chain.
export function isStatusBefore(current: string, candidate: string): boolean {
  const ci = STATUS_ORDER.indexOf(current);
  const vi = STATUS_ORDER.indexOf(candidate);
  if (ci === -1 || vi === -1) return false;
  return vi < ci;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type OrderMetrics = {
  totalOrders: number;
  approvedCount: number;
  approvalRate: number;
  totalRevenue: number;
  trackedCount: number;
  averageOrderValue: number;
};

export type OrderPeriod = "all" | "today" | "7d" | "15d" | "30d";

const DASHBOARD_TIME_ZONE = "America/Sao_Paulo";

function dateKeyInDashboardTimeZone(value: string, timeZone = DASHBOARD_TIME_ZONE): string | null {
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value;
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return year && month && day ? `${year}-${month}-${day}` : null;
}

function subtractCalendarDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day - days)).toISOString().slice(0, 10);
}

export function filterOrdersByPeriod(
  orders: TenantOrder[],
  period: OrderPeriod,
  dateRange: { from: string; to: string },
  now = new Date(),
): TenantOrder[] {
  const today = dateKeyInDashboardTimeZone(now.toISOString());
  if (!today) return [];
  const presetStart = period === "today"
    ? today
    : period === "7d"
      ? subtractCalendarDays(today, 6)
      : period === "15d"
        ? subtractCalendarDays(today, 14)
        : period === "30d"
          ? subtractCalendarDays(today, 29)
          : undefined;
  const start = dateRange.from || presetStart;
  const end = dateRange.to || (period === "all" && !dateRange.from ? undefined : today);

  if (start && end && start > end) return [];
  if (!start && !end) return orders;

  return orders.filter((order) => {
    const dateKey = dateKeyInDashboardTimeZone(order.completed_at ?? order.cancelled_at ?? "");
    return Boolean(dateKey && (!start || dateKey >= start) && (!end || dateKey <= end));
  });
}

// ── Pure utility functions ───────────────────────────────────────────────────

// A paid/realized order contributes to revenue at every lifecycle stage AFTER
// payment — not just the moment it is "approved". An order that moved on to
// shipped/delivered is still paid revenue; counting only `approved` under-reports
// GMV and diverges from the overview read model (which counts all paid orders).
// Excludes only non-realized/reversed states: pending, processing, failed,
// cancelled, refunded, returned.
const PAID_STATUSES = new Set(["approved", "paid", "shipped", "delivered"]);

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

  const paid = orders.filter((o) => PAID_STATUSES.has(o.status));
  const totalRevenue = paid.reduce((sum, o) => sum + o.total, 0);
  const trackedCount = orders.filter((o) => Boolean(o.tracking_code?.trim())).length;

  return {
    totalOrders: orders.length,
    approvedCount: paid.length,
    approvalRate: paid.length / orders.length,
    totalRevenue,
    trackedCount,
    averageOrderValue: paid.length > 0 ? totalRevenue / paid.length : 0,
  };
}

export function filterOrders(
  orders: TenantOrder[],
  status: string,
  query: string,
  startDate?: string,
  endDate?: string,
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

  if (startDate || endDate) {
    filtered = filterOrdersByPeriod(filtered, "all", { from: startDate ?? "", to: endDate ?? "" });
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
