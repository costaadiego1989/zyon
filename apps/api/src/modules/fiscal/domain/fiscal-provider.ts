import { createHash } from "node:crypto";

export const FISCAL_PROVIDERS = ["bling", "omie", "tiny", "focus"] as const;
export type FiscalProvider = typeof FISCAL_PROVIDERS[number];
export type FiscalEnvironment = "homologation" | "production";
export type FiscalOperation = "sale";
export type FiscalDocumentKind = "xml" | "danfe";
export type FiscalState = "awaiting_payment" | "not_eligible_before_activation" | "queued"
  | "processing" | "reconciliation_required" | "action_required" | "rejected"
  | "authorized" | "cancelled" | "suppressed";

export interface FiscalCapabilities {
  readonly salesOrder: boolean;
  readonly issuance: "direct" | "generate_then_submit" | "validate_then_bill";
  readonly cancellation: "api" | "erp_panel";
  readonly documents: readonly FiscalDocumentKind[];
  readonly authentication: "oauth" | "merchant_app_credentials" | "basic_company_token";
  readonly environmentSelection: "base_url" | "erp_configuration";
  readonly webhookAuthentication: "bling_hmac" | "configured_header" | "query_only";
}

const documents: readonly FiscalDocumentKind[] = Object.freeze(["xml", "danfe"]);
// Capabilities describe the reviewed public contract. They never assert that a
// particular merchant, certificate, scope or fiscal environment has been verified.
const capabilities: Readonly<Record<FiscalProvider, FiscalCapabilities>> = Object.freeze({
  bling: Object.freeze({ salesOrder: true, issuance: "generate_then_submit", cancellation: "erp_panel", documents,
    authentication: "oauth", environmentSelection: "erp_configuration", webhookAuthentication: "bling_hmac" }),
  omie: Object.freeze({ salesOrder: true, issuance: "validate_then_bill", cancellation: "api", documents,
    authentication: "merchant_app_credentials", environmentSelection: "erp_configuration", webhookAuthentication: "query_only" }),
  tiny: Object.freeze({ salesOrder: true, issuance: "generate_then_submit", cancellation: "api", documents,
    authentication: "oauth", environmentSelection: "erp_configuration", webhookAuthentication: "query_only" }),
  focus: Object.freeze({ salesOrder: false, issuance: "direct", cancellation: "api", documents,
    authentication: "basic_company_token", environmentSelection: "base_url", webhookAuthentication: "configured_header" }),
});

export function fiscalProviderCapabilities(provider: FiscalProvider): FiscalCapabilities {
  const value = capabilities[provider];
  if (!value) throw new Error("fiscal_provider_unsupported");
  return value;
}

export function listFiscalProviders(): readonly { id: FiscalProvider; label: string; capabilities: FiscalCapabilities }[] {
  const labels: Record<FiscalProvider, string> = { bling: "Bling", omie: "Omie", tiny: "Tiny/Olist", focus: "Focus NF-e" };
  return FISCAL_PROVIDERS.map(id => ({ id, label: labels[id], capabilities: capabilities[id] }));
}

export interface FiscalScope {
  readonly merchantId: string;
  readonly connectionId: string;
  readonly provider: FiscalProvider;
  readonly environment: FiscalEnvironment;
  readonly issuerTaxId: string;
}

export interface FiscalIdentity extends FiscalScope { readonly reference: string }

export function assertFiscalIdentity(expected: FiscalIdentity, actual: FiscalIdentity): void {
  for (const key of ["merchantId", "connectionId", "provider", "environment", "issuerTaxId", "reference"] as const) {
    if (!expected[key] || actual[key] !== expected[key]) throw new Error("fiscal_identity_mismatch");
  }
}

export function createFiscalReference(input: {
  merchantId: string; orderId: string; environment: FiscalEnvironment; operation: FiscalOperation;
}): string {
  if (!input.merchantId?.trim() || !input.orderId?.trim()
    || !["homologation", "production"].includes(input.environment) || input.operation !== "sale") {
    throw new Error("fiscal_reference_invalid");
  }
  const digest = createHash("sha256").update(JSON.stringify([
    input.merchantId, input.orderId, input.environment, input.operation,
  ])).digest("hex");
  return "zyon-nfe-" + digest.slice(0, 40);
}

