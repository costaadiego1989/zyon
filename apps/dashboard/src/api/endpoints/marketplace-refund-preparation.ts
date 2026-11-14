import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { mergeUrl } from "../http/url.js";
export type RefundPolicy = "refund" | "retain";
export type RefundPreparationComponents = { commission: RefundPolicy; platformFees: RefundPolicy; hostPlatformFee: RefundPolicy;
  buyerServiceFeeCents: number; shipping: Array<{ merchantId: string; amountCents: number }> };
export type RefundCandidate = { return_id: string; payment_intent_id: string; created_at: string; expected_preparation_hash: string;
  products_amount_cents: number; buyer_service_fee_available_cents: number; buyer_service_fee_refund_cents: number; can_prepare: boolean;
  lines: Array<{ variant_id: string; merchant_id: string; quantity: number; amount_cents: number }>;
  shipping: Array<{ merchant_id: string; merchant_name: string; available_cents: number; refund_cents: number }>;
  required_policy: Pick<RefundPreparationComponents, "commission" | "platformFees" | "hostPlatformFee"> | null };
export type PreparedRefund = { refund_id: string; payment_intent_id: string; return_id: string; amount_cents: number; status: "prepared" | "pending" | "confirmed" | "blocked" };
export type RefundPreparationView = { return_id: string; candidate: RefundCandidate | null; prepared_refund: PreparedRefund | null };
const root = "/marketplace/dashboard/refund-candidates";
const id = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(value);
const cents = (value: unknown) => Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 2_147_483_647;
function validCandidate(row: RefundCandidate) {
  return !!row && id(row.return_id) && id(row.payment_intent_id) && Number.isFinite(Date.parse(row.created_at)) && /^[a-f0-9]{64}$/.test(row.expected_preparation_hash) &&
    cents(row.products_amount_cents) && row.products_amount_cents > 0 && cents(row.buyer_service_fee_available_cents) &&
    cents(row.buyer_service_fee_refund_cents) && row.buyer_service_fee_refund_cents <= row.buyer_service_fee_available_cents && typeof row.can_prepare === "boolean" &&
    Array.isArray(row.lines) && row.lines.length > 0 && row.lines.length <= 100 && row.lines.every(line => id(line.variant_id) && id(line.merchant_id) &&
      cents(line.amount_cents) && Number.isSafeInteger(line.quantity) && line.quantity > 0) && row.lines.reduce((sum, line) => sum + line.amount_cents, 0) === row.products_amount_cents &&
    Array.isArray(row.shipping) && row.shipping.length > 0 && row.shipping.length <= 100 && row.shipping.every(line => id(line.merchant_id) && typeof line.merchant_name === "string" && cents(line.available_cents) && cents(line.refund_cents) && line.refund_cents <= line.available_cents) &&
    new Set(row.shipping.map(line => line.merchant_id)).size === row.shipping.length && row.lines.every(line => row.shipping.some(origin => origin.merchant_id === line.merchant_id)) &&
    (row.required_policy === null || !!row.required_policy && [row.required_policy.commission, row.required_policy.platformFees, row.required_policy.hostPlatformFee].every(v => ["refund", "retain"].includes(v)));
}
function requireView(row: RefundPreparationView, returnId: string) {
  const plan = row?.prepared_refund;
  if (!row || row.return_id !== returnId || (row.candidate === null) === (plan === null) ||
    (row.candidate !== null && (!validCandidate(row.candidate) || row.candidate.return_id !== returnId)) ||
    (plan !== null && (!plan || plan.return_id !== returnId || !id(plan.refund_id) || !id(plan.payment_intent_id) || !cents(plan.amount_cents) || plan.amount_cents <= 0 || !["prepared", "pending", "confirmed", "blocked"].includes(plan.status)))) throw new Error("invalid_marketplace_preparation_response");
  return row;
}
export function marketplaceRefundPreparationEndpoints(base: string, f: typeof fetch) {
  return {
    async listMarketplaceRefundCandidates(cursor?: string): Promise<{ candidates: RefundCandidate[]; next_cursor: string | null }> {
      const value = await dashboardJson<{ candidates: RefundCandidate[]; next_cursor: string | null }>(base, `${root}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`, { method: "GET", cache: "no-store" }, f);
      if (!value || !Array.isArray(value.candidates) || value.candidates.length > 20 || value.candidates.some(row => !validCandidate(row)) || (value.next_cursor !== null && !id(value.next_cursor))) throw new Error("invalid_marketplace_preparation_list");
      return value;
    },
    async getMarketplaceRefundPreparation(returnId: string) {
      return requireView(await dashboardJson(base, `${root}/${encodeURIComponent(returnId)}`, { method: "GET", cache: "no-store" }, f), returnId);
    },
    async prepareMarketplaceRefund(returnId: string, expectedHash: string, components: RefundPreparationComponents) {
      const response = await f(mergeUrl(base, `${root}/${encodeURIComponent(returnId)}/prepare`), { method: "POST", credentials: "include", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true, expected_preparation_hash: expectedHash, components }) });
      if (response.status === 401) window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
      if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_preparation_unavailable");
      const value = requireView(await response.json(), returnId);
      if (!value.prepared_refund) throw new Error("invalid_marketplace_prepared_plan");
      return value;
    },
  };
}
