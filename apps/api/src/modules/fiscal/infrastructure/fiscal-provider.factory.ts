import type { FiscalIssuanceContext, FiscalProviderFactoryPort } from "../domain/fiscal-issuance.port.js";
import type { FiscalAdmittedPayment } from "../domain/fiscal-payment-evidence.port.js";
import { focusPaymentFields } from "../domain/fiscal-payment-evidence.port.js";
import { fiscalProviderEmailDecision } from "../domain/fiscal-provider-email.js";
import { validateFiscalRecipient } from "../domain/fiscal-recipient.js";
import type { FiscalProviderStageJournal } from "../domain/fiscal-provider-stage.port.js";
import type { FiscalScope } from "../domain/fiscal-provider.js";
import type { FiscalCredentialAuthorizationPort, FiscalErpAccountEvidencePort } from "../domain/fiscal-erp-account-evidence.port.js";
import { FocusFiscalAdapter } from "./providers/focus-fiscal.adapter.js";
import { BlingFiscalAdapter } from "./providers/bling-fiscal.adapter.js";
import { OmieFiscalAdapter } from "./providers/omie-fiscal.adapter.js";
import { OlistFiscalAdapter } from "./providers/olist-fiscal.adapter.js";
import { buildBlingFiscalPayload } from "./providers/bling-fiscal.payload.js";
import { buildFocusFiscalPayload } from "./providers/focus-fiscal.payload.js";
import { buildOmieFiscalPayload, type OmieFiscalPayload } from "./providers/omie-fiscal.payload.js";
import { buildOlistFiscalPayload, type OlistFiscalPayload } from "./providers/olist-fiscal.payload.js";

export class FiscalProviderFactory implements FiscalProviderFactoryPort {
  constructor(private readonly options: { credential(scope: FiscalScope): Promise<string>; authorization: FiscalCredentialAuthorizationPort;
    accountEvidence: FiscalErpAccountEvidencePort; policyVersion?: (context: FiscalIssuanceContext) => string; fetch?: typeof fetch }) {}
  build(context: FiscalIssuanceContext, issuedAt: string, payment: FiscalAdmittedPayment) {
    const { identity, profile, envelope } = context;
    const email = validateFiscalRecipient({ email: envelope.buyerContacts?.email }, ["email"]);
    const snapshot = { ...context.snapshot, items: { ...envelope, profileVersionId: profile.id,
      buyerContacts: { ...envelope.buyerContacts, email: email.valid ? email.recipient.email : undefined } } }; const sendEmail = fiscalProviderEmailDecision(envelope).requested;
    if (identity.provider === "focus") return { ...buildFocusFiscalPayload({ snapshot, profile, issuerTaxId: identity.issuerTaxId, issuedAt }), formas_pagamento: [focusPaymentFields(payment)] };
    if (identity.provider === "bling") {
      const mapping = (profile.itemRules as { paymentMappings?: Record<string, { id: number; code: string }> }).paymentMappings?.[payment.code];
      if (!mapping || mapping.code !== payment.code || !Number.isSafeInteger(mapping.id) || mapping.id <= 0) throw new Error("fiscal_payment_mapping_required");
      const payload = buildBlingFiscalPayload({ identity, snapshot, profile, issuedAt, timeZone: payment.fiscalTimeZone });
      return { ...payload, payment: { id: mapping.id, code: payment.code, ...(payment.authorizationCode ? { caut: payment.authorizationCode } : {}), acquirerTaxId: payment.acquirerTaxId, brandCode: payment.brandCode },
        order: { ...payload.order, parcelas: [{ dataVencimento: payment.fiscalDate ?? focusPaymentFields(payment).data_pagamento, valor: payment.amountCents / 100, ...(payment.authorizationCode ? { caut: payment.authorizationCode } : {}), formaPagamento: { id: mapping.id } }] } };
    }
    if (payment.fiscalTimeZone && (profile.itemRules as { operation?: { timeZone?: string } })?.operation?.timeZone !== payment.fiscalTimeZone) throw new Error("fiscal_payment_timezone_mismatch");
    const omieTransactionId = payment.nsu ?? (["card_authorization", "pix_end_to_end"].includes(payment.authorizationKind ?? "") ? payment.authorizationCode : undefined);
    // Omie names the XML cAut transaction field NSU/TID and explicitly documents Pix E2E in that field. Private evidence keeps its original semantic kind.
    if (identity.provider === "omie" && ["03", "04", "17", "20"].includes(payment.code) && !omieTransactionId) throw new Error("fiscal_payment_metadata_required");
    if (identity.provider === "omie") return buildOmieFiscalPayload({ identity, snapshot, profile, issuedAt, sendEmail,
      fiscalPayment: { code: payment.code, ...(payment.description ? { description: payment.description } : {}), ...(omieTransactionId ? { nsu: omieTransactionId } : {}) } });
    const maps = (profile.itemRules as { paymentMappings?: Record<string, { formaRecebimentoId: number; meioPagamentoId: number; code: string }> }).paymentMappings;
    const mapping = maps?.[payment.code];
    if (!mapping || mapping.code !== payment.code) throw new Error("fiscal_payment_mapping_required");
    const payload = buildOlistFiscalPayload({ identity, snapshot, profile, issuedAt, fiscalPayment: mapping });
    return { ...payload, order: { ...payload.order, ...(["03", "04", "17", "20"].includes(payment.code) ? { pagamentosIntegrados: [{ valor: payment.amountCents / 100, tipoPagamento: Number(payment.code),
      ...(payment.acquirerTaxId ? { cnpjIntermediador: payment.acquirerTaxId } : {}), ...(payment.authorizationCode ? { codigoAutorizacao: payment.authorizationCode } : {}), ...(payment.brandCode ? { codigoBandeira: Number(payment.brandCode) } : {}) }] } : {}) } };
  }
  create(context: FiscalIssuanceContext, payload: Readonly<Record<string, unknown>>, journal: FiscalProviderStageJournal) {
    const { identity, envelope, profile } = context;
    const version = identity.provider === "focus" ? "direct" : this.options.policyVersion?.(context);
    if (!version) throw new Error("fiscal_effect_policy_version_required");
    const policy = { ...envelope.policy, version, profileVersionId: profile.id };
    const options = { scope: identity, credential: () => this.options.credential(identity), journal, fetch: this.options.fetch,
      policy, authorization: this.options.authorization, accountEvidence: this.options.accountEvidence };
    switch (identity.provider) {
      case "focus": return new FocusFiscalAdapter(options);
      case "bling": return new BlingFiscalAdapter(options);
      case "omie": return new OmieFiscalAdapter({ ...options, expectedPayload: payload as OmieFiscalPayload });
      case "tiny": return new OlistFiscalAdapter({ ...options, credentialVersion: "v3", expectedPayload: payload as OlistFiscalPayload });
    }
  }
}
