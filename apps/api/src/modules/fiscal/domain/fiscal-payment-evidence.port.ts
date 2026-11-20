import { fiscalCalendarDate } from "./fiscal-payment-date.js";
import { normalizeFiscalTaxId } from "./fiscal-recipient.js";
import type { FiscalSnapshotRecord } from "./fiscal-sale-snapshot.port.js";
import { readFiscalSnapshotEnvelope } from "./fiscal-sale-snapshot.port.js";

export interface FiscalPaymentBinding {
  merchantId: string; proofRef: string; provider: string; accountId: string; environment: string;
  operationId: string; amountCents: number; currency: string;
}
export interface FiscalPaymentEvidence {
  binding: FiscalPaymentBinding;
  receipt: Omit<FiscalPaymentBinding, "proofRef"> & { captured: boolean; instrument: "credit" | "debit" | "dynamic_pix" | "static_pix" | "boleto" | "crypto";
    acquirerTaxId?: string; authorizationCode?: string; authorizationKind?: "card_authorization" | "pix_end_to_end"; brandCode?: string; nsu?: string; paidAt: string; fiscalDate?: string; fiscalTimeZone?: string; description?: string; evidenceReference: string };
}
/** Private authenticated read of the ORIGINAL persisted approved operation. No buyer supplied receipt. */
export interface FiscalPaymentEvidencePort { read(snapshot: FiscalSnapshotRecord): Promise<FiscalPaymentEvidence | null> }
export interface FiscalAdmittedPayment {
  code: "03" | "04" | "17" | "20" | "15" | "99"; amountCents: number; paidAt: string; fiscalDate?: string; fiscalTimeZone?: string; description?: string; acquirerTaxId?: string;
  authorizationCode?: string; authorizationKind?: "card_authorization" | "pix_end_to_end"; brandCode?: string; nsu?: string; evidenceReference: string;
}
export function admitFiscalPaymentEvidence(snapshot: Pick<FiscalSnapshotRecord, "environment" | "paymentProofRef" | "orderMerchantId" | "currency" | "items" | "subtotalCents" | "discountCents" | "shippingCents" | "totalCents">, value: FiscalPaymentEvidence | null): FiscalAdmittedPayment {
  if (!value) throw new Error("fiscal_payment_evidence_required");
  const { binding, receipt } = value;
  const expectedEnvironment = binding.provider === "crypto" ? snapshot.environment === "production" ? "mainnet" : "testnet" : snapshot.environment === "production" ? "live" : "test";
  if (binding.environment !== expectedEnvironment) throw new Error("fiscal_payment_environment_mismatch");
  if (!snapshot.paymentProofRef || binding.proofRef !== snapshot.paymentProofRef || binding.merchantId !== snapshot.orderMerchantId
    || ![binding.provider, binding.accountId, binding.environment, binding.operationId].every(v => typeof v === "string" && v.length > 0)
    || !Number.isSafeInteger(binding.amountCents) || binding.amountCents <= 0 || binding.currency !== snapshot.currency || receipt.captured !== true
    || (["merchantId", "provider", "accountId", "environment", "operationId", "amountCents", "currency"] as const).some(k => binding[k] !== receipt[k])) throw new Error("fiscal_payment_evidence_mismatch");
  const totals = readFiscalSnapshotEnvelope(snapshot.items).fiscalTotals;
  if (![snapshot.subtotalCents, snapshot.discountCents, snapshot.shippingCents, snapshot.totalCents].every(n => Number.isSafeInteger(n) && n >= 0)
    || snapshot.totalCents !== snapshot.subtotalCents - snapshot.discountCents + snapshot.shippingCents || snapshot.totalCents > binding.amountCents
    || !Number.isSafeInteger(totals.totalCents) || totals.totalCents <= 0 || totals.totalCents > snapshot.totalCents) throw new Error("fiscal_payment_allocation_invalid");
  const codes = { credit: "03", debit: "04", dynamic_pix: "17", static_pix: "20", boleto: "15", crypto: "99" } as const;
  if (!codes[receipt.instrument] || !Number.isFinite(Date.parse(receipt.paidAt)) || !receipt.evidenceReference?.trim()) throw new Error("fiscal_payment_metadata_required");
  const acquirer = normalizeFiscalTaxId(receipt.acquirerTaxId);
  if (["credit", "debit", "dynamic_pix", "static_pix"].includes(receipt.instrument) && (!acquirer || acquirer.length !== 14 || !/^[A-Za-z0-9_.:-]{1,128}$/.test(receipt.authorizationCode ?? "")
    || ["credit", "debit"].includes(receipt.instrument) && !/^\d{2}$/.test(receipt.brandCode ?? ""))) throw new Error("fiscal_payment_metadata_required");
  if (receipt.instrument === "crypto" && (!receipt.description?.trim() || receipt.description.length > 60)) throw new Error("fiscal_payment_crypto_classification_required");
  return { ...(receipt.fiscalTimeZone ? { fiscalTimeZone: receipt.fiscalTimeZone } : {}), ...(receipt.fiscalDate ? { fiscalDate: receipt.fiscalDate } : {}), ...(receipt.description ? { description: receipt.description } : {}), code: codes[receipt.instrument], amountCents: totals.totalCents, paidAt: receipt.paidAt, evidenceReference: receipt.evidenceReference,
    ...(receipt.acquirerTaxId ? { acquirerTaxId: acquirer } : {}), ...(receipt.authorizationCode ? { authorizationCode: receipt.authorizationCode } : {}), ...(receipt.authorizationKind ? { authorizationKind: receipt.authorizationKind } : {}),
    ...(receipt.brandCode ? { brandCode: receipt.brandCode } : {}), ...(receipt.nsu ? { nsu: receipt.nsu } : {}) };
}
export function focusPaymentFields(payment: FiscalAdmittedPayment): Record<string, unknown> {
  const electronic = ["03", "04", "17", "20"].includes(payment.code);
  return { forma_pagamento: payment.code, valor_pagamento: payment.amountCents / 100,
    ...(electronic ? { tipo_integracao: "1", cnpj_credenciadora: payment.acquirerTaxId, numero_autorizacao: payment.authorizationCode,
      ...(["03", "04"].includes(payment.code) ? { bandeira_operadora: payment.brandCode } : {}) } : {}),
    ...(payment.code === "99" ? { descricao_pagamento: payment.description } : {}),
    // Runtime receipts carry the explicitly configured issuer calendar date. Legacy private fixtures retain explicit UTC interpretation.
    data_pagamento: payment.fiscalDate ?? fiscalCalendarDate(payment.paidAt, "UTC") };
}
