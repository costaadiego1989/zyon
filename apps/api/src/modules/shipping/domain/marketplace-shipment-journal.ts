import { ConflictException } from "@nestjs/common";
import type { CustomerHints } from "@zyon/shared-types";
import { assertMarketplaceShippingAccountIdentity, type MarketplaceShippingAccountIdentity } from "./marketplace-shipping-account-identity.js";
import { marketplaceShippingContractHash as hash, assertMarketplaceShippingContract, type MarketplaceShippingContract } from "./marketplace-shipping-contract.js";

export type MarketplaceCarrierQuote = {
  version: 1 | 2; environment: "test" | "live"; accountFingerprint: string; accountIdentity?: MarketplaceShippingAccountIdentity;
  serviceId: number; amountCents: number;
  volumes: Array<{ height: number; width: number; length: number; weight: number; insuranceCents: number;
    products: Array<{ id: string; quantity: number }>; amountCents?: number }>;
};
export type MarketplaceShipmentAddress = {
  name: string; phone: string; email: string; document?: string; company_document?: string; state_register?: string;
  address: string; number: string; complement?: string; district: string; city: string; state_abbr: string;
  postal_code: string; country_id: "BR";
};
export type MarketplaceShipmentRequest = {
  version: 1 | 2; volumeIndex?: number; volumeCount?: number;
  paymentIntentId: string; originMerchantId: string; quoteId: string; quoteKey: string; carrierQuoteHash: string;
  environment: "test" | "live"; accountFingerprint: string; accountIdentity?: MarketplaceShippingAccountIdentity; amountCents: number; reference: string;
  body: {
    service: number; from: MarketplaceShipmentAddress; to: MarketplaceShipmentAddress;
    products: Array<{ name: string; quantity: number; unitary_value: number }>;
    volumes: Array<{ height: number; width: number; length: number; weight: number }>;
    options: { insurance_value: number; receipt: false; own_hand: false; reverse: false; platform: "Zyon";
      invoice: { key: string }; tags: Array<{ tag: string; url: null }> };
  };
};
export type MarketplaceShipmentStatus = "prepared" | "cart_unknown" | "cart_created" | "purchase_unknown" | "purchased" |
  "generate_unknown" | "generated" | "blocked";
export type MarketplaceShipmentRecord = {
  id: string; fundingPlanId: string; hostMerchantId: string; originMerchantId: string; volumeIndex: number; quoteId: string; quoteKey: string;
  environment: string; accountFingerprint: string; request: MarketplaceShipmentRequest; requestHash: string; reference: string;
  status: MarketplaceShipmentStatus; version: number; carrierOrderId: string | null; claimedAt: Date | null;
  reconciledAt: Date | null; trackingCode: string | null; trackingStatus: string | null; blockReason: string | null;
  carrierPurchaseId: string | null; purchaseReceipt: MarketplaceShipmentPurchaseReceipt | null; purchaseReceiptHash: string | null;
  purchaseClaimedAt: Date | null; purchasedAt: Date | null; generationClaimedAt: Date | null;
  generationReceipt: MarketplaceShipmentGenerationReceipt | null; generationReceiptHash: string | null; generatedAt: Date | null;
  cancellationStatus: "unknown" | "canceled" | null; cancellationReason: MarketplaceShipmentCancellationReason | null;
  cancellationClaimedAt: Date | null; cancellationReceipt: MarketplaceShipmentCancellationReceipt | null;
  cancellationReceiptHash: string | null; canceledAt: Date | null;
};
export type MarketplaceShipmentEvidence = { status: "cart_created" | "unknown"; carrierOrderId?: string; observedAt: Date; reason?: string };
export type MarketplaceShipmentPurchaseReceipt = { version: 1; carrierOrderId: string; carrierPurchaseId: string;
  amountCents: number; currency: "BRL"; paidAt: string; requestHash: string; transactions: Array<{ id: string; amountCents: number }> };
export type MarketplaceShipmentGenerationReceipt = { version: 1; carrierOrderId: string; requestHash: string;
  purchaseReceiptHash: string; paidAt: string; generatedAt: string; trackingCode: string | null };