export interface FiscalAuthorization {
  readonly number: string;
  readonly series: string;
  readonly accessKey: string;
  readonly protocol: string;
  readonly authorizedAt: string;
}

export interface FiscalCancellation {
  readonly protocol: string;
  readonly cancelledAt: string;
}

export type FiscalProviderDocument = {
  readonly identity: FiscalIdentity;
  readonly remoteInvoiceId: string;
  readonly remoteOrderId?: string;
  readonly providerStatus: string;
  readonly verifiedBy: "authenticated_query" | "request_response";
  readonly providerEmailRequest?: { requested: boolean; included: boolean; reasonCode?: string };
} & (
  | { readonly status: "processing" }
  | { readonly status: "authorized"; readonly authorization: FiscalAuthorization }
  | { readonly status: "rejected"; readonly reasonCode: string }
  | { readonly status: "cancelled"; readonly cancellation: FiscalCancellation; readonly authorization?: FiscalAuthorization }
);

export type FiscalWriteResult<T> =
  | { readonly outcome: "accepted"; readonly value: T }
  | { readonly outcome: "not_accepted"; readonly reasonCode: string; readonly retryAfterMs?: number }
  | { readonly outcome: "unknown"; readonly reasonCode: string };

export interface FiscalRemoteOrder { readonly id: string; readonly reference: string; readonly invoiceId?: string }
export type FiscalGenerationResult = { readonly remoteInvoiceId: string } | { readonly remoteOrderId: string };
/** A bill-order acknowledgement can precede creation of any fiscal document/ID. */
export interface FiscalProcessingReceipt {
  readonly identity: FiscalIdentity; readonly remoteOrderId: string; readonly remoteInvoiceId?: never;
  readonly status: "processing"; readonly providerStatus: string; readonly verifiedBy: "request_response";
  readonly providerEmailRequest?: { requested: boolean; included: boolean; reasonCode?: string };
}
export type FiscalSubmissionResult = FiscalProviderDocument | FiscalProcessingReceipt;
export type FiscalQueryResult = { readonly found: false } | { readonly found: true; readonly document: FiscalProviderDocument };

export interface FiscalReadinessCheck {
  readonly code: string;
  readonly status: "verified" | "pending" | "unsupported";
  readonly evidenceReference?: string;
  readonly reasonCode?: string;
  readonly action?: "reconnect";
}

/** Each adapter is instantiated with its own credential transport. No shared token or automatic write retry. */
export interface FiscalProviderPort {
  readonly provider: FiscalProvider;
  readonly capabilities: FiscalCapabilities;
  inspectConnection(scope: FiscalScope): Promise<readonly FiscalReadinessCheck[]>;
  findByReference(identity: FiscalIdentity): Promise<FiscalQueryResult>;
  ensureOrder(identity: FiscalIdentity, payload: Readonly<Record<string, unknown>>): Promise<FiscalWriteResult<FiscalRemoteOrder>>;
  generate(identity: FiscalIdentity, order: FiscalRemoteOrder): Promise<FiscalWriteResult<FiscalGenerationResult>>;
  submit(identity: FiscalIdentity, input: { remoteInvoiceId?: string; remoteOrderId?: string; payload: Readonly<Record<string, unknown>>; sendEmail: boolean }): Promise<FiscalWriteResult<FiscalSubmissionResult>>;
  query(identity: FiscalIdentity, remoteInvoiceId?: string): Promise<FiscalQueryResult>;
  download(identity: FiscalIdentity, input: { remoteInvoiceId: string; kind: FiscalDocumentKind; authorization?: FiscalAuthorization }): Promise<{ bytes: Uint8Array; mimeType: string }>;
  requestCancellation(identity: FiscalIdentity, input: {
    remoteInvoiceId: string; justification: string; requestedAt: string;
    restoreStock: false; reverseAccounts: false; cancelSale: false;
  }): Promise<FiscalWriteResult<FiscalProviderDocument>>;
}
