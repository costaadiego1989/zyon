import type { MelhorEnvioTokenResolver } from "../../domain/ports/melhor-envio-token-resolver.port.js";
import type { MarketplaceShipmentCarrier } from "../../domain/ports/marketplace-shipment-carrier.port.js";
import { decimalCents, marketplaceShipmentVolume, marketplaceShipmentProviderTime as providerTime, assertMarketplaceShipmentPurchaseReceipt,
  assertMarketplaceShipmentGenerationReceipt, marketplaceShipmentPrivatePrintUrl, type MarketplaceShipmentRequest,
  type MarketplaceShipmentPurchaseReceipt, type MarketplaceShipmentStageEvidence, type MarketplaceShipmentGenerationReceipt,
  assertMarketplaceShipmentCancellationReceipt, marketplaceShipmentCancellationDescription,
  type MarketplaceShipmentCancellationReason, type MarketplaceShipmentCancellationEvidence,
  type MarketplaceShipmentTrackingEvidence, type MarketplaceShipmentFinancialIssue } from "../../domain/marketplace-shipment-journal.js";
import { marketplaceShippingContractHash as hash } from "../../domain/marketplace-shipping-contract.js";
import { melhorEnvioBaseUrl, MELHOR_ENVIO_USER_AGENT } from "../melhor-envio-config.js";
import { assertMarketplaceShippingAccountIdentity } from "../../domain/marketplace-shipping-account-identity.js";
import { readMelhorEnvioAccountIdentity } from "./melhor-envio-account-identity.js";
import { marketplaceMelhorEnvioCartAdmitsPurchase } from "../../domain/marketplace-melhor-envio-purchase-admission.js";

const uuid = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const statuses = new Set(["pending", "released", "posted", "delivered", "canceled", "expired", "undelivered", "suspended"]);
const canonicalRows = (rows: unknown[]) => rows.map(row => hash(row)).sort();

/** Explicit cart/checkout/generation mutations run once under durable claims.
 * Reconciliation only reads the existing order; no uncertain POST is retried. */
export class MarketplaceMelhorEnvioAdapter implements MarketplaceShipmentCarrier {
  constructor(private readonly tokens: MelhorEnvioTokenResolver, private readonly transport: typeof fetch = fetch) {}

