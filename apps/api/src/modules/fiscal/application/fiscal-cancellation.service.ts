import type { PrismaClient } from "@prisma/client";
import { recordFiscalCommercialChange } from "../../../shared/persistence/fiscal-commercial-change.js";
import type { FiscalIssuanceStorePort, FiscalProviderFactoryPort } from "../domain/fiscal-issuance.port.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";
import { assertFiscalIdentity, fiscalProviderCapabilities } from "../domain/fiscal-provider.js";
export interface FiscalCancellationActor { merchantId: string; actorId: string; permissions: readonly string[] }
export class FiscalCancellationService {
  constructor(private readonly prisma: PrismaClient, private readonly store: FiscalIssuanceStorePort, private readonly providers: FiscalProviderFactoryPort) {}
  /** Trusted commercial event consumer only. Refunds never invoke requestCancellation. */
  async commercialChange(scope: FiscalTenant, intentId: string, trigger: { id: string; kind: "cancelled" | "refund" | "partial_refund" }) {
    if (!/^[A-Za-z0-9_.:-]{1,200}$/.test(trigger.id) || !["cancelled", "refund", "partial_refund"].includes(trigger.kind)) throw new Error("fiscal_commercial_trigger_invalid");
    return this.prisma.$transaction(tx => recordFiscalCommercialChange(tx, scope, intentId, trigger, this.store.clock));
  }

