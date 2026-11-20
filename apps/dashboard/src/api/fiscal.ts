import { dashboardFetch, dashboardJson } from "./http/client.js";
import { DashboardHttpError, DashboardJsonParseError } from "./http/error.js";

export type FiscalEnvironment = "homologation" | "production";
export type FiscalProvider = "bling" | "omie" | "tiny" | "focus";
export type FiscalOwner = "zyon" | "provider";
export type FiscalState =
  | "awaiting_payment"
  | "not_eligible_before_activation"
  | "queued"
  | "processing"
  | "reconciliation_required"
  | "action_required"
  | "rejected"
  | "authorized"
  | "cancelled"
  | "suppressed";
export type FiscalChannel = "email" | "whatsapp";
export type FiscalDocumentKind = "xml" | "danfe";
export type FiscalReadinessCode =
  | "authentication"
  | "issuer"
  | "certificate"
  | "permissions"
  | "environment"
  | "stock_policy"
  | "email_policy"
  | "whatsapp_policy";
export interface FiscalReadiness {
  code: FiscalReadinessCode;
  status: "verified" | "pending" | "unsupported";
  reasonCode?: string;
  action?: "reconnect";
  evidenceReference?: string;
}
export interface FiscalProviderSummary {
  id: FiscalProvider;
  label: string;
  capabilities: {
    salesOrder: boolean;
    issuance: "direct" | "generate_then_submit" | "validate_then_bill";
    cancellation: "api" | "erp_panel";
    documents: FiscalDocumentKind[];
    authentication:
      | "oauth"
      | "merchant_app_credentials"
      | "basic_company_token";
    environmentSelection: "base_url" | "erp_configuration";
    webhookAuthentication: "bling_hmac" | "configured_header" | "query_only";
  };
}
export interface FiscalConnection {
  id: string;
  merchantId: string;
  provider: FiscalProvider;
  environment: FiscalEnvironment;
  issuerTaxId: string;
  erpConnectionId: string | null;
  isActive: boolean;
  activatedAt: string | null;
  disconnectedAt: string | null;
  stockOwner: FiscalOwner;
  emailOwner: FiscalOwner;
  whatsappOwner: FiscalOwner;
  readiness: FiscalReadiness[];
}
export interface FiscalCredential {
  kind: "company_token" | "oauth" | "app_credentials";
  secret: string;
}
export type FiscalConnectionInput = {
  environment: FiscalEnvironment;
  issuerTaxId: string;
  stockOwner: FiscalOwner;
  emailOwner: FiscalOwner;
  whatsappOwner: FiscalOwner;
} & (
  | { provider: "bling"; erpConnectionId: string; credential?: never }
  | {
      provider: "focus";
      erpConnectionId?: string;
      credential: { kind: "company_token"; secret: string };
    }
  | {
      provider: "omie";
      erpConnectionId?: string;
      credential: { kind: "app_credentials"; secret: string };
    }
  | {
      provider: "tiny";
      erpConnectionId?: string;
      credential: { kind: "oauth"; secret: string };
    }
);
export type FiscalPaymentConfiguration = {
  confirmed: true;
  environment: "test" | "live" | "testnet" | "mainnet";
  acquirerTaxId?: string;
  providerTimeZone?: string;
  cryptoDescription?: string;
} & (
  | { paymentIntentId: string; intentId?: never }
  | { intentId: string; paymentIntentId?: never }
);
export interface FiscalAccountConfiguration {
  profileVersionId: string;
  policyVersion: string;
  confirmed: true;
  expiresAt: string;
  certificateValidUntil: string;
  effects: {
    stockOnSave: boolean;
    stockOnAuthorize: boolean;
    stockOnCancel: boolean;
    accountsOnSave: boolean;
    accountsOnAuthorize: boolean;
    accountsOnCancel: boolean;
    automaticEmail: boolean;
    automaticInvoiceGeneration?: boolean;
    automaticInvoiceAuthorization?: boolean;
  };
}
export interface FiscalSetupInput {
  environment: FiscalEnvironment;
  companyId?: string;
  fiscalTimeZone?: string;
  focusWebhook?: { authorizationHeader: string; authorization: string };
  accountConfiguration?: FiscalAccountConfiguration;
  paymentConfiguration?: FiscalPaymentConfiguration;
}
export interface FiscalSetup {
  companyId: string | null;
  fiscalTimeZone: string | null;
  focusWebhookConfigured: boolean;
  paymentConfigurations: Array<{
    provider: string;
    environment: string;
    acquirerTaxId?: string;
    providerTimeZone?: string;
    cryptoDescription?: string;
    source: "responsible_confirmation";
    confirmedBy: string;
    confirmedAt: string;
  }>;
  accountEvidence: {
    source: string;
    confirmedBy: string;
    confirmedAt: string;
    expiresAt: string;
    profileVersionId: string;
    policyVersion: string;
  } | null;
}
export interface FiscalPaymentSource {
  paymentIntentId?: string;
  intentId?: string;
  provider: "stripe" | "asaas" | "mercadopago" | "crypto";
  method: string;
  status: string;
  createdAt: string;
}
export interface FiscalProfileInput {
  environment: FiscalEnvironment;
  provider: FiscalProvider;
  operation: "sale";
  issuerRegime: string;
  itemRules: Record<string, unknown>;
  recipientRequirements: string[];
  sourceContractVersion: string;
}
export interface FiscalProfile extends FiscalProfileInput {
  id: string;
  merchantId: string;
  version: number;
  confirmedBy: string | null;
  confirmedAt: string | null;
}
export interface FiscalProfiles {
  profile: FiscalProfile | null;
  confirmedProfile: FiscalProfile | null;
  supportedContract: {
    sourceContractVersion: string;
    operations: string[];
    currencies: string[];
    issuerRegimes: string[];
    productTypes: string[];
    minimumRecipientRequirements: string[];
  } | null;
}
export interface FiscalDelivery {
  channel: FiscalChannel;
  state:
    | "queued"
    | "blocked"
    | "accepted"
    | "delivered"
    | "failed"
    | "delivery_unknown";
  safeReasonCode?: string | null;
}
export interface FiscalInvoiceRow {
  id: string;
  orderId: string;
  recipientName: string;
  provider: FiscalProvider;
  state: FiscalState;
  deliveries: FiscalDelivery[];
}
export interface FiscalInvoicePage {
  items: FiscalInvoiceRow[];
  total: number;
  counts: Partial<Record<FiscalState, number>>;
  page: number;
  pageSize: number;
}
export interface FiscalInvoiceDocument {
  intentId: string;
  sellerMerchantId: string;
  orderId: string;
  state: FiscalState;
  documentState: "available" | "document_pending";
  number?: string;
  series?: string;
  accessKey?: string;
  authorizationProtocol?: string;
  authorizedAt?: string;
  cancellationProtocol?: string;
  cancelledAt?: string;
  documents: Array<{ kind: FiscalDocumentKind; available: boolean }>;
}
export interface FiscalInvoiceDetail extends FiscalInvoiceRow {
  environment: FiscalEnvironment;
  completedAt: string;
  totalCents: number;
  currency: string;
  reasonCode: string | null;
  attempts: number;
  nextAttemptAt: string;
  document: FiscalInvoiceDocument;
  stock: {
    owner: FiscalOwner;
    state:
      | "managed_by_zyon"
      | "awaiting_provider_evidence"
      | "evidence_confirmed"
      | "released";
    reasonCode?: string;
  };
  reviews: Array<{
    id: string;
    triggerKind: string;
    reviewState: string;
    safeReasonCode: string | null;
    confirmedAt: string | null;
    confirmedBy: string | null;
  }>;
  history: Array<{
    id: string;
    actorKind: string;
    actorId: string | null;
    action: string;
    previousState: string | null;
    nextState: string | null;
    occurredAt: string;
    safeReasonCode: string | null;
  }>;
  allowedActions: Array<{
    kind:
      | "configure"
      | "reconnect"
      | "reconcile"
      | "reprocess"
      | "erp_panel"
      | "request_cancellation";
    label: string;
    reviewId?: string;
  }>;
}
export interface FiscalTemplates {
  email: { subject: string; body: string };
  suggested: {
    email: { subject: string; body: string };
    whatsapp: { body: string };
  };
  whatsapp: {
    body: string;
    revision: number;
    status: string;
    rejectionReason: string | null;
    approvedVersions: Array<{ revision: number; body: string }>;
  };
  whatsappConnected: boolean;
  effectiveChannel: "whatsapp_template" | "email";
}
export interface FiscalTemplateRecord {
  id: string;
  merchantId: string;
  type: "fiscal_invoice";
  channel: FiscalChannel;
  body: string;
  subject?: string | null;
  metaRevision: number;
  metaStatus?: string | null;
  metaRejectionReason?: string | null;
}
export type FiscalApiErrorKind =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "validation"
  | "pending"
  | "rate_limited"
  | "unavailable";
