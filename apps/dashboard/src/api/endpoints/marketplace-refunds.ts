import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { mergeUrl } from "../http/url.js";

export type RefundState = "prepared" | "pending" | "confirmed" | "blocked";
export type MarketplaceRefund = {
  refund_id: string; payment_intent_id: string; return_id: string; created_at: string;
  amount_cents: number; currency: "BRL"; status: RefundState; can_execute: boolean;
  lines: Array<{ variant_id: string; quantity: number; amount_cents: number }>;
  components: { commission: "refund" | "retain"; platform_fees: "refund" | "retain"; host_platform_fee: "refund" | "retain";
    commission_refund_cents: number; platform_fee_refund_cents: number; host_platform_fee_refund_cents: number;
    buyer_service_fee_cents: number; shipping_cents: number };
};
type RefundPage = { refunds: MarketplaceRefund[]; next_cursor: string | null };
const root = "/marketplace/dashboard/refunds";
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const cents = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;
function valid(row: MarketplaceRefund): boolean {
  const c = row?.components;
  return !!row && id(row.refund_id) && id(row.return_id) && id(row.payment_intent_id) && Number.isFinite(Date.parse(row.created_at)) &&
    cents(row.amount_cents) && row.amount_cents > 0 && row.currency === "BRL" && ["prepared", "pending", "confirmed", "blocked"].includes(row.status) &&
    typeof row.can_execute === "boolean" && (!row.can_execute || row.status === "prepared") &&
    Array.isArray(row.lines) && row.lines.length > 0 && row.lines.length <= 100 && row.lines.every(line => id(line.variant_id) && cents(line.amount_cents) && Number.isSafeInteger(line.quantity) && line.quantity > 0) &&
    !!c && [c.commission, c.platform_fees, c.host_platform_fee].every(value => value === "refund" || value === "retain") &&
    [c.commission_refund_cents, c.platform_fee_refund_cents, c.host_platform_fee_refund_cents, c.buyer_service_fee_cents, c.shipping_cents].every(cents) &&
    row.lines.reduce((sum, line) => sum + line.amount_cents, c.shipping_cents + c.buyer_service_fee_cents) === row.amount_cents;
}
function requireRefund(row: MarketplaceRefund, refundId: string) {
  if (!valid(row) || row.refund_id !== refundId) throw new Error("invalid_marketplace_refund_response");
  return row;
}
export function marketplaceRefundEndpoints(base: string, f: typeof fetch) {
  return {
    async listMarketplaceRefunds(cursor?: string): Promise<RefundPage> {
      const data = await dashboardJson<RefundPage>(base, `${root}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET", cache: "no-store" }, f);
      if (!data || !Array.isArray(data.refunds) || data.refunds.length > 20 || data.refunds.some(row => !valid(row)) || (data.next_cursor !== null && !id(data.next_cursor))) throw new Error("invalid_marketplace_refund_list");
      return data;
    },
    async getMarketplaceRefund(refundId: string): Promise<MarketplaceRefund> {
      return requireRefund(await dashboardJson(base, `${root}/${encodeURIComponent(refundId)}`, { method: "GET", cache: "no-store" }, f), refundId);
    },
    async executeMarketplaceRefund(refundId: string, amountCents: number): Promise<MarketplaceRefund> {
      // Financial command: a lost response never schedules transport/auth-refresh retries.
      const response = await f(mergeUrl(base, `${root}/${encodeURIComponent(refundId)}/execute`), { method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, expected_amount_cents: amountCents }) });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_refund_unavailable");
      const result = requireRefund(await response.json(), refundId);
      if (result.amount_cents !== amountCents || result.status === "prepared") throw new Error("invalid_marketplace_refund_receipt");
      return result;
    },
  };
}
