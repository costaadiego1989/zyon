import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { createSessionFetch } from "../http/session-fetch.js";
import { mergeUrl } from "../http/url.js";

export type ContributionCheckoutStatus = "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
export type ContributionCandidate = { kind: "candidate"; refund_plan_id: string; environment: "test" | "live";
  required_net_cents: number; outstanding_net_cents: number; customer_setup_required: boolean; can_create: boolean; block_reason?: string };
export type ContributionCheckoutJournal = { kind: "journal"; contribution_id: string; refund_plan_id: string; environment: "test" | "live";
  status: ContributionCheckoutStatus; gross_amount_cents: number; maximum_credit_cents: number; credited_net_cents: number;
  processing_fee_cents: number; excess_liability_cents: number; returned_excess_cents: number;
  excess_status?: "held" | "unknown" | "pending" | "returned" | "failed"; checkout_url?: string; request_hash: string;
  can_create: false; can_cancel: boolean; can_return_excess: boolean; currency: "BRL"; collection_mode: "hosted_checkout"; processing_fee_known: boolean };
export type ContributionCheckoutItem = ContributionCandidate | ContributionCheckoutJournal;
export type ContributionCheckoutPage = { items: ContributionCheckoutItem[]; next_cursor?: string };
const root = "/marketplace/dashboard/contribution-checkouts";
export const contributionIdentity = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const cents = (v: unknown, zero = false): v is number => Number.isSafeInteger(v) && Number(v) >= (zero ? 0 : 1) && Number(v) <= 2_147_483_647;
export function contributionHostedUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192) return false;
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password && !url.port; }
  catch { return false; }
}
function candidate(v: ContributionCandidate): boolean {
  return !!v && v.kind === "candidate" && contributionIdentity(v.refund_plan_id) && ["test", "live"].includes(v.environment) &&
    cents(v.required_net_cents) && cents(v.outstanding_net_cents, true) && v.outstanding_net_cents <= v.required_net_cents &&
    typeof v.customer_setup_required === "boolean" && typeof v.can_create === "boolean" &&
    (!v.can_create || !v.customer_setup_required && v.outstanding_net_cents > 0 && !v.block_reason) &&
    (v.block_reason === undefined || typeof v.block_reason === "string" && /^[a-z_]{1,200}$/.test(v.block_reason));
}
function journal(v: ContributionCheckoutJournal): boolean {
  if (!v || v.kind !== "journal" || !contributionIdentity(v.contribution_id) || !contributionIdentity(v.refund_plan_id) ||
    !["test", "live"].includes(v.environment) || !["approved", "creating", "open", "paid", "credited", "expired", "unproven"].includes(v.status) ||
    !cents(v.gross_amount_cents) || !cents(v.maximum_credit_cents) || !cents(v.credited_net_cents, true) || !cents(v.processing_fee_cents, true) ||
    !cents(v.excess_liability_cents, true) || !cents(v.returned_excess_cents, true) || v.currency !== "BRL" || v.collection_mode !== "hosted_checkout" ||
    typeof v.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(v.request_hash) || v.can_create !== false ||
    v.can_cancel !== (v.status === "approved") || typeof v.can_return_excess !== "boolean" || typeof v.processing_fee_known !== "boolean" ||
    v.status === "credited" && !v.processing_fee_known || v.processing_fee_known && v.status !== "credited" && v.status !== "paid" ||
    v.excess_status !== undefined && !["held", "unknown", "pending", "returned", "failed"].includes(v.excess_status) ||
    v.checkout_url !== undefined && (v.status !== "open" || !contributionHostedUrl(v.checkout_url))) return false;
  if (v.processing_fee_known) return v.credited_net_cents > 0 && v.credited_net_cents <= v.maximum_credit_cents &&
    v.credited_net_cents + v.processing_fee_cents + v.excess_liability_cents === v.gross_amount_cents &&
    v.returned_excess_cents <= v.excess_liability_cents && (!v.can_return_excess || v.status === "credited" && v.excess_liability_cents > 0 && v.excess_status === "held");
  return v.credited_net_cents === 0 && v.processing_fee_cents === 0 && v.excess_liability_cents === 0 && v.returned_excess_cents === 0 &&
    !v.can_return_excess && v.excess_status === undefined;
}
function requireJournal(value: ContributionCheckoutJournal, id: string, refundId?: string, gross?: number) {
  if (!journal(value) || value.contribution_id !== id || refundId !== undefined && value.refund_plan_id !== refundId ||
    gross !== undefined && value.gross_amount_cents !== gross) throw new Error("invalid_marketplace_contribution_receipt");
  return value;
}
export function marketplaceContributionCheckoutEndpoints(base: string, transport: typeof fetch) {
  const session = createSessionFetch(base, transport);
  function path(id: string) { if (!contributionIdentity(id)) throw new Error("invalid_marketplace_contribution_identity"); return `${root}/${encodeURIComponent(id)}`; }
  async function get<T>(url: string): Promise<T> { return dashboardJson(base, url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) }, transport); }
  // Every command is explicit and uses the existing bearer session. None may
  // refresh authentication or replay a financial POST after an unknown result.
  async function post(url: string, body: unknown): Promise<ContributionCheckoutJournal> {
    const response = await session(mergeUrl(base, url), { method: "POST", credentials: "include", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_contribution_unavailable");
    return response.json();
  }
  return {
    async listMarketplaceContributionCheckouts(cursor?: string): Promise<ContributionCheckoutPage> {
      if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error("invalid_marketplace_contribution_cursor");
      const result = await get<ContributionCheckoutPage>(`${root}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!result || !Array.isArray(result.items) || result.items.length > 20 || result.items.some(v => v.kind === "candidate" ? !candidate(v) : !journal(v)) ||
        new Set(result.items.map(v => v.kind === "candidate" ? `r:${v.refund_plan_id}` : `c:${v.contribution_id}`)).size !== result.items.length ||
        result.next_cursor !== undefined && (typeof result.next_cursor !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(result.next_cursor))) throw new Error("invalid_marketplace_contribution_list");
      return result;
    },
    async contextMarketplaceContributionCheckout(refundId: string): Promise<ContributionCandidate> {
      if (!contributionIdentity(refundId)) throw new Error("invalid_marketplace_contribution_identity");
      const result = await get<ContributionCandidate>(`${root}/context/${encodeURIComponent(refundId)}`);
      if (!candidate(result) || result.refund_plan_id !== refundId) throw new Error("invalid_marketplace_contribution_context"); return result;
    },
    async getMarketplaceContributionCheckout(id: string): Promise<ContributionCheckoutJournal> { return requireJournal(await get(path(id)), id); },
    async prepareMarketplaceContributionCheckout(refundId: string, id: string, gross: number): Promise<ContributionCheckoutJournal> {
      path(id); if (!contributionIdentity(refundId) || !cents(gross)) throw new Error("invalid_marketplace_contribution_approval");
      return requireJournal(await post(root, { refund_plan_id: refundId, contribution_id: id, gross_amount_cents: gross, confirmed: true }), id, refundId, gross);
    },
    async executeMarketplaceContributionCheckout(id: string, gross: number): Promise<ContributionCheckoutJournal> {
      if (!cents(gross)) throw new Error("invalid_marketplace_contribution_amount");
      return requireJournal(await post(`${path(id)}/execute`, { gross_amount_cents: gross, confirmed: true }), id, undefined, gross);
    },
    async reconcileMarketplaceContributionCheckout(id: string): Promise<ContributionCheckoutJournal> {
      return requireJournal(await post(`${path(id)}/reconcile`, { confirmed: true }), id);
    },
    async cancelMarketplaceContributionCheckout(id: string): Promise<ContributionCheckoutJournal> {
      const result = requireJournal(await post(`${path(id)}/cancel`, { confirmed: true }), id);
      if (result.status !== "expired") throw new Error("invalid_marketplace_contribution_cancellation"); return result;
    },
    async returnMarketplaceContributionExcess(id: string, amount: number): Promise<ContributionCheckoutJournal> {
      if (!cents(amount)) throw new Error("invalid_marketplace_contribution_amount");
      const result = requireJournal(await post(`${path(id)}/return-excess`, { amount_cents: amount, confirmed: true }), id);
      if (result.excess_liability_cents !== amount || result.status !== "credited") throw new Error("invalid_marketplace_contribution_excess_receipt"); return result;
    },
  };
}