const readinessCodes: FiscalReadinessCode[] = [
  "authentication",
  "issuer",
  "certificate",
  "permissions",
  "environment",
  "stock_policy",
  "email_policy",
  "whatsapp_policy",
];
export class FiscalApiError extends Error {
  readonly name = "FiscalApiError";
  constructor(
    readonly status: number,
    readonly kind: FiscalApiErrorKind,
    readonly code: string,
    readonly pending: FiscalReadinessCode[] = [],
    readonly retryAfterSeconds?: number
  ) {
    super(code);
  }
}
function safeError(error: unknown): FiscalApiError {
  if (error instanceof FiscalApiError) return error;
  const status = error instanceof DashboardHttpError ? error.status : 0;
  const kind: FiscalApiErrorKind =
    status === 401
      ? "unauthenticated"
      : status === 403
      ? "forbidden"
      : status === 404
      ? "not_found"
      : status === 409
      ? "pending"
      : status === 429
      ? "rate_limited"
      : status === 400 || status === 422
      ? "validation"
      : "unavailable";
  let data: { code?: unknown; pending?: unknown } = {};
  if (error instanceof DashboardHttpError)
    try {
      data = JSON.parse(error.responseBody);
    } catch {
      /* Proxy text is never a public diagnostic. */
    }
  const code =
    typeof data?.code === "string" &&
    /^(?:fiscal_[a-z0-9_]{1,100}|tenant_role_required)$/.test(data.code)
      ? data.code
      : error instanceof DashboardJsonParseError
      ? "fiscal_response_invalid"
      : "fiscal_request_failed";
  const pending = Array.isArray(data?.pending)
    ? data.pending.filter((v): v is FiscalReadinessCode =>
        readinessCodes.includes(v as FiscalReadinessCode)
      )
    : [];
  return new FiscalApiError(
    status,
    kind,
    code,
    pending,
    error instanceof DashboardHttpError ? error.retryAfterSeconds : undefined
  );
}
export function fiscalPaymentSourceLabel(source: FiscalPaymentSource): string {
  const provider = {
    stripe: "Stripe",
    asaas: "Asaas",
    mercadopago: "Mercado Pago",
    crypto: "Cripto",
  }[source.provider];
  const method =
    (
      {
        card: "Cartão",
        pix: "Pix",
        boleto: "Boleto",
        crypto: "Cripto",
      } as Record<string, string>
    )[source.method] ?? "Pagamento";
  const date = Number.isFinite(Date.parse(source.createdAt))
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
      }).format(new Date(source.createdAt))
    : "Data indisponível";
  return `${provider} · ${method} · ${date}`;
}

