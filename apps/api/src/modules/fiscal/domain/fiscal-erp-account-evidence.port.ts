import type { FiscalScope } from "./fiscal-provider.js";
export interface FiscalErpEffectPolicy { version: string; profileVersionId: string; stockOwner: string; emailOwner: string; whatsappOwner: string }
/** Read only from the protected onboarding store. Public request flags are never evidence. */
export interface FiscalErpAccountEvidence {
  scope: FiscalScope; policyVersion: string; profileVersionId: string; source: "responsible_confirmation";
  confirmedBy: string; confirmationPermission: "fiscal.configure"; confirmedAt: string; expiresAt: string;
  certificateValidUntil: string;
  fiscalConfigurationFingerprint?: string;
  effects: { stockOnSave: boolean; stockOnAuthorize: boolean; stockOnCancel: boolean;
    accountsOnSave: boolean; accountsOnAuthorize: boolean; accountsOnCancel: boolean; automaticEmail: boolean;
    automaticInvoiceGeneration?: boolean; automaticInvoiceAuthorization?: boolean };
}
export interface FiscalErpAccountEvidencePort { read(scope: FiscalScope): Promise<FiscalErpAccountEvidence | null> }
/** Normalized permissions come from the validated credential grant, separately from responsible confirmation. */
export interface FiscalCredentialAuthorization {
  scope: FiscalScope; evidenceReference: string; permissions: readonly ("fiscal_read" | "fiscal_write" | "order_write" | "contact_write")[];
}
export interface FiscalCredentialAuthorizationPort { read(scope: FiscalScope): Promise<FiscalCredentialAuthorization | null> }
export function validErpAccountEvidenceBinding(value: FiscalErpAccountEvidence | null, scope: FiscalScope, policy: FiscalErpEffectPolicy): value is FiscalErpAccountEvidence {
  if (!policy.version?.trim() || !policy.profileVersionId?.trim() || !["zyon", "provider"].includes(policy.stockOwner) || !["zyon", "provider"].includes(policy.emailOwner)
    || !value || value.source !== "responsible_confirmation" || value.confirmationPermission !== "fiscal.configure" || !value.confirmedBy?.trim()
    || !Number.isFinite(Date.parse(value.confirmedAt)) || Date.parse(value.confirmedAt) > Date.now() || Date.parse(value.expiresAt) <= Date.now()
    || !Number.isFinite(Date.parse(value.expiresAt)) || value.policyVersion !== policy.version || value.profileVersionId !== policy.profileVersionId
    || ["merchantId", "connectionId", "provider", "environment", "issuerTaxId"].some(key => value.scope[key as keyof FiscalScope] !== scope[key as keyof FiscalScope])) return false;
  return true;
}
export function validErpAccountEvidence(value: FiscalErpAccountEvidence | null, scope: FiscalScope, policy: FiscalErpEffectPolicy) {
  if (!validErpAccountEvidenceBinding(value, scope, policy)) return false;
  const effects = value.effects;
  return effects && effects.stockOnSave === false && effects.stockOnAuthorize === (policy.stockOwner === "provider") && effects.stockOnCancel === false
    && effects.accountsOnSave === false && effects.accountsOnAuthorize === false && effects.accountsOnCancel === false && effects.automaticEmail === false;
}