  private async auth(request: MarketplaceShipmentRequest) {
    marketplaceShipmentVolume(request);
    if (![1, 2, 17].includes(request.body.service) || request.body.volumes.length !== 1) throw Error("marketplace_shipment_service_not_supported");
    const base = melhorEnvioBaseUrl(), expected = request.environment === "test" ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    if (base !== expected) throw Error("marketplace_shipment_environment_changed");
    const token = await this.tokens.resolveToken(request.originMerchantId, { allowPlatformFallback: false });
    if (!token) throw Error("marketplace_shipment_account_changed");
    if (request.accountIdentity !== undefined) {
      const original = assertMarketplaceShippingAccountIdentity(request.accountIdentity, { environment: request.environment,
        originMerchantId: request.originMerchantId, accountFingerprint: request.accountFingerprint });
      const current = await readMelhorEnvioAccountIdentity({ base, token, originMerchantId: request.originMerchantId }, this.transport);
      if (hash(current) !== hash(original)) throw Error("marketplace_shipment_account_changed");
    } else {
      // Legacy quotes never observed a native owner. A new token cannot supply
      // the missing historical identity or silently rewrite their journal.
      if (hash(["melhor-envio", base, token]) !== request.accountFingerprint) throw Error("marketplace_shipment_account_changed");
    }
    return { base, headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json", "User-Agent": MELHOR_ENVIO_USER_AGENT } };
  }

  async createCart(request: MarketplaceShipmentRequest) {
    let auth: Awaited<ReturnType<MarketplaceMelhorEnvioAdapter["auth"]>>;
    try { auth = await this.auth(request); }
    catch { return { status: "unknown" as const, notSubmitted: true, observedAt: new Date(), reason: "carrier_account_unavailable" }; }
    try {
      const response = await this.transport(`${auth.base}/api/v2/me/cart`, { method: "POST", headers: auth.headers,
        body: JSON.stringify(request.body), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return { status: "unknown" as const, observedAt: new Date(), reason: "carrier_cart_unproven" };
      const result = await response.json() as Record<string, unknown>;
      // A create response is only a receipt pointer. Confirmation requires GET.
      return { status: "unknown" as const, observedAt: new Date(), ...(uuid(result?.id) ? { carrierOrderId: result.id } : {}), reason: "carrier_cart_requires_reconciliation" };
    } catch { return { status: "unknown" as const, observedAt: new Date(), reason: "carrier_cart_unproven" }; }
  }

  async reconcileCart(request: MarketplaceShipmentRequest, carrierOrderId: string) {
    const unknown = () => ({ status: "unknown" as const, observedAt: new Date(), reason: "carrier_cart_unproven" });
    if (!uuid(carrierOrderId)) return unknown();
    try {
      const auth = await this.auth(request);
      const response = await this.transport(`${auth.base}/api/v2/me/cart/${encodeURIComponent(carrierOrderId)}`, {
        method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return unknown();
      const row = await response.json() as Record<string, any>;
      if (!sameOrder(row, request, carrierOrderId) || !marketplaceMelhorEnvioCartAdmitsPurchase(row)) return unknown();
      return { status: "cart_created" as const, carrierOrderId, observedAt: new Date() };
    } catch { return unknown(); }
  }

  async purchase(request: MarketplaceShipmentRequest, carrierOrderId: string): Promise<MarketplaceShipmentStageEvidence & { notSubmitted?: boolean }> {
    const unknown = (reason: string, notSubmitted = false) => ({ status: "unknown" as const, carrierOrderId, observedAt: new Date(), reason,
      ...(notSubmitted ? { notSubmitted: true } : {}) });
    let auth: Awaited<ReturnType<MarketplaceMelhorEnvioAdapter["auth"]>>;
    try {
      auth = await this.auth(request);
      // Recheck the carrier price and original shipment immediately before debit.
      if ((await this.reconcileCart(request, carrierOrderId)).status !== "cart_created") return unknown("carrier_purchase_preflight_unproven", true);
      // Resolve again after preflight so a rotated account cannot use its proof.
      auth = await this.auth(request);
    } catch { return unknown("carrier_account_unavailable", true); }
    try {
      const response = await this.transport(`${auth.base}/api/v2/me/shipment/checkout`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ orders: [carrierOrderId] }), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return unknown("carrier_purchase_unproven");
      const payload = await response.json() as Record<string, any>, purchase = payload?.purchase;
      // Wallet-only: no payment link, alternate gateway, batch purchase or mixed
      // transactions can silently introduce another source of money or fee.
      if (!purchase || !uuid(purchase.id) || purchase.status !== "paid" || purchase.canceled_at !== null ||
          !providerTime(purchase.paid_at) || decimalCents(purchase.total) !== request.amountCents || purchase.payment !== null ||
          [payload.redirect, payload.payment_id, payload.digitable].some(v => v !== null && v !== undefined) ||
          !Array.isArray(purchase.orders) || purchase.orders.length !== 1 || purchase.orders[0]?.id !== carrierOrderId ||
          purchase.orders[0]?.paid_at !== purchase.paid_at || decimalCents(purchase.orders[0]?.price) !== request.amountCents ||
          !Array.isArray(purchase.transactions) || !purchase.transactions.length || purchase.transactions.length > 20 ||
          purchase.transactions.some((t: any) => !uuid(t?.id) || t.type !== "debit" || t.status !== "authorized" ||
            t.canceled_at !== null || t.unauthorized_at !== null || t.reserved_at !== null || !providerTime(t.authorized_at))) return unknown("carrier_purchase_receipt_missing");
      const receipt: MarketplaceShipmentPurchaseReceipt = { version: 1, carrierOrderId, carrierPurchaseId: purchase.id,
        amountCents: request.amountCents, currency: "BRL", paidAt: purchase.paid_at, requestHash: hash(request),
        transactions: purchase.transactions.map((t: any) => ({ id: t.id, amountCents: decimalCents(t.value) ?? -1 })).sort((a: any, b: any) => a.id.localeCompare(b.id)) };
      assertMarketplaceShipmentPurchaseReceipt(receipt, request, carrierOrderId);
      // Even a paid POST response remains unknown until independent GET.
      return { ...unknown("carrier_purchase_requires_reconciliation"), purchaseReceipt: receipt };
    } catch { return unknown("carrier_purchase_unproven"); }
  }

  async reconcilePurchase(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt | null): Promise<MarketplaceShipmentStageEvidence> {
    const unknown = (reason: string) => ({ status: "unknown" as const, carrierOrderId, observedAt: new Date(), reason });
    // GET order proves the label was paid, but exposes neither purchase ID nor
    // wallet transactions. It cannot reconstruct a lost checkout receipt.
    if (!receipt) return unknown("carrier_purchase_receipt_recovery_required");
    try {
      assertMarketplaceShipmentPurchaseReceipt(receipt, request, carrierOrderId);
      const row = await this.paidOrder(request, carrierOrderId, receipt);
      if (!row) return unknown("carrier_purchase_unproven");
      return { status: "purchased", carrierOrderId, observedAt: new Date(), purchaseReceipt: receipt };
    } catch { return unknown("carrier_purchase_unproven"); }
  }

  async generate(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt) {
    const unknown = (reason: string, notSubmitted = false) => ({ status: "unknown" as const, carrierOrderId, observedAt: new Date(), reason,
      ...(notSubmitted ? { notSubmitted: true } : {}) });
    let auth: Awaited<ReturnType<MarketplaceMelhorEnvioAdapter["auth"]>>;
    try {
      assertMarketplaceShipmentPurchaseReceipt(receipt, request, carrierOrderId);
      const row = await this.paidOrder(request, carrierOrderId, receipt);
      if (!row) return unknown("carrier_generation_preflight_unproven", true);
      if (row.generated_at !== null) return unknown("carrier_generation_already_observed");
      if (row.status !== "released") return unknown("carrier_generation_preflight_unproven", true);
      auth = await this.auth(request);
    } catch { return unknown("carrier_account_unavailable", true); }
    try {
      await this.transport(`${auth.base}/api/v2/me/shipment/generate`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ orders: [carrierOrderId] }), signal: AbortSignal.timeout(15000), redirect: "error" });
      // Provider's {status:true} is an acknowledgement, not generation proof.
      return unknown("carrier_generation_requires_reconciliation");
    } catch { return unknown("carrier_generation_unproven"); }
  }

  async reconcileGeneration(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt): Promise<MarketplaceShipmentStageEvidence> {
    const unknown = () => ({ status: "unknown" as const, carrierOrderId, observedAt: new Date(), reason: "carrier_generation_unproven" });
    try {
      assertMarketplaceShipmentPurchaseReceipt(receipt, request, carrierOrderId);
      const row = await this.paidOrder(request, carrierOrderId, receipt);
      if (!row || !providerTime(row.generated_at) || row.generated_at < row.paid_at ||
          (row.tracking !== null && (typeof row.tracking !== "string" || !/^[a-zA-Z0-9-]{6,64}$/.test(row.tracking)))) return unknown();
      return { status: "generated", carrierOrderId, observedAt: new Date(), generationReceipt: {
        version: 1, carrierOrderId, requestHash: hash(request), purchaseReceiptHash: hash(receipt),
        paidAt: row.paid_at, generatedAt: row.generated_at, trackingCode: row.tracking,
      } };
    } catch { return unknown(); }
  }

  async print(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt) {
    try {
      assertMarketplaceShipmentGenerationReceipt(generation, request, purchase, carrierOrderId);
      // Stored generation is necessary but not sufficient: a label can expire or
      // be cancelled at the carrier after our original confirmation.
      const row = await this.paidOrder(request, carrierOrderId, purchase);
      if (!row || row.generated_at !== generation.generatedAt ||
          (generation.trackingCode && row.tracking !== generation.trackingCode)) return undefined;
      const auth = await this.auth(request);
      // This obtains a private presentation link for an existing label. Repeating
      // the query after a lost response never purchases or generates a label.
      const response = await this.transport(`${auth.base}/api/v2/me/shipment/print`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ mode: "private", orders: [carrierOrderId] }), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return undefined;
      const result = await response.json() as Record<string, unknown>;
      const url = marketplaceShipmentPrivatePrintUrl(result?.url, request.environment);
      if (!url) return undefined;
      // No link dereference here: the merchant opens it in their own carrier
      // session. Never persist this opaque capability in a journal or log.
      return { carrierOrderId, mode: "private" as const, url, observedAt: new Date() };
    } catch { return undefined; }
  }

