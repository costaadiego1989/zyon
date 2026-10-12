import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { mergeUrl } from "../http/url.js";

export type CancellationState = "not_requested" | "pending" | "cancelled" | "blocked";
export type CancellationReason = "requested_by_customer" | "abandoned" | "duplicate" | "fraudulent";
export type MarketplacePayment = {
  payment_intent_id: string; amount_cents: number; currency: string; created_at: string;
  status: CancellationState; reason: CancellationReason | null; can_request: boolean;
};
export type CancellationResult = { payment_intent_id: string; status: CancellationState };
export type MarketplacePaymentPage = { payments: MarketplacePayment[]; next_cursor: string | null };
const path = "/marketplace/dashboard/payments";

export function marketplaceCancellationEndpoints(base: string, f: typeof fetch) {
  return {
    async listMarketplacePayments(cursor?: string): Promise<MarketplacePaymentPage> {
      const result = await dashboardJson<MarketplacePaymentPage>(base, `${path}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET" }, f);
      const validId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
      if (!result || !Array.isArray(result.payments) || result.payments.length > 20 ||
          (result.next_cursor !== null && !validId(result.next_cursor)) || result.payments.some(row => !row || !validId(row.payment_intent_id) ||
            !Number.isSafeInteger(row.amount_cents) || row.amount_cents <= 0 || row.currency !== "BRL" || !Number.isFinite(Date.parse(row.created_at)) ||
            !["not_requested", "pending", "cancelled", "blocked"].includes(row.status) || typeof row.can_request !== "boolean" ||
            (row.reason !== null && !["requested_by_customer", "abandoned", "duplicate", "fraudulent"].includes(row.reason)))) throw new Error("invalid_marketplace_payment_response");
      return result;
    },
    getMarketplaceCancellation(id: string): Promise<CancellationResult> {
      return dashboardJson(base, `${path}/${encodeURIComponent(id)}/cancellation`, { method: "GET" }, f);
    },
    async cancelMarketplacePayment(id: string, reason: CancellationReason): Promise<CancellationResult> {
      // Financial submission has no automatic transport retry, including auth refresh.
      // A lost response is resolved by GET; the server journal owns idempotency.
      const response = await f(mergeUrl(base, `${path}/${encodeURIComponent(id)}/cancel`), {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }),
      });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_cancellation_unavailable");
      const result = await response.json() as CancellationResult;
      if (result.payment_intent_id !== id || !["pending", "cancelled", "blocked"].includes(result.status)) throw new Error("invalid_cancellation_response");
      return result;
    },
  };
}
