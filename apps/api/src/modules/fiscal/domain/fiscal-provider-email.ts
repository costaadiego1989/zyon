import type { FiscalProvider } from "./fiscal-provider.js";
import type { FiscalProviderStageRecord } from "./fiscal-provider-stage.port.js";
import type { FiscalSnapshotEnvelope } from "./fiscal-sale-snapshot.port.js";
import { validateFiscalRecipient } from "./fiscal-recipient.js";

/** Frozen channel ownership and original buyerContacts only; the fiscal recipient is unrelated. */
export function fiscalProviderEmailDecision(envelope: FiscalSnapshotEnvelope) {
  const owner = envelope.policy.emailOwner;
  if (owner !== "provider") return { owner, requested: false };
  const email = envelope.buyerContacts?.email;
  if (!email?.trim()) return { owner, requested: false, reasonCode: "fiscal_email_destination_unavailable" };
  return validateFiscalRecipient({ email }, ["email"]).valid ? { owner, requested: true }
    : { owner, requested: false, reasonCode: "fiscal_email_destination_invalid" };
}

/** Reconstituted after restart from immutable snapshot + durable submit receipt.
 * Inclusion in the NF request is never message acceptance or delivery evidence. */
export function restoreFiscalProviderEmailRequest(envelope: FiscalSnapshotEnvelope, stage: FiscalProviderStageRecord | null, provider: FiscalProvider) {
  const decision = fiscalProviderEmailDecision(envelope); const metadata = stage?.relatedIds;
  if (metadata?.emailOwner && metadata.emailOwner !== decision.owner) throw new Error("fiscal_email_ownership_mismatch");
  if (!decision.requested) return { ...decision, included: false };
  const requested = (metadata?.sendEmail ?? metadata?.requested) === "true";
  const included = stage?.outcome === "accepted" && requested
    && (provider === "omie" ? metadata?.sendEmail === "true" : (metadata?.includedEmail ?? metadata?.included) === "true");
  return { ...decision, included, ...(!included ? { reasonCode: stage?.outcome === "accepted" ? "fiscal_provider_email_destination_mismatch" : "fiscal_provider_email_request_unconfirmed" } : {}),
    ...(stage?.payloadHash ? { evidenceReference: "invoice.submit:" + stage.payloadHash } : {}) };
}
