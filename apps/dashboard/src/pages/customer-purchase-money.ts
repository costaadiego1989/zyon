export interface CustomerPurchase {
  order_id: string;
  total_minor: number | null;
  completed_at: string;
  currency?: string;
}

/** Both deployed legacy `total` and v1 `total_minor` are already minor units. */
export function normalizeCustomerPurchases(history: unknown): CustomerPurchase[] {
  if (!Array.isArray(history)) return [];
  return history.map(raw => {
    const purchase = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const amount = purchase.total_minor !== undefined ? purchase.total_minor : purchase.total;
    return {
      order_id: typeof purchase.order_id === "string" ? purchase.order_id : "",
      total_minor: typeof amount === "number" && Number.isSafeInteger(amount) && amount >= 0 ? amount : null,
      completed_at: typeof purchase.completed_at === "string" ? purchase.completed_at : "",
      currency: typeof purchase.currency === "string" ? purchase.currency.toUpperCase() : "BRL",
    };
  });
}

export function calculatePurchaseMetrics(history: CustomerPurchase[] | null | undefined): {
  totalOrders: number; totalRevenue: number | null; avgTicket: number | null;
} {
  const purchases = history ?? [];
  // The summary is displayed in BRL; adding currencies or absent amounts would
  // invent a revenue figure. Counts remain available when money cannot be read.
  const readable = purchases.every(p => typeof p.total_minor === "number" &&
    Number.isSafeInteger(p.total_minor) && p.total_minor >= 0 && (!p.currency || p.currency === "BRL"));
  const totalMinor = readable ? purchases.reduce((sum, p) => sum + p.total_minor!, 0) : null;
  const totalRevenue = totalMinor !== null && Number.isSafeInteger(totalMinor) ? totalMinor / 100 : null;
  return {
    totalOrders: purchases.length,
    totalRevenue,
    avgTicket: totalRevenue === null ? null : purchases.length ? totalRevenue / purchases.length : 0,
  };
}

export function formatCustomerPurchaseMoney(purchase: CustomerPurchase): string {
  if (purchase.total_minor === null) return "Valor indisponível";
  try {
    const format = new Intl.NumberFormat("pt-BR", { style: "currency", currency: purchase.currency ?? "BRL" });
    const scale = 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2);
    return format.format(purchase.total_minor / scale);
  } catch { return "Valor indisponível"; }
}
