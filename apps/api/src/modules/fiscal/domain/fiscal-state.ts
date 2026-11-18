import {
  assertFiscalIdentity,
  type FiscalAuthorization, type FiscalCancellation, type FiscalIdentity, type FiscalProviderDocument, type FiscalState,
} from "./fiscal-provider.js";

export interface FiscalStateRecord {
  readonly identity: FiscalIdentity;
  readonly state: FiscalState;
  readonly remoteInvoiceId?: string;
  readonly remoteOrderId?: string;
  readonly providerStatus?: string;
  readonly authorization?: FiscalAuthorization;
  readonly cancellation?: FiscalCancellation;
  readonly rejectionCode?: string;
}

const authorizationFields = ["number", "series", "accessKey", "protocol", "authorizedAt"] as const;

function validateAuthorization(value: FiscalAuthorization): void {
  if (!value || authorizationFields.some(field => !value[field]?.trim()) || !Number.isFinite(Date.parse(value.authorizedAt))) {
    throw new Error("fiscal_authorization_incomplete");
  }
}

function assertSameAuthorization(original: FiscalAuthorization, incoming: FiscalAuthorization): void {
  if (authorizationFields.some(field => original[field] !== incoming[field])) throw new Error("fiscal_authorized_document_immutable");
}

export function assertFiscalContentMutable(record: FiscalStateRecord): void {
  if (record.authorization || record.state === "authorized" || record.state === "cancelled") {
    throw new Error("fiscal_authorized_document_immutable");
  }
}

export function markFiscalWriteUncertain(record: FiscalStateRecord): FiscalStateRecord {
  return record.authorization || record.state === "cancelled" ? record : { ...record, state: "reconciliation_required" };
}

export function applyFiscalProviderDocument(record: FiscalStateRecord, document: FiscalProviderDocument): FiscalStateRecord {
  assertFiscalIdentity(record.identity, document.identity);
  if (!document.remoteInvoiceId?.trim() || record.remoteInvoiceId && document.remoteInvoiceId !== record.remoteInvoiceId) {
    throw new Error("fiscal_document_mismatch");
  }
  if (record.state === "cancelled") return record;
  if (record.authorization && document.status !== "cancelled") {
    if (document.status === "authorized" && document.verifiedBy === "authenticated_query") {
      validateAuthorization(document.authorization);
      assertSameAuthorization(record.authorization, document.authorization);
    }
    return record;
  }
  if (document.status === "cancelled" && document.verifiedBy !== "authenticated_query") return record;

  const common = { ...record, identity: { ...record.identity }, remoteInvoiceId: document.remoteInvoiceId,
    remoteOrderId: document.remoteOrderId ?? record.remoteOrderId, providerStatus: document.providerStatus };
  if (document.status === "processing") return { ...common, state: "processing" };
  if (document.status === "rejected") {
    if (!document.reasonCode?.trim()) throw new Error("fiscal_rejection_reason_missing");
    return { ...common, state: "rejected", rejectionCode: document.reasonCode };
  }
  if (document.status === "authorized") {
    if (document.verifiedBy !== "authenticated_query") return { ...common, state: "processing" };
    validateAuthorization(document.authorization);
    return { ...common, state: "authorized", authorization: { ...document.authorization }, rejectionCode: undefined };
  }

  const cancellation = document.cancellation;
  if (!cancellation?.protocol?.trim() || !cancellation.cancelledAt?.trim() || !Number.isFinite(Date.parse(cancellation.cancelledAt))) {
    throw new Error("fiscal_cancellation_incomplete");
  }
  const authorization = record.authorization ?? document.authorization;
  if (!authorization) throw new Error("fiscal_authorization_incomplete");
  validateAuthorization(authorization);
  if (record.authorization && document.authorization) assertSameAuthorization(record.authorization, document.authorization);
  return { ...common, state: "cancelled", authorization: { ...authorization }, cancellation: { ...cancellation } };
}
