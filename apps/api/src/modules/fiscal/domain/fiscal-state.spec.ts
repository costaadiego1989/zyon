import assert from "node:assert/strict";
import test from "node:test";
import { applyFiscalProviderDocument, assertFiscalContentMutable, markFiscalWriteUncertain, type FiscalStateRecord } from "./fiscal-state.js";
import type { FiscalIdentity, FiscalProviderDocument } from "./fiscal-provider.js";

const identity: FiscalIdentity = { merchantId: "seller_a", connectionId: "connection_a", provider: "focus",
  environment: "homologation", issuerTaxId: "12ABC34501DE35", reference: "sale_a" };
const authorization = { number: "17", series: "1", accessKey: "test_access_key", protocol: "test_protocol_17", authorizedAt: "2026-11-14T12:00:00.000Z" };
const base = { identity, remoteInvoiceId: "invoice_a", providerStatus: "processando_autorizacao", verifiedBy: "authenticated_query" as const };
const initial = (): FiscalStateRecord => ({ identity, state: "queued" });
const authorizedDocument = (): FiscalProviderDocument => ({ ...base, status: "authorized", providerStatus: "autorizado", authorization: { ...authorization } });
const authorizedRecord = () => applyFiscalProviderDocument(initial(), authorizedDocument());

test("a provider receipt remains processing without manufactured fiscal identifiers", () => {
  const value = applyFiscalProviderDocument(initial(), { ...base, status: "processing", verifiedBy: "request_response" });
  assert.equal(value.state, "processing");
  assert.equal(value.remoteInvoiceId, "invoice_a");
  assert.equal(value.authorization, undefined);
});

test("an authenticated authorization preserves every returned fiscal identifier", () => {
  const value = authorizedRecord();
  assert.equal(value.state, "authorized");
  assert.deepEqual(value.authorization, authorization);
  assert.deepEqual(value.identity, identity);
  assert.equal(value.providerStatus, "autorizado");
});

test("an unqueried authorized response waits for authenticated reconciliation", () => {
  const value = applyFiscalProviderDocument(initial(), { ...authorizedDocument(), verifiedBy: "request_response" });
  assert.equal(value.state, "processing");
  assert.equal(value.authorization, undefined);
});

test("authorization missing its protocol or identifiers is refused", () => {
  for (const field of ["number", "series", "accessKey", "protocol", "authorizedAt"] as const) {
    assert.throws(() => applyFiscalProviderDocument(initial(), {
      ...base, status: "authorized", authorization: { ...authorization, [field]: "" },
    }), /fiscal_authorization_incomplete/);
  }
  assert.throws(() => applyFiscalProviderDocument(initial(), {
    ...base, status: "authorized", authorization: { ...authorization, authorizedAt: "invalid-date" },
  }), /fiscal_authorization_incomplete/);
});

test("rejection records the normalized reason without storing the complete provider payload", () => {
  const value = applyFiscalProviderDocument(initial(), { ...base, status: "rejected", reasonCode: "sefaz_539" });
  assert.equal(value.state, "rejected");
  assert.equal(value.rejectionCode, "sefaz_539");
  assert.equal(value.authorization, undefined);
  assert.equal("payload" in value, false);
});

test("a stale processing update cannot regress an authorized invoice", () => {
  const original = authorizedRecord();
  const value = applyFiscalProviderDocument(original, { ...base, status: "processing" });
  assert.deepEqual(value, original);
  assert.deepEqual(value.authorization, authorization);
});

test("a stale rejection cannot replace a confirmed authorization", () => {
  const original = authorizedRecord();
  assert.deepEqual(applyFiscalProviderDocument(original, { ...base, status: "rejected", reasonCode: "old_rejection" }), original);
});

test("a cancellation request is not a confirmed fiscal cancellation", () => {
  const original = authorizedRecord();
  const value = applyFiscalProviderDocument(original, { ...base, status: "cancelled", verifiedBy: "request_response",
    cancellation: { protocol: "registered_request", cancelledAt: "2026-11-14T12:30:00.000Z" } });
  assert.deepEqual(value, original);
});

test("confirmed cancellation retains the original authorization and cancellation evidence", () => {
  const cancellation = { protocol: "cancel_protocol_17", cancelledAt: "2026-11-14T12:30:00.000Z" };
  const value = applyFiscalProviderDocument(authorizedRecord(), { ...base, status: "cancelled", cancellation });
  assert.equal(value.state, "cancelled");
  assert.deepEqual(value.authorization, authorization);
  assert.deepEqual(value.cancellation, cancellation);
  assert.deepEqual(applyFiscalProviderDocument(value, authorizedDocument()), value);
});

test("cancellation without fiscal evidence is refused", () => {
  const original = authorizedRecord();
  for (const patch of [{ protocol: "", cancelledAt: "2026-11-14T12:30:00.000Z" }, { protocol: "cancel_17", cancelledAt: "invalid-date" }]) {
    assert.throws(() => applyFiscalProviderDocument(original, { ...base, status: "cancelled", cancellation: patch }), /fiscal_cancellation_incomplete/);
  }
  assert.deepEqual(original.authorization, authorization);
});

test("provider result from another tenant, issuer, reference or invoice is refused", () => {
  for (const patch of [{ merchantId: "seller_b" }, { environment: "production" as const }, { issuerTaxId: "other" }, { reference: "sale_b" }]) {
    assert.throws(() => applyFiscalProviderDocument(initial(), { ...base, identity: { ...identity, ...patch }, status: "processing" }), /fiscal_identity_mismatch/);
  }
  assert.throws(() => applyFiscalProviderDocument(authorizedRecord(), { ...base, remoteInvoiceId: "invoice_other", status: "processing" }), /fiscal_document_mismatch/);
});

test("an uncertain write requires reconciliation while confirmed evidence stays unchanged", () => {
  assert.equal(markFiscalWriteUncertain(initial()).state, "reconciliation_required");
  const original = authorizedRecord();
  assert.deepEqual(markFiscalWriteUncertain(original), original);
});

test("provider response mutation after transition cannot alter stored authorization", () => {
  const document = authorizedDocument();
  const value = applyFiscalProviderDocument(initial(), document);
  if (document.status !== "authorized") throw new Error("fixture_invalid");
  (document.authorization as { protocol: string }).protocol = "changed_later";
  assert.equal(value.authorization?.protocol, "test_protocol_17");
});

test("conflicting authorization cannot overwrite the original confirmed fiscal document", () => {
  const original = authorizedRecord();
  assert.throws(() => applyFiscalProviderDocument(original, { ...base, status: "authorized", authorization: { ...authorization, protocol: "other" } }), /fiscal_authorized_document_immutable/);
  assert.deepEqual(original.authorization, authorization);
});

test("FISCAL-69 authorized content corrections are refused and leave the document unchanged", () => {
  const original = authorizedRecord();
  const before = structuredClone(original);
  assert.throws(() => assertFiscalContentMutable(original), /fiscal_authorized_document_immutable/);
  assert.deepEqual(original, before);
  assert.throws(() => assertFiscalContentMutable({ ...original, state: "action_required" }), /fiscal_authorized_document_immutable/);
  assert.throws(() => assertFiscalContentMutable({ ...original, state: "cancelled" }), /fiscal_authorized_document_immutable/);
  assert.equal(assertFiscalContentMutable(initial()), undefined);
  assert.equal(assertFiscalContentMutable({ ...initial(), state: "rejected" }), undefined);
});
