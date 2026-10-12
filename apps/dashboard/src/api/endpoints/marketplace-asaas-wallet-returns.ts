import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { createSessionFetch } from "../http/session-fetch.js";
import { mergeUrl } from "../http/url.js";

export type AsaasWalletReturnState = "claimed" | "unknown" | "pending" | "returned" | "failed";
export type AsaasWalletReturnJournal = {
  id: string; refund_id: string; payout_id: string; amount_cents: number; currency: "BRL"; request_hash: string;
  status: AsaasWalletReturnState; can_execute: boolean; certificate_hash: string | null;
};
export type AsaasWalletReturnPreview = AsaasWalletReturnJournal | {
  refund_id: string; payout_id: string; amount_cents: number; currency: "BRL"; status: "awaiting_consent"; can_execute: false;
};
export type AsaasWalletReturnEntry = {
  refund_id: string; payout_id: string; return_id: string; created_at: string; host_name: string;
  amount_cents: number; currency: "BRL"; environment: "test" | "live"; payment_method: "pix" | "card";
  journal: AsaasWalletReturnJournal | null;
};
export type AsaasWalletReturnPage = { entries: AsaasWalletReturnEntry[]; next_cursor: string | null };
const root = "/marketplace/dashboard/asaas-wallet-returns";
const id = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(value);
const cents = (value: unknown): value is number => Number.isSafeInteger(value) && Number(value) > 0 && Number(value) <= 2_147_483_647;
const hash = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function journal(value: AsaasWalletReturnJournal): boolean {
  return !!value && id(value.id) && id(value.refund_id) && id(value.payout_id) && cents(value.amount_cents) && value.currency === "BRL" &&
    hash(value.request_hash) && ["claimed", "unknown", "pending", "returned", "failed"].includes(value.status) &&
    typeof value.can_execute === "boolean" && (!value.can_execute || value.status === "claimed") &&
    (value.status === "returned" ? hash(value.certificate_hash) : value.certificate_hash === null);
}
function entry(value: AsaasWalletReturnEntry): boolean {
  return !!value && id(value.refund_id) && id(value.payout_id) && id(value.return_id) &&
    typeof value.created_at === "string" && Number.isFinite(Date.parse(value.created_at)) && cents(value.amount_cents) && value.currency === "BRL" &&
    typeof value.host_name === "string" && value.host_name.trim().length > 0 && value.host_name.length <= 500 &&
    ["test", "live"].includes(value.environment) && ["pix", "card"].includes(value.payment_method) &&
    (value.journal === null || journal(value.journal) && value.journal.refund_id === value.refund_id &&
      value.journal.payout_id === value.payout_id && value.journal.amount_cents === value.amount_cents);
}
function requirePreview(value: AsaasWalletReturnPreview, refundId: string, payoutId: string) {
  if (!value || value.refund_id !== refundId || value.payout_id !== payoutId || !cents(value.amount_cents) || value.currency !== "BRL" ||
    !(value.status === "awaiting_consent" ? value.can_execute === false : journal(value))) throw new Error("invalid_marketplace_wallet_return_response");
  return value;
}
function input(refundId: string, payoutId: string) {
  if (!id(refundId) || !id(payoutId)) throw new Error("invalid_marketplace_wallet_return_identity");
  return `${root}/refunds/${encodeURIComponent(refundId)}/payouts/${encodeURIComponent(payoutId)}`;
}
export function marketplaceAsaasWalletReturnEndpoints(base: string, transport: typeof fetch) {
  const session = createSessionFetch(base, transport);
  // Financial POSTs use the same session transport but never auth/transport
  // retries. A timeout may occur after the durable one-use permit was consumed.
  async function post(path: string, body: unknown) {
    const response = await session(mergeUrl(base, path), { method: "POST", credentials: "include", cache: "no-store",
      redirect: "error", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_wallet_return_unavailable");
    return response.json();
  }
  return {
    async listMarketplaceAsaasWalletReturns(cursor?: string): Promise<AsaasWalletReturnPage> {
      if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,1000}$/.test(cursor)) throw new Error("invalid_marketplace_wallet_return_cursor");
      const value = await dashboardJson<AsaasWalletReturnPage>(base, `${root}?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
        { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) }, transport);
      if (!value || !Array.isArray(value.entries) || value.entries.length > 20 || value.entries.some(row => !entry(row)) ||
        new Set(value.entries.map(row => `${row.refund_id}:${row.payout_id}`)).size !== value.entries.length ||
        value.next_cursor !== null && (typeof value.next_cursor !== "string" || !/^[A-Za-z0-9_-]{1,1000}$/.test(value.next_cursor))) throw new Error("invalid_marketplace_wallet_return_list");
      return value;
    },
    async previewMarketplaceAsaasWalletReturn(refundId: string, payoutId: string): Promise<AsaasWalletReturnPreview> {
      return requirePreview(await dashboardJson(base, input(refundId, payoutId), { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) }, transport), refundId, payoutId);
    },
    async approveMarketplaceAsaasWalletReturn(refundId: string, payoutId: string, amountCents: number): Promise<AsaasWalletReturnJournal> {
      if (!cents(amountCents)) throw new Error("invalid_marketplace_wallet_return_amount");
      const result = requirePreview(await post(`${input(refundId, payoutId)}/approve`, { confirmed: true, expected_amount_cents: amountCents }), refundId, payoutId);
      if (result.status === "awaiting_consent" || result.amount_cents !== amountCents) throw new Error("invalid_marketplace_wallet_return_approval");
      return result;
    },
    async executeMarketplaceAsaasWalletReturn(journalId: string, amountCents: number, requestHash: string): Promise<AsaasWalletReturnJournal> {
      if (!id(journalId) || !cents(amountCents) || !hash(requestHash)) throw new Error("invalid_marketplace_wallet_return_execution");
      const result = await post(`${root}/${encodeURIComponent(journalId)}/execute`, {
        confirmed: true, expected_amount_cents: amountCents, expected_request_hash: requestHash }) as AsaasWalletReturnJournal;
      if (!journal(result) || result.id !== journalId || result.amount_cents !== amountCents || result.request_hash !== requestHash) throw new Error("invalid_marketplace_wallet_return_receipt");
      return result;
    },
    async observeMarketplaceAsaasWalletReturn(journalId: string): Promise<AsaasWalletReturnJournal> {
      if (!id(journalId)) throw new Error("invalid_marketplace_wallet_return_identity");
      const result = await dashboardJson<AsaasWalletReturnJournal>(base, `${root}/${encodeURIComponent(journalId)}`,
        { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) }, transport);
      if (!journal(result) || result.id !== journalId) throw new Error("invalid_marketplace_wallet_return_observation");
      return result;
    },
  };
}