  private async review(scope: FiscalTenant, reviewId: string) { const row = await this.prisma.fiscalCancellationReview.findFirst({ where: { ...scope, id: reviewId }, include: { document: { include: { intent: true } } } }); if (!row) throw new Error("fiscal_document_not_found"); return row; }
  private async pending(scope: FiscalTenant, reviewId: string, reason: string, state = "action_required") { await this.prisma.fiscalCancellationReview.updateMany({ where: { ...scope, id: reviewId, reviewState: { not: "cancelled" } }, data: { reviewState: state, safeReasonCode: reason } }); return this.review(scope, reviewId); }
  async request(scope: FiscalTenant, reviewId: string, actor: FiscalCancellationActor, confirmation: { confirmed: boolean; justification: string }) {
    if (actor.merchantId !== scope.merchantId || !actor.actorId?.trim() || !actor.permissions.includes("fiscal.cancel")) throw new Error("fiscal_cancellation_not_allowed");
    if (confirmation.confirmed !== true || typeof confirmation.justification !== "string" || confirmation.justification.trim().length < 15 || confirmation.justification.trim().length > 255 || /[\u0000-\u001f]/.test(confirmation.justification)) throw new Error("fiscal_cancellation_confirmation_required");
    const review = await this.review(scope, reviewId); const { document } = review; const id = document.intentId;
    if (document.state === "cancelled") return this.pending(scope, reviewId, "fiscal_cancellation_confirmed", "cancelled");
    if (review.triggerKind === "partial_refund") return this.pending(scope, reviewId, "fiscal_partial_refund_requires_review");
    const read = await this.store.readOnly(scope, id);
    if (fiscalProviderCapabilities(read.context.identity.provider).cancellation === "erp_panel") return { ...await this.pending(scope, reviewId, "fiscal_cancellation_erp_panel"), allowedAction: { kind: "erp_panel", label: "Cancelar no ERP" } };
    if (read.context.connection.disconnectedAt) return this.pending(scope, reviewId, "fiscal_reauthorization_required");
    const revision = await read.revision(); if (!revision) return this.pending(scope, reviewId, "fiscal_issuance_context_required");
    const provider = this.providers.create(read.context, revision.payload as Readonly<Record<string, unknown>>, read.journal);
    try {
      const result = await provider.query(read.context.identity, document.intent.remoteInvoiceId ?? undefined);
      if (!result.found || result.document.status !== "authorized" || result.document.verifiedBy !== "authenticated_query") return this.pending(scope, reviewId, "fiscal_cancellation_eligibility_unverified");
      assertFiscalIdentity(read.context.identity, result.document.identity);
      const auth = result.document.authorization;
      if (result.document.remoteInvoiceId !== document.intent.remoteInvoiceId || auth.accessKey !== document.accessKey || auth.protocol !== document.authorizationProtocol || auth.number !== document.number || auth.series !== document.series || Date.parse(auth.authorizedAt) !== document.authorizedAt?.getTime()) return this.pending(scope, reviewId, "fiscal_cancellation_identity_mismatch");
    } catch { return this.pending(scope, reviewId, "fiscal_cancellation_eligibility_unverified"); }
    const claim = await this.store.claimForCancellation(scope, id, reviewId, { actorId: actor.actorId, justification: confirmation.justification.trim() });
    if (!claim) return this.pending(scope, reviewId, "fiscal_cancellation_reconciliation_required", "reconciliation_required");
    const session = await this.store.open(claim); const confirmed = await this.review(scope, reviewId);
    let result;
    try { result = await this.providers.create(session.context, revision.payload as Readonly<Record<string, unknown>>, session.journal).requestCancellation(session.context.identity, { remoteInvoiceId: document.intent.remoteInvoiceId!, justification: confirmed.justification!, requestedAt: confirmed.confirmedAt!.toISOString(), restoreStock: false, reverseAccounts: false, cancelSale: false }); }
    catch { await session.finishRead("fiscal_cancellation_reconciliation_required"); return this.pending(scope, reviewId, "fiscal_cancellation_reconciliation_required", "reconciliation_required"); }
    if (result.outcome === "accepted") {
      if (!await session.persist(result.value)) return this.pending(scope, reviewId, "fiscal_cancellation_reconciliation_required", "reconciliation_required");
      await this.prisma.fiscalCancellationReview.updateMany({ where: { ...scope, id: reviewId }, data: { providerRequestRef: document.intent.remoteInvoiceId, reviewState: "pending", safeReasonCode: "fiscal_cancellation_requested" } });
      return this.review(scope, reviewId);
    }
    await session.finishRead(result.reasonCode);
    return this.pending(scope, reviewId, result.outcome === "unknown" ? "fiscal_cancellation_reconciliation_required" : result.reasonCode, result.outcome === "unknown" ? "reconciliation_required" : "action_required");
  }
  async reconcile(scope: FiscalTenant, reviewId: string) {
    const review = await this.review(scope, reviewId); const id = review.document.intentId;
    const claim = await this.store.claimForQuery(scope, id); if (!claim) throw new Error("fiscal_cancellation_reconciliation_pending");
    const session = await this.store.open(claim); const revision = await session.revision();
    try {
      if (!revision) throw new Error("fiscal_issuance_context_required");
      const result = await this.providers.create(session.context, revision.payload as Readonly<Record<string, unknown>>, session.journal).query(session.context.identity, review.document.intent.remoteInvoiceId ?? undefined);
      if (result.found && session.context.identity.provider === "bling" && result.document.status === "processing" && result.document.providerStatus === "2") {
        await session.finishRead("fiscal_cancellation_verification_pending");
        return this.pending(scope, reviewId, "fiscal_cancellation_verification_pending");
      }
      if (!result.found || !await session.persist(result.document)) throw new Error("fiscal_cancellation_reconciliation_pending");
      const document = await this.prisma.fiscalDocument.findUniqueOrThrow({ where: { id: review.documentId } });
      if (document.state === "cancelled" && document.cancellationProtocol) await this.prisma.fiscalCancellationReview.updateMany({ where: { ...scope, documentId: document.id }, data: { reviewState: "cancelled", safeReasonCode: "fiscal_cancellation_confirmed" } });
      return this.review(scope, reviewId);
    } catch { await session.finishRead("fiscal_cancellation_reconciliation_required"); throw new Error("fiscal_cancellation_reconciliation_pending"); }
  }
}
