import { dashboardJson, SESSION_EXPIRED_EVENT } from "../http/client.js";
import { DashboardHttpError } from "../http/error.js";
import { createSessionFetch } from "../http/session-fetch.js";
import { mergeUrl } from "../http/url.js";

export type SellerFeeStatus = "approved" | "creating" | "open" | "paid" | "credited" | "expired" | "unproven";
export type SellerFeeCandidate = {
  kind: "candidate"; debt_id: string; fee_certificate_id: string; environment: "test" | "live";
  due_cents: number; collected_cents: number; outstanding_cents: number; processing_fee_cents: number;
  excess_liability_cents: number; can_prepare: boolean; customer_setup_required: boolean;
  obligation_status: "outstanding" | "fees_collected_excess_held" | "closed";
  obligation_id?: string; obligation_can_close: boolean; funding_hold_released: false; payout_reauthorized: false;
};
export type SellerFeeJournal = {
  kind: "journal"; collection_id: string; debt_id: string; fee_certificate_id: string; environment: "test" | "live";
  status: SellerFeeStatus; gross_amount_cents: number; maximum_credit_cents: number; credited_net_cents: number;
  processing_fee_cents: number; processing_fee_known: boolean; excess_liability_cents: number;
  returned_excess_cents?: number; outstanding_excess_cents?: number;
  excess_status?: "held" | "unknown" | "pending" | "returned" | "failed"; can_return_excess?: boolean;
  checkout_url?: string; request_hash: string; can_execute: boolean; can_cancel: boolean; currency: "BRL";
  funding_hold_released: false; payout_reauthorized: false;
};
export type SellerFeePage<T> = { items: T[]; next_cursor?: string };
export type SellerFeeObligationReceipt = {
  status: "closed"; obligationId: string; debtId: string; replay: boolean; fundingHoldReleased: false; payoutReauthorized: false;
};
export type MarketplaceFeeCollectionFamily = "seller" | "host";
export const sellerFeeIdentity = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
const cents = (v: unknown, zero = false): v is number => Number.isSafeInteger(v) && Number(v) >= (zero ? 0 : 1) && Number(v) <= 2_147_483_647;
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function invalid(): never { throw new Error("invalid_marketplace_seller_fee_receipt"); }
export function sellerFeeHostedUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.length > 8192 || value !== value.trim() || /[\u0000-\u0020\\]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "checkout.stripe.com" && !url.username && !url.password && !url.port &&
      /^\/(?:c\/)?pay\/cs_[A-Za-z0-9_]+$/.test(url.pathname);
  } catch { return false; }
}
function candidate(value: unknown, debtId?: string): SellerFeeCandidate {
  if (!object(value)) invalid();
  const v = value as unknown as SellerFeeCandidate;
  if (v.kind !== "candidate" || !sellerFeeIdentity(v.debt_id) || debtId !== undefined && v.debt_id !== debtId ||
    !sellerFeeIdentity(v.fee_certificate_id) || !["test", "live"].includes(v.environment) ||
    ![v.due_cents, v.collected_cents, v.outstanding_cents, v.processing_fee_cents, v.excess_liability_cents].every(n => cents(n, true)) ||
    v.collected_cents + v.outstanding_cents !== v.due_cents ||
    typeof v.can_prepare !== "boolean" || typeof v.customer_setup_required !== "boolean" || typeof v.obligation_can_close !== "boolean" ||
    !["outstanding", "fees_collected_excess_held", "closed"].includes(v.obligation_status) ||
    v.obligation_id !== undefined && !sellerFeeIdentity(v.obligation_id) || v.funding_hold_released !== false || v.payout_reauthorized !== false ||
    v.can_prepare && (v.customer_setup_required || v.outstanding_cents === 0 || v.obligation_status !== "outstanding") ||
    v.obligation_can_close && (v.outstanding_cents !== 0 || v.excess_liability_cents !== 0 || v.obligation_status !== "outstanding") ||
    v.obligation_status === "fees_collected_excess_held" && (v.outstanding_cents !== 0 || v.excess_liability_cents < 1) ||
    v.obligation_status === "closed" && (v.outstanding_cents !== 0 || v.excess_liability_cents !== 0 || !v.obligation_id) ||
    v.due_cents === 0 && (v.can_prepare || v.customer_setup_required || v.processing_fee_cents !== 0 || v.excess_liability_cents !== 0 ||
      !/^mdebt_extinction_[a-f0-9]{64}$/.test(v.fee_certificate_id) ||
      v.obligation_id !== undefined && !/^mseller_obligation_[a-f0-9]{64}$/.test(v.obligation_id))) invalid();
  // Copy the public contract only; provider/customer proof and extra payloads
  // never enter React state or browser persistence.
  return { kind: "candidate", debt_id: v.debt_id, fee_certificate_id: v.fee_certificate_id, environment: v.environment,
    due_cents: v.due_cents, collected_cents: v.collected_cents, outstanding_cents: v.outstanding_cents,
    processing_fee_cents: v.processing_fee_cents, excess_liability_cents: v.excess_liability_cents,
    can_prepare: v.can_prepare, customer_setup_required: v.customer_setup_required, obligation_status: v.obligation_status,
    ...(v.obligation_id ? { obligation_id: v.obligation_id } : {}), obligation_can_close: v.obligation_can_close,
    funding_hold_released: false, payout_reauthorized: false };
}
function journal(value: unknown, id?: string, debtId?: string, gross?: number): SellerFeeJournal {
  if (!object(value)) invalid();
  const v = value as unknown as SellerFeeJournal;
  const hasExcessReturn = v.returned_excess_cents !== undefined || v.outstanding_excess_cents !== undefined || v.can_return_excess !== undefined;
  const returned = v.returned_excess_cents === undefined ? 0 : v.returned_excess_cents;
  const outstanding = v.outstanding_excess_cents === undefined ? v.excess_liability_cents : v.outstanding_excess_cents;
  if (v.kind !== undefined && v.kind !== "journal" || !sellerFeeIdentity(v.collection_id) || id !== undefined && v.collection_id !== id ||
    !sellerFeeIdentity(v.debt_id) || debtId !== undefined && v.debt_id !== debtId || !sellerFeeIdentity(v.fee_certificate_id) ||
    !["test", "live"].includes(v.environment) || !["approved", "creating", "open", "paid", "credited", "expired", "unproven"].includes(v.status) ||
    !cents(v.gross_amount_cents) || gross !== undefined && v.gross_amount_cents !== gross || !cents(v.maximum_credit_cents) ||
    ![v.credited_net_cents, v.processing_fee_cents, v.excess_liability_cents].every(n => cents(n, true)) ||
    typeof v.processing_fee_known !== "boolean" || v.status === "credited" && !v.processing_fee_known ||
    v.processing_fee_known && v.status !== "credited" && v.status !== "paid" ||
    typeof v.request_hash !== "string" || !/^[a-f0-9]{64}$/.test(v.request_hash) || v.currency !== "BRL" ||
    typeof v.can_execute !== "boolean" || v.can_execute && (v.status !== "approved" || v.gross_amount_cents < 50) || v.can_cancel !== (v.status === "approved") ||
    v.funding_hold_released !== false || v.payout_reauthorized !== false ||
    v.checkout_url !== undefined && (v.status !== "open" || !sellerFeeHostedUrl(v.checkout_url)) ||
    v.excess_status !== undefined && !["held", "unknown", "pending", "returned", "failed"].includes(v.excess_status) ||
    hasExcessReturn && (!cents(v.returned_excess_cents, true) || !cents(v.outstanding_excess_cents, true) || typeof v.can_return_excess !== "boolean") ||
    returned + outstanding !== v.excess_liability_cents ||
    v.can_return_excess && (v.status !== "credited" || v.excess_status !== "held" || returned !== 0 || outstanding < 1) ||
    v.excess_status === "returned" && (v.status !== "credited" || outstanding !== 0 || returned !== v.excess_liability_cents) ||
    v.excess_status !== "returned" && returned !== 0 ||
    ["unknown", "pending", "failed"].includes(v.excess_status ?? "") && v.status !== "credited") invalid();
  if (v.processing_fee_known) {
    const net = v.gross_amount_cents - v.processing_fee_cents;
    if (net < 1 || v.credited_net_cents !== Math.min(net, v.maximum_credit_cents) ||
      v.excess_liability_cents !== Math.max(net - v.maximum_credit_cents, 0) ||
      (v.excess_liability_cents > 0) !== (v.excess_status !== undefined)) invalid();
  } else if (v.credited_net_cents !== 0 || v.processing_fee_cents !== 0 || v.excess_liability_cents !== 0 || v.excess_status !== undefined) invalid();
  return { kind: "journal", collection_id: v.collection_id, debt_id: v.debt_id, fee_certificate_id: v.fee_certificate_id,
    environment: v.environment, status: v.status, gross_amount_cents: v.gross_amount_cents, maximum_credit_cents: v.maximum_credit_cents,
    credited_net_cents: v.credited_net_cents, processing_fee_cents: v.processing_fee_cents, processing_fee_known: v.processing_fee_known,
    excess_liability_cents: v.excess_liability_cents, ...(v.excess_status ? { excess_status: v.excess_status } : {}),
    ...(hasExcessReturn ? { returned_excess_cents: returned, outstanding_excess_cents: outstanding, can_return_excess: v.can_return_excess } : {}),
    ...(v.checkout_url ? { checkout_url: v.checkout_url } : {}), request_hash: v.request_hash, can_execute: v.can_execute, can_cancel: v.can_cancel,
    currency: "BRL", funding_hold_released: false, payout_reauthorized: false };
}
export function assertSameSellerFeeJournal(before: SellerFeeJournal, after: SellerFeeJournal): void {
  for (const k of ["collection_id", "debt_id", "fee_certificate_id", "environment", "gross_amount_cents", "maximum_credit_cents", "request_hash"] as const)
    if (before[k] !== after[k]) invalid();
  if (before.processing_fee_known) {
    if (!after.processing_fee_known) invalid();
    for (const k of ["credited_net_cents", "processing_fee_cents", "excess_liability_cents"] as const)
      if (before[k] !== after[k]) invalid();
  }
}
function requireCursor(cursor?: string): void {
  if (cursor !== undefined && !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor)) throw new Error("invalid_marketplace_seller_fee_cursor");
}
function page<T>(value: unknown, parse: (v: unknown) => T, identity: (v: T) => string): SellerFeePage<T> {
  if (!object(value) || !Array.isArray(value.items) || value.items.length > 20) invalid();
  const items = value.items.map(parse); const cursor = value.next_cursor;
  if (cursor !== undefined && (typeof cursor !== "string" || !/^[A-Za-z0-9_-]{1,1024}$/.test(cursor))) invalid();
  if (new Set(items.map(identity)).size !== items.length) invalid();
  return { items, ...(cursor ? { next_cursor: cursor as string } : {}) };
}
export function marketplaceFeeCollectionEndpoints(base: string, transport: typeof fetch, family: MarketplaceFeeCollectionFamily) {
  if (family !== "seller" && family !== "host") throw new Error("invalid_marketplace_fee_family");
  const root = `/marketplace/dashboard/${family}-fee-collections`;
  const minimum = 50;
  const parseCandidate = (v: unknown, debtId?: string) => {
    const result = candidate(v, debtId);
    if (family === "host" && (result.due_cents < 1 || !/^mhost_extinction_[a-f0-9]{64}$/.test(result.fee_certificate_id) ||
      result.obligation_id !== undefined && !/^mhost_obligation_[a-f0-9]{64}$/.test(result.obligation_id))) invalid();
    return result;
  };
  const parseJournal = (v: unknown, id?: string, debtId?: string, gross?: number) => {
    const result = journal(v, id, debtId, gross);
    // Legacy seller journals remain readable and cancelable below the current
    // Checkout minimum; only prospective prepare/execute commands require it.
    if (family === "host" && (result.gross_amount_cents < minimum || !/^mhost_extinction_[a-f0-9]{64}$/.test(result.fee_certificate_id))) invalid();
    return result;
  };
  const session = createSessionFetch(base, transport);
  const path = (id: string) => { if (!sellerFeeIdentity(id)) throw new Error("invalid_marketplace_seller_fee_identity"); return `${root}/${encodeURIComponent(id)}`; };
  const get = (url: string) => dashboardJson<unknown>(base, url, { method: "GET", cache: "no-store", signal: AbortSignal.timeout(20_000) }, transport);
  async function post(url: string, body: unknown): Promise<unknown> {
    // One transport call. Financial commands must never enter the generic
    // authentication refresh/replay path after an unknown response.
    const response = await session(mergeUrl(base, url), { method: "POST", credentials: "include", cache: "no-store", redirect: "error",
      signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (response.status === 401 && typeof window !== "undefined") window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    if (!response.ok) throw new DashboardHttpError(response.status, "marketplace_seller_fee_unavailable");
    return response.json();
  }
  return {
    async candidatesMarketplaceSellerFeeCollections(cursor?: string): Promise<SellerFeePage<SellerFeeCandidate>> {
      requireCursor(cursor); return page(await get(`${root}/candidates?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
        v => parseCandidate(v), v => v.debt_id);
    },
    async contextMarketplaceSellerFeeCollection(debtId: string): Promise<SellerFeeCandidate> {
      path(debtId); return parseCandidate(await get(`${root}/hosted-context/${encodeURIComponent(debtId)}`), debtId);
    },
    async listMarketplaceSellerFeeCollections(debtId: string, cursor?: string): Promise<SellerFeePage<SellerFeeJournal>> {
      path(debtId); requireCursor(cursor); return page(await get(`${root}?debt_id=${encodeURIComponent(debtId)}&limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`),
        v => parseJournal(v, undefined, debtId), v => v.collection_id);
    },
    async getMarketplaceSellerFeeCollection(id: string): Promise<SellerFeeJournal> { return parseJournal(await get(path(id)), id); },
    async prepareMarketplaceSellerFeeCollection(debtId: string, id: string, gross: number): Promise<SellerFeeJournal> {
      path(debtId); path(id); if (!cents(gross) || gross < minimum) throw new Error("invalid_marketplace_seller_fee_amount");
      return parseJournal(await post(`${root}/hosted`, { debt_id: debtId, collection_id: id, gross_amount_cents: gross, confirmed: true }), id, debtId, gross);
    },
    async executeMarketplaceSellerFeeCollection(id: string, gross: number): Promise<SellerFeeJournal> {
      if (!cents(gross) || gross < minimum) throw new Error("invalid_marketplace_seller_fee_amount");
      return parseJournal(await post(`${path(id)}/execute`, { gross_amount_cents: gross, confirmed: true }), id, undefined, gross);
    },
    async reconcileMarketplaceSellerFeeCollection(id: string): Promise<SellerFeeJournal> { return parseJournal(await post(`${path(id)}/reconcile`, { confirmed: true }), id); },
    async returnMarketplaceSellerFeeExcess(id: string, amount: number): Promise<SellerFeeJournal> {
      if (!cents(amount)) throw new Error("invalid_marketplace_seller_fee_amount");
      const result = parseJournal(await post(`${path(id)}/excess/return`, { amount_cents: amount, confirmed: true }), id);
      if (result.status !== "credited" || result.excess_liability_cents !== amount ||
        result.can_return_excess !== false || !["unknown", "pending", "returned", "failed"].includes(result.excess_status ?? "")) invalid();
      return result;
    },
    async cancelMarketplaceSellerFeeCollection(id: string): Promise<SellerFeeJournal> {
      const result = parseJournal(await post(`${path(id)}/cancel`, { confirmed: true }), id);
      if (result.status !== "expired") invalid(); return result;
    },
    async closeMarketplaceSellerFeeObligation(debtId: string): Promise<SellerFeeObligationReceipt> {
      path(debtId); const v = await post(`${root}/obligations/${encodeURIComponent(debtId)}/close`, { confirmed: true });
      if (!object(v) || v.status !== "closed" || !sellerFeeIdentity(v.obligationId) || v.debtId !== debtId || typeof v.replay !== "boolean" ||
        v.fundingHoldReleased !== false || v.payoutReauthorized !== false ||
        family === "host" && !/^mhost_obligation_[a-f0-9]{64}$/.test(v.obligationId)) invalid();
      return { status: "closed", obligationId: v.obligationId, debtId, replay: v.replay, fundingHoldReleased: false, payoutReauthorized: false };
    },
  };
}
export function marketplaceSellerFeeCollectionEndpoints(base: string, transport: typeof fetch) {
  return marketplaceFeeCollectionEndpoints(base, transport, "seller");
}