/** Session transport and backend results are authoritative; no local queue filtering or fiscal writes on reads. */
export function fiscalEndpoints(
  base: string,
  fetcher: typeof fetch = globalThis.fetch
) {
  const prefix = "/merchants/me/fiscal",
    id = encodeURIComponent;
  const query = (
    environment: FiscalEnvironment,
    extra: Record<string, string | number | undefined> = {}
  ) => {
    const params = new URLSearchParams({ environment });
    for (const [key, value] of Object.entries(extra))
      if (value !== undefined) params.set(key, String(value));
    return "?" + params.toString();
  };
  const json = async <T>(
    path: string,
    method = "GET",
    jsonBody?: unknown
  ): Promise<T> => {
    try {
      return await dashboardJson<T>(
        base,
        prefix + path,
        { method, ...(jsonBody === undefined ? {} : { jsonBody }) },
        fetcher
      );
    } catch (error) {
      throw safeError(error);
    }
  };
  const action = <T>(
    connectionId: string,
    name: string,
    environment: FiscalEnvironment,
    extra = {}
  ) =>
    json<T>(`/connection/${id(connectionId)}/${name}`, "POST", {
      environment,
      ...extra,
    });
  return {
    getFiscalOlistOAuthConfiguration: (environment: FiscalEnvironment) =>
      json<{ redirectUri: string }>("/olist/oauth/configuration" + query(environment)),
    authorizeFiscalOlist: (input: { environment: FiscalEnvironment; issuerTaxId: string; clientId: string; clientSecret: string; connectionId?: string; stockOwner: FiscalOwner; emailOwner: FiscalOwner; whatsappOwner: FiscalOwner }) =>
      json<{ url: string; state: string; redirectUri: string; expiresInSeconds: number }>("/olist/oauth/authorize", "POST", input),
    completeFiscalOlist: (environment: FiscalEnvironment, state: string, code: string) =>
      json<{ connectionId: string }>("/olist/oauth/complete", "POST", { environment, state, code }),
    getFiscalOlistNotifications: (connectionId: string, environment: FiscalEnvironment) =>
      json<{ configured: boolean; notificationUrl: string | null }>(`/olist/connection/${id(connectionId)}/notifications` + query(environment)),
    configureFiscalOlistNotifications: (connectionId: string, environment: FiscalEnvironment, rotate = false) =>
      json<{ configured: boolean; notificationUrl: string | null }>(`/olist/connection/${id(connectionId)}/notifications`, "POST", { environment, rotate }),
    getFiscalProviders: (environment: FiscalEnvironment) =>
      json<{
        environment: FiscalEnvironment;
        providers: FiscalProviderSummary[];
      }>("/providers" + query(environment)),
    getFiscalConnection: (environment: FiscalEnvironment) =>
      json<FiscalConnection | null>("/connection" + query(environment)),
    connectFiscal: (input: FiscalConnectionInput) =>
      json<FiscalConnection>("/connection", "PUT", input),
    inspectFiscalConnection: (
      connectionId: string,
      environment: FiscalEnvironment
    ) => action<FiscalConnection>(connectionId, "inspect", environment),
    activateFiscalConnection: (
      connectionId: string,
      environment: FiscalEnvironment
    ) => action<FiscalConnection>(connectionId, "activate", environment),
    reconnectFiscalConnection: (
      connectionId: string,
      environment: FiscalEnvironment,
      credential?: FiscalCredential
    ) =>
      action<FiscalConnection>(
        connectionId,
        "reconnect",
        environment,
        credential ? { credential } : {}
      ),
    disconnectFiscalConnection: (
      connectionId: string,
      environment: FiscalEnvironment
    ) =>
      json<FiscalConnection>(
        `/connection/${id(connectionId)}` + query(environment),
        "DELETE"
      ),
    getFiscalSetup: (connectionId: string, environment: FiscalEnvironment) =>
      json<FiscalSetup>(
        `/connection/${id(connectionId)}/setup` + query(environment)
      ),
    saveFiscalSetup: (connectionId: string, input: FiscalSetupInput) =>
      json<FiscalSetup>(`/connection/${id(connectionId)}/setup`, "PUT", input),
    getFiscalPaymentSources: (
      environment: FiscalEnvironment,
      intentId?: string
    ) =>
      json<FiscalPaymentSource[]>(
        "/payment-sources" + query(environment, { intentId })
      ),
    createFiscalProfile: (input: FiscalProfileInput) =>
      json<FiscalProfile>("/profiles", "POST", input),
    getFiscalProfiles: (
      environment: FiscalEnvironment,
      provider: FiscalProvider
    ) =>
      json<FiscalProfiles>(
        "/profiles" + query(environment, { provider, operation: "sale" })
      ),
    confirmFiscalProfile: (profileId: string, environment: FiscalEnvironment) =>
      json<FiscalProfile>(`/profiles/${id(profileId)}/confirm`, "POST", {
        environment,
      }),
    getFiscalInvoices: (
      environment: FiscalEnvironment,
      input: {
        state?: FiscalState;
        search?: string;
        page?: number;
        pageSize?: number;
      } = {}
    ) => json<FiscalInvoicePage>("/invoices" + query(environment, input)),
    getFiscalInvoice: (intentId: string, environment: FiscalEnvironment) =>
      json<FiscalInvoiceDetail>(
        `/invoices/${id(intentId)}` + query(environment)
      ),
    reconcileFiscalInvoice: (
      intentId: string,
      environment: FiscalEnvironment
    ) =>
      json<FiscalInvoiceDetail>(`/invoices/${id(intentId)}/reconcile`, "POST", {
        environment,
      }),
    reprocessFiscalInvoice: (
      intentId: string,
      environment: FiscalEnvironment,
      profileVersionId: string
    ) =>
      json<FiscalInvoiceDetail>(`/invoices/${id(intentId)}/reprocess`, "POST", {
        environment,
        profileVersionId,
      }),
    requestFiscalCancellation: (
      intentId: string,
      environment: FiscalEnvironment,
      input: { reviewId: string; confirmed: true; justification: string }
    ) =>
      json<FiscalInvoiceDetail>(
        `/invoices/${id(intentId)}/cancellation`,
        "POST",
        { environment, ...input }
      ),
    async downloadFiscalDocument(
      intentId: string,
      environment: FiscalEnvironment,
      kind: FiscalDocumentKind
    ) {
      try {
        const response = await dashboardFetch(
          base,
          prefix +
            `/invoices/${id(intentId)}/documents/${kind}` +
            query(environment),
          { method: "GET" },
          fetcher
        );
        if (!response.ok)
          throw new DashboardHttpError(response.status, await response.text());
        const type = response.headers.get("content-type")?.split(";")[0];
        if (
          kind === "danfe"
            ? type !== "application/pdf"
            : !["application/xml", "text/xml"].includes(type ?? "")
        )
          throw new FiscalApiError(
            0,
            "unavailable",
            "fiscal_document_response_invalid"
          );
        const blob = await response.blob();
        if (!blob.size)
          throw new FiscalApiError(
            0,
            "unavailable",
            "fiscal_document_response_invalid"
          );
        return {
          blob,
          fileName: kind === "xml" ? "nota-fiscal.xml" : "nota-fiscal.pdf",
        };
      } catch (error) {
        throw safeError(error);
      }
    },
    getFiscalTemplates: () => json<FiscalTemplates>("/templates"),
    saveFiscalTemplate: (
      channel: FiscalChannel,
      input: { body: string; subject?: string; revision: number }
    ) => json<FiscalTemplateRecord>(`/templates/${channel}`, "PUT", input),
    submitFiscalWhatsAppTemplate: () =>
      json<FiscalTemplateRecord>("/templates/whatsapp/submit", "POST"),
  };
}