  async cancel(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt | null, reason: MarketplaceShipmentCancellationReason): Promise<MarketplaceShipmentCancellationEvidence> {
    const unknown = (notSubmitted = false): MarketplaceShipmentCancellationEvidence => ({ status: "unknown", carrierOrderId,
      observedAt: new Date(), ...(notSubmitted ? { notSubmitted: true } : {}) });
    let auth: Awaited<ReturnType<MarketplaceMelhorEnvioAdapter["auth"]>>, description: string;
    try {
      description = marketplaceShipmentCancellationDescription(reason);
      const row = await this.cancellationOrder(request, carrierOrderId, purchase, generation);
      // An already canceled order is only confirmed by the independent recovery
      // GET. No cancellation POST is needed and the durable claim stays closed.
      if (row?.status === "canceled") return unknown();
      if (!row || row.status !== "released" || row.canceled_at !== null) return unknown(true);
      auth = await this.auth(request);
      const response = await this.transport(`${auth.base}/api/v2/me/shipment/cancellable`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ orders: [carrierOrderId] }), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return unknown(true);
      const eligibility = await response.json() as Record<string, any>;
      if (eligibility?.[carrierOrderId]?.cancellable !== true) return unknown(true);
      // Eligibility can take long enough for posting, repricing or OAuth rotation.
      // Re-read the immutable original order, then bind the current credential.
      const fresh = await this.cancellationOrder(request, carrierOrderId, purchase, generation);
      if (fresh?.status === "canceled") return unknown();
      if (!fresh || fresh.status !== "released" || fresh.canceled_at !== null) return unknown(true);
      auth = await this.auth(request);
    } catch { return unknown(true); }
    try {
      await this.transport(`${auth.base}/api/v2/me/shipment/cancel`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ order: { id: carrierOrderId, reason_id: "2", description } }), signal: AbortSignal.timeout(15000), redirect: "error" });
      // Even {canceled:true} cannot prove completion or a wallet refund. Any
      // outcome after this POST, including HTTP rejection, stays non-retryable.
    } catch { /* Recovery only observes the same order. */ }
    return unknown();
  }

  async reconcileCancellation(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt | null): Promise<MarketplaceShipmentCancellationEvidence> {
    const unknown = (): MarketplaceShipmentCancellationEvidence => ({ status: "unknown", carrierOrderId, observedAt: new Date() });
    try {
      const row = await this.cancellationOrder(request, carrierOrderId, purchase, generation);
      if (!row || row.status !== "canceled") return unknown();
      const receipt = { version: 1 as const, carrierOrderId, requestHash: hash(request), purchaseReceiptHash: hash(purchase),
        generationReceiptHash: generation ? hash(generation) : null, paidAt: row.paid_at, generatedAt: row.generated_at,
        canceledAt: row.canceled_at, walletRefundStatus: "unproven" as const };
      assertMarketplaceShipmentCancellationReceipt(receipt, request, purchase, generation, carrierOrderId);
      return { status: "canceled", carrierOrderId, observedAt: new Date(), receipt };
    } catch { return unknown(); }
  }

  private async cancellationOrder(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase: MarketplaceShipmentPurchaseReceipt,
    generation: MarketplaceShipmentGenerationReceipt | null) {
    if (!uuid(carrierOrderId)) return undefined;
    assertMarketplaceShipmentPurchaseReceipt(purchase, request, carrierOrderId);
    if (generation) assertMarketplaceShipmentGenerationReceipt(generation, request, purchase, carrierOrderId);
    const auth = await this.auth(request);
    const response = await this.transport(`${auth.base}/api/v2/me/orders/${encodeURIComponent(carrierOrderId)}`, {
      method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) return undefined;
    const row = await response.json() as Record<string, any>;
    if (!sameOrder(row, request, carrierOrderId, true) || row.paid_at !== purchase.paidAt ||
        row.generated_at !== (generation?.generatedAt ?? null) || row.posted_at !== null || row.delivered_at !== null ||
        (generation?.trackingCode && row.tracking !== generation.trackingCode) ||
        (row.conciliation !== null && row.conciliation !== undefined)) return undefined;
    return row;
  }

  private async paidOrder(request: MarketplaceShipmentRequest, carrierOrderId: string, receipt: MarketplaceShipmentPurchaseReceipt) {
    if (!uuid(carrierOrderId)) return undefined;
    const auth = await this.auth(request);
    const response = await this.transport(`${auth.base}/api/v2/me/orders/${encodeURIComponent(carrierOrderId)}`, {
      method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
    if (!response.ok) return undefined;
    const row = await response.json() as Record<string, any>;
    if (!sameOrder(row, request, carrierOrderId) || !["released", "posted", "delivered"].includes(row.status) ||
        row.paid_at !== receipt.paidAt || (row.generated_at !== null && !providerTime(row.generated_at)) ||
        // Postage measurement adjustments require their own financial handling.
        // Never interpret a paid conciliation debit as the original purchase.
        (row.conciliation !== null && row.conciliation !== undefined)) return undefined;
    return row;
  }

  private async trackingFinancialIntegrity(request: MarketplaceShipmentRequest, carrierOrderId: string,
    purchase: MarketplaceShipmentPurchaseReceipt, generation: MarketplaceShipmentGenerationReceipt | null,
    expectedStatus?: string): Promise<MarketplaceShipmentTrackingEvidence | undefined> {
    const issue = (financialIssue: MarketplaceShipmentFinancialIssue, observedAmountCents?: number): MarketplaceShipmentTrackingEvidence => ({
      carrierOrderId, status: "unproven", trackingCode: null, observedAt: new Date(), financialIssue,
      ...(observedAmountCents !== undefined ? { observedAmountCents } : {}),
    });
    let auth;
    try { auth = await this.auth(request); }
    catch { return issue("carrier_original_account_unavailable"); }
    try {
      assertMarketplaceShipmentPurchaseReceipt(purchase, request, carrierOrderId);
      if (generation) assertMarketplaceShipmentGenerationReceipt(generation, request, purchase, carrierOrderId);
      const response = await this.transport(`${auth.base}/api/v2/me/orders/${encodeURIComponent(carrierOrderId)}`, {
        method: "GET", headers: auth.headers, signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return issue("carrier_original_order_unproven");
      const row = await response.json() as Record<string, any>;
      // Identify the authenticated native order before interpreting its amount.
      if (!row || row.id !== carrierOrderId) return issue("carrier_original_order_unproven");
      const amount = decimalCents(row.price);
      if (amount !== undefined && amount !== null && amount !== request.amountCents) return issue("carrier_price_adjustment_unproven", amount);
      if (row.conciliation !== null && row.conciliation !== undefined) return issue("carrier_conciliation_unproven");
      if (!sameOrder(row, request, carrierOrderId) || !["released", "posted", "delivered"].includes(row.status) ||
          (expectedStatus === "delivered" && row.status !== "delivered") ||
          row.paid_at !== purchase.paidAt || (generation && (row.generated_at !== generation.generatedAt ||
          (generation.trackingCode && row.tracking !== generation.trackingCode)))) return issue("carrier_purchase_binding_unproven");
      return undefined;
    } catch { return issue("carrier_original_order_unproven"); }
  }

  async tracking(request: MarketplaceShipmentRequest, carrierOrderId: string, purchase?: MarketplaceShipmentPurchaseReceipt | null,
    generation?: MarketplaceShipmentGenerationReceipt | null): Promise<MarketplaceShipmentTrackingEvidence | undefined> {
    if (!uuid(carrierOrderId)) return undefined;
    if (purchase) {
      const financial = await this.trackingFinancialIntegrity(request, carrierOrderId, purchase, generation ?? null);
      if (financial) return financial;
    }
    try {
      const auth = await this.auth(request);
      const response = await this.transport(`${auth.base}/api/v2/me/shipment/tracking`, { method: "POST", headers: auth.headers,
        body: JSON.stringify({ orders: [carrierOrderId] }), signal: AbortSignal.timeout(15000), redirect: "error" });
      if (!response.ok) return undefined;
      const payload = await response.json() as Record<string, any>, row = payload?.[carrierOrderId];
      if (!row || (row.id !== undefined && row.id !== carrierOrderId) || !statuses.has(row.status) ||
          (row.tracking !== null && row.tracking !== undefined && (typeof row.tracking !== "string" || !/^[a-zA-Z0-9-]{6,64}$/.test(row.tracking)))) return undefined;
      if (purchase) {
        const financial = await this.trackingFinancialIntegrity(request, carrierOrderId, purchase, generation ?? null, row.status);
        if (financial) return financial;
      }
      return { carrierOrderId, status: row.status, trackingCode: row.tracking ?? null, observedAt: new Date() };
    } catch { return undefined; }
  }
}

function sameOrder(row: any, request: MarketplaceShipmentRequest, carrierOrderId: string, allowCanceled = false) {
  const b = request.body;
  if (!row || row.id !== carrierOrderId || row.service_id !== b.service || ![1, 2, 17].includes(b.service) || b.volumes.length !== 1 ||
      (!allowCanceled && row.canceled_at !== null) || row.expired_at !== null || row.suspended_at !== null ||
      decimalCents(row.price) !== request.amountCents || decimalCents(row.insurance_value) !== decimalCents(b.options.insurance_value) ||
      row.receipt !== false || row.own_hand !== false || row.reverse !== false || row.non_commercial !== false ||
      row.invoice?.key !== b.options.invoice.key || !Array.isArray(row.tags) || row.tags.filter((t: any) => t?.tag === request.reference).length !== 1 ||
      !sameAddress(row.from, b.from) || !sameAddress(row.to, b.to) || !Array.isArray(row.products) || !Array.isArray(row.volumes)) return false;
  const products = row.products.map((p: any) => ({ name: p?.name, quantity: Number(p?.quantity), unitary_value: decimalCents(p?.unitary_value) }));
  const expectedProducts = b.products.map(p => ({ ...p, unitary_value: decimalCents(p.unitary_value) }));
  const volumes = row.volumes.map((v: any) => ({ height: Number(v?.height), width: Number(v?.width), length: Number(v?.length), weight: Number(v?.weight) }));
  return hash(canonicalRows(products)) === hash(canonicalRows(expectedProducts)) && hash(canonicalRows(volumes)) === hash(canonicalRows(b.volumes));
}

function sameAddress(actual: any, expected: MarketplaceShipmentRequest["body"]["from"]) {
  if (!actual || typeof actual !== "object") return false;
  return Object.entries(expected).every(([key, value]) => {
    const candidate = key === "number" ? actual.location_number : actual[key];
    return (candidate ?? "") === (value ?? "");
  }) && (actual.document ?? "") === (expected.document ?? "") && (actual.company_document ?? "") === (expected.company_document ?? "");
}