export type MarketplaceShipmentStage = "purchase" | "generate";
export type MarketplaceShipmentStageEvidence = { status: "unknown" | "purchased" | "generated"; carrierOrderId: string;
  observedAt: Date; reason?: string; purchaseReceipt?: MarketplaceShipmentPurchaseReceipt; generationReceipt?: MarketplaceShipmentGenerationReceipt };
/** An ephemeral private link. It is never a delivery event or a receipt of a new charge. */
export type MarketplaceShipmentPrintResult = { carrierOrderId: string; mode: "private"; url: string; observedAt: Date };
export type MarketplaceShipmentCancellationReason = "merchant_request" | "return" | "dispute";
export type MarketplaceShipmentCancellationReceipt = { version: 1; carrierOrderId: string; requestHash: string;
  purchaseReceiptHash: string; generationReceiptHash: string | null; paidAt: string; generatedAt: string | null;
  canceledAt: string; walletRefundStatus: "unproven" };
export type MarketplaceShipmentCancellationEvidence = { status: "unknown" | "canceled"; carrierOrderId: string;
  observedAt: Date; receipt?: MarketplaceShipmentCancellationReceipt; notSubmitted?: boolean };

export const MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES = ["carrier_original_account_unavailable", "carrier_original_order_unproven",
  "carrier_price_adjustment_unproven", "carrier_conciliation_unproven", "carrier_purchase_binding_unproven",
  "carrier_purchase_receipt_recovery_required", "carrier_wallet_refund_unproven"] as const;
export type MarketplaceShipmentFinancialIssue = typeof MARKETPLACE_SHIPMENT_FINANCIAL_ISSUES[number];
export type MarketplaceShipmentTrackingEvidence = { carrierOrderId: string; status: string; trackingCode: string | null;
  observedAt: Date; financialIssue?: MarketplaceShipmentFinancialIssue; observedAmountCents?: number };

export function marketplaceShipmentCancellationDescription(reason: MarketplaceShipmentCancellationReason): string {
  const descriptions = { merchant_request: "Cancelamento solicitado pelo lojista", return: "Cancelamento por devolucao do pedido", dispute: "Cancelamento por contestacao do pedido" };
  if (!Object.prototype.hasOwnProperty.call(descriptions, reason)) return fail("cancellation_reason_invalid");
  return descriptions[reason];
}

export function assertMarketplaceShipmentCancellationReceipt(receipt: MarketplaceShipmentCancellationReceipt, request: MarketplaceShipmentRequest,
  purchase: MarketplaceShipmentPurchaseReceipt, generation: MarketplaceShipmentGenerationReceipt | null, carrierOrderId: string): void {
  assertMarketplaceShipmentPurchaseReceipt(purchase, request, carrierOrderId);
  if (generation) assertMarketplaceShipmentGenerationReceipt(generation, request, purchase, carrierOrderId);
  if (!receipt || receipt.version !== 1 || receipt.carrierOrderId !== carrierOrderId || receipt.requestHash !== hash(request) ||
      receipt.purchaseReceiptHash !== hash(purchase) || receipt.generationReceiptHash !== (generation ? hash(generation) : null) ||
      receipt.paidAt !== purchase.paidAt || receipt.generatedAt !== (generation?.generatedAt ?? null) ||
      !marketplaceShipmentProviderTime(receipt.canceledAt) || receipt.canceledAt < (generation?.generatedAt ?? purchase.paidAt) ||
      receipt.walletRefundStatus !== "unproven") fail("cancellation_receipt_invalid");
}

export function marketplaceShipmentPrivatePrintUrl(value: unknown, environment: "test" | "live"): string | undefined {
  if (typeof value !== "string" || value.length > 4096 || value !== value.trim() || /[\u0000-\u0020\u007f\\]/.test(value)) return undefined;
  try {
    const url = new URL(value), expected = environment === "test" ? "https://sandbox.melhorenvio.com.br" : "https://melhorenvio.com.br";
    if (url.origin !== expected || url.username || url.password || url.hash || !/^\/imprimir\/[A-Za-z0-9_-]{1,256}$/.test(url.pathname)) return undefined;
    return url.href;
  } catch { return undefined; }
}

export function marketplaceShipmentProviderTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)) return false;
  const normalized = value.replace(" ", "T"), d = new Date(`${normalized}Z`);
  // Carrier timestamps have no timezone. Validate the calendar only; retain the
  // original string instead of inventing a UTC/Brasilia conversion.
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 19) === normalized;
}

export function assertMarketplaceShipmentPurchaseReceipt(receipt: MarketplaceShipmentPurchaseReceipt, request: MarketplaceShipmentRequest,
  carrierOrderId: string): void {
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (!receipt || receipt.version !== 1 || receipt.carrierOrderId !== carrierOrderId || !uuid.test(receipt.carrierPurchaseId) ||
      receipt.requestHash !== hash(request) || receipt.amountCents !== request.amountCents || receipt.currency !== "BRL" ||
      !marketplaceShipmentProviderTime(receipt.paidAt) || !Array.isArray(receipt.transactions) || !receipt.transactions.length || receipt.transactions.length > 20 ||
      receipt.transactions.some(t => !t || !uuid.test(t.id) || !Number.isSafeInteger(t.amountCents) || t.amountCents <= 0) ||
      new Set(receipt.transactions.map(t => t.id)).size !== receipt.transactions.length ||
      receipt.transactions.reduce((sum, t) => sum + t.amountCents, 0) !== request.amountCents) fail("purchase_receipt_invalid");
}

export function assertMarketplaceShipmentGenerationReceipt(receipt: MarketplaceShipmentGenerationReceipt, request: MarketplaceShipmentRequest,
  purchase: MarketplaceShipmentPurchaseReceipt, carrierOrderId: string): void {
  assertMarketplaceShipmentPurchaseReceipt(purchase, request, carrierOrderId);
  if (!receipt || receipt.version !== 1 || receipt.carrierOrderId !== carrierOrderId || receipt.requestHash !== hash(request) ||
      receipt.purchaseReceiptHash !== hash(purchase) || receipt.paidAt !== purchase.paidAt ||
      !marketplaceShipmentProviderTime(receipt.generatedAt) || receipt.generatedAt < purchase.paidAt ||
      (receipt.trackingCode !== null && !/^[a-zA-Z0-9-]{6,64}$/.test(receipt.trackingCode))) fail("generation_receipt_invalid");
}

const fail = (code: string): never => { throw new ConflictException(`marketplace_shipment_${code}`); };
export function decimalCents(value: unknown): number | undefined {
  const s = typeof value === "number" && Number.isFinite(value) ? String(value) : value;
  if (typeof s !== "string" || !/^(0|[1-9]\d*)(\.\d{1,2})?$/.test(s)) return undefined;
  const [a, b = ""] = s.split("."), cents = Number(a) * 100 + Number(b.padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= 2_147_483_647 ? cents : undefined;
}
const positive = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 1000;
const numeric = (value: unknown) => typeof value === "string" && /^\d+(\.\d{1,3})?$/.test(value) ? Number(value) : value;

/** Preserve the carrier's packed volumes, never substitute product dimensions. */
export function carrierQuoteSnapshot(input: { packages: unknown; environment: "test" | "live"; accountFingerprint: string; accountIdentity?: MarketplaceShippingAccountIdentity;
  serviceId: number; amountCents: number; products: Array<{ id: string; unitValueCents: number; quantity: number }> }): MarketplaceCarrierQuote | undefined {
  if (!Array.isArray(input.packages) || !input.packages.length || input.packages.length > 100 ||
      !Number.isSafeInteger(input.amountCents) || input.amountCents < 0 || input.amountCents > 2_147_483_647 ||
      !Array.isArray(input.products) || !input.products.length || new Set(input.products.map(p => p.id)).size !== input.products.length ||
      input.products.some(p => typeof p.id !== "string" || !p.id || !Number.isSafeInteger(p.quantity) || p.quantity < 1 || p.quantity > 99 ||
        !Number.isSafeInteger(p.unitValueCents) || p.unitValueCents < 0 || p.unitValueCents > 2_147_483_647)) return undefined;
  const multi = input.packages.length > 1;
  let accountIdentity: MarketplaceShippingAccountIdentity | undefined;
  if (input.accountIdentity !== undefined) {
    try { accountIdentity = assertMarketplaceShippingAccountIdentity(input.accountIdentity, { environment: input.environment,
      originMerchantId: input.accountIdentity?.originMerchantId, accountFingerprint: input.accountFingerprint }); }
    catch { return undefined; }
  }
  const quantities = new Map<string, number>(), volumes: MarketplaceCarrierQuote["volumes"] = [];
  for (const p of input.packages) {
    const dims = p?.dimensions, weight = numeric(p?.weight), insuranceCents = decimalCents(p?.insurance_value);
    if (!dims || ![dims.height, dims.width, dims.length].map(numeric).every(positive) || !positive(weight) ||
        insuranceCents === undefined || !Array.isArray(p.products) || !p.products.length || p.products.length > 100) return undefined;
    const products: Array<{ id: string; quantity: number }> = [];
    let insured = 0;
    for (const item of p.products) {
      const source = input.products.find(row => row.id === item?.id);
      if (!source || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 99 || products.some(row => row.id === item.id)) return undefined;
      products.push({ id: item.id, quantity: item.quantity });
      quantities.set(item.id, (quantities.get(item.id) ?? 0) + item.quantity);
      insured += source.unitValueCents * item.quantity;
    }
    if (insured !== insuranceCents) return undefined;
    const amountCents = multi ? decimalCents(p.price) : undefined;
    if (multi && (amountCents === undefined || amountCents <= 0)) return undefined;
    volumes.push({ height: Number(dims.height), width: Number(dims.width), length: Number(dims.length), weight: Number(weight), insuranceCents, products,
      ...(multi ? { amountCents } : {}) });
  }
  if (input.products.some(row => quantities.get(row.id) !== row.quantity) || quantities.size !== input.products.length) return undefined;
  // Do not invent an allocation for user customizations or an aggregate price.
  if (multi && volumes.reduce((sum, v) => sum + v.amountCents!, 0) !== input.amountCents) return undefined;
  return { version: multi ? 2 : 1, environment: input.environment, accountFingerprint: input.accountFingerprint,
    ...(accountIdentity ? { accountIdentity } : {}), serviceId: input.serviceId,
    amountCents: input.amountCents, volumes };
}

export function assertCarrierQuote(value: unknown, digest: string, contract: MarketplaceShippingContract,
  serviceId: number, amountCents: number): MarketplaceCarrierQuote {
  const q = value as MarketplaceCarrierQuote;
  if (!q || ![1, 2].includes(q.version) || !["test", "live"].includes(q.environment) || !/^[a-f0-9]{64}$/.test(q.accountFingerprint) ||
      q.serviceId !== serviceId || q.amountCents !== amountCents || !Array.isArray(q.volumes) || hash(q) !== digest) return fail("carrier_quote_invalid");
  if (q.accountIdentity !== undefined) {
    try { assertMarketplaceShippingAccountIdentity(q.accountIdentity, { environment: q.environment,
      originMerchantId: contract.merchantId, accountFingerprint: q.accountFingerprint }); }
    catch { return fail("carrier_quote_invalid"); }
  }
  const reconstructed = carrierQuoteSnapshot({ ...q, packages: q.volumes.map(v => ({ dimensions: v, weight: v.weight,
    insurance_value: v.insuranceCents / 100, products: v.products, price: v.amountCents === undefined ? undefined : v.amountCents / 100 })),
    products: contract.products.map(p => ({ id: p.lineItemId, unitValueCents: p.unitValueCents, quantity: p.quantity })) });
  if (!reconstructed || hash(reconstructed) !== digest) return fail("carrier_quote_invalid");
  return structuredClone(q);
}

function address(value: MarketplaceShipmentAddress, expectedZip: string) {
  const a = value;
  if (!a || a.country_id !== "BR" || a.postal_code !== expectedZip || !/^\d{8}$/.test(a.postal_code) ||
      !/^[A-Z]{2}$/.test(a.state_abbr) || !/^\d{10,13}$/.test(a.phone) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(a.email) ||
      [a.name, a.address, a.number, a.district, a.city].some(v => typeof v !== "string" || !v.trim() || v !== v.trim() || v.length > 200) ||
      (a.complement !== undefined && (typeof a.complement !== "string" || a.complement.length > 200)) ||
      (!!a.document === !!a.company_document) || (a.document && !/^\d{11}$/.test(a.document)) ||
      (a.company_document && !/^\d{14}$/.test(a.company_document))) return fail("address_incomplete");
  return structuredClone(a);
}

export function marketplaceShipmentRecipient(customer: CustomerHints | null | undefined): MarketplaceShipmentAddress {
  const a = customer?.address, document = customer?.cpf?.replace(/\D/g, "") ?? "";
  return { name: customer?.fullName?.trim() ?? "", email: customer?.email?.trim() ?? "", phone: customer?.phone?.replace(/\D/g, "") ?? "",
    ...(document.length === 14 ? { company_document: document } : { document }), country_id: "BR",
    postal_code: a?.zip?.replace(/\D/g, "") ?? "", address: a?.street?.trim() ?? "", number: a?.number?.trim() ?? "",
    complement: a?.complement?.trim() ?? "", district: a?.neighborhood?.trim() ?? "", city: a?.city?.trim() ?? "", state_abbr: a?.state?.trim().toUpperCase() ?? "" };
}

export type MarketplaceShipmentBuildInput = {
  hostMerchantId: string; paymentIntentId: string; originMerchantId: string; quoteId: string; quoteKey: string; carrierQuoteHash: string;
  contract: MarketplaceShippingContract; carrierQuote: MarketplaceCarrierQuote; from: MarketplaceShipmentAddress;
  to: MarketplaceShipmentAddress; invoiceKey: string; productNames: Record<string, string>; volumeIndex?: number;
};

export function marketplaceShipmentReference(host: string, payment: string, origin: string, volumeIndex = 0, volumeCount = 1): string {
  return `mship_${hash(volumeCount > 1 ? [host, payment, origin, volumeIndex] : [host, payment, origin])}`;
}

export function marketplaceShipmentVolume(request: MarketplaceShipmentRequest): { index: number; count: number } {
  if (request.version === 1 && request.volumeIndex === undefined && request.volumeCount === undefined) return { index: 0, count: 1 };
  if (request.version !== 2 || !Number.isSafeInteger(request.volumeIndex) || !Number.isSafeInteger(request.volumeCount) ||
      request.volumeCount! < 2 || request.volumeCount! > 100 || request.volumeIndex! < 0 || request.volumeIndex! >= request.volumeCount!) return fail("volume_identity_invalid");
  return { index: request.volumeIndex!, count: request.volumeCount! };
}

export function buildMarketplaceShipmentRequests(input: MarketplaceShipmentBuildInput): MarketplaceShipmentRequest[] {
  return input.carrierQuote.volumes.map((_, volumeIndex) => buildMarketplaceShipmentRequest({ ...input, volumeIndex }));
}

/** Rebuild every package from the same frozen quotation. No current catalogue,
 * aggregate-price division or carrier re-quotation participates in this proof. */
export function assertMarketplaceShipmentOriginRequests(records: MarketplaceShipmentRecord[], input: {
  hostMerchantId: string; paymentIntentId: string; originMerchantId: string;
  binding: { quoteId: string; quoteKey: string; carrierKey: string; amountCents: number; carrierQuoteHash?: string };
  option: { price?: unknown; currency?: unknown; marketplaceShipmentContract?: unknown; marketplaceCarrierQuote?: unknown };
}): MarketplaceShipmentRecord[] {
  const { binding, option } = input;
  if (!binding.carrierQuoteHash || option.price !== binding.amountCents || option.currency !== "BRL" ||
      !/^melhor-envio-(1|2|17)$/.test(binding.carrierKey)) return fail("volume_set_invalid");
  const contract = assertMarketplaceShippingContract(option.marketplaceShipmentContract, binding.quoteKey, input.originMerchantId);
  const quote = assertCarrierQuote(option.marketplaceCarrierQuote, binding.carrierQuoteHash, contract,
    Number(binding.carrierKey.slice("melhor-envio-".length)), binding.amountCents);
  const ordered = [...records].sort((a, b) => a.volumeIndex - b.volumeIndex);
  if (ordered.length !== quote.volumes.length || !ordered.length) return fail("volume_set_incomplete");
  const first = ordered[0].request;
  for (let index = 0; index < ordered.length; index++) {
    const row = ordered[index], volume = marketplaceShipmentVolume(row.request);
    if (row.hostMerchantId !== input.hostMerchantId || row.fundingPlanId !== input.paymentIntentId || row.originMerchantId !== input.originMerchantId ||
        row.volumeIndex !== index || volume.index !== index || volume.count !== quote.volumes.length ||
        row.quoteId !== binding.quoteId || row.quoteKey !== binding.quoteKey || row.environment !== quote.environment ||
        row.accountFingerprint !== quote.accountFingerprint || row.reference !== row.request.reference || row.requestHash !== hash(row.request)) return fail("volume_set_invalid");
    const productNames: Record<string, string> = {};
    contract.products.filter(p => quote.volumes[index].products.some(item => item.id === p.lineItemId)).forEach((p, position) => {
      productNames[p.lineItemId] = row.request.body.products[position]?.name ?? "";
    });
    const expected = buildMarketplaceShipmentRequest({ ...input, quoteId: binding.quoteId, quoteKey: binding.quoteKey,
      carrierQuoteHash: binding.carrierQuoteHash, contract, carrierQuote: quote, volumeIndex: index,
      from: first.body.from, to: first.body.to, invoiceKey: first.body.options.invoice.key, productNames });
    if (hash(expected) !== row.requestHash) return fail("volume_set_invalid");
  }
  return ordered;
}

export function buildMarketplaceShipmentRequest(input: MarketplaceShipmentBuildInput): MarketplaceShipmentRequest {
  const { contract, carrierQuote: q } = input;
  assertCarrierQuote(q, input.carrierQuoteHash, contract, q.serviceId, q.amountCents);
  if (contract.merchantId !== input.originMerchantId || !input.hostMerchantId || !input.paymentIntentId || !input.quoteId) return fail("binding_invalid");
  // The currently quoted Correios services require one separate order per volume.
  // Other carriers have additional agency/fiscal rules, which are not inferred.
  if (![1, 2, 17].includes(q.serviceId)) return fail("service_not_supported");
  const multi = q.volumes.length > 1, volumeIndex = input.volumeIndex ?? 0;
  if (multi && input.volumeIndex === undefined) return fail("volume_selection_required");
  if (!Number.isSafeInteger(volumeIndex) || volumeIndex < 0 || volumeIndex >= q.volumes.length) return fail("volume_identity_invalid");
  const volume = q.volumes[volumeIndex];
  if (!/^\d{44}$/.test(input.invoiceKey) || !input.from.state_register?.trim()) return fail("commercial_invoice_required");
  const from = address(input.from, contract.originZip), to = address(input.to, contract.destinationZip);
  const reference = marketplaceShipmentReference(input.hostMerchantId, input.paymentIntentId, input.originMerchantId, volumeIndex, q.volumes.length);
  const allocated = new Map(volume.products.map(p => [p.id, p.quantity]));
  const products = contract.products.filter(p => allocated.has(p.lineItemId)).map(p => {
    const name = input.productNames[p.lineItemId];
    if (typeof name !== "string" || !name.trim() || name.length > 200) return fail("product_name_missing");
    return { name: name.trim(), quantity: allocated.get(p.lineItemId)!, unitary_value: p.unitValueCents / 100 };
  });
  return { version: multi ? 2 : 1, ...(multi ? { volumeIndex, volumeCount: q.volumes.length } : {}), paymentIntentId: input.paymentIntentId, originMerchantId: input.originMerchantId,
    quoteId: input.quoteId, quoteKey: input.quoteKey, carrierQuoteHash: input.carrierQuoteHash,
    environment: q.environment, accountFingerprint: q.accountFingerprint,
    ...(q.accountIdentity ? { accountIdentity: structuredClone(q.accountIdentity) } : {}), amountCents: multi ? volume.amountCents! : q.amountCents, reference,
    body: { service: q.serviceId, from, to, products, volumes: [{ height: volume.height, width: volume.width, length: volume.length, weight: volume.weight }],
      options: { platform: "Zyon", insurance_value: volume.insuranceCents / 100, invoice: { key: input.invoiceKey },
        receipt: false, own_hand: false, reverse: false, tags: [{ tag: reference, url: null }] } } };
}
