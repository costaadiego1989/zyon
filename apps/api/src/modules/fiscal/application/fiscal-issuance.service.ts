import type { FiscalProviderFactoryPort, FiscalIssuanceStorePort, FiscalIssuanceSessionPort } from "../domain/fiscal-issuance.port.js";
import { admitFiscalPaymentEvidence, type FiscalPaymentEvidencePort } from "../domain/fiscal-payment-evidence.port.js";
import type { FiscalIntentRecord, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalWriteResult } from "../domain/fiscal-provider.js";
import { fiscalProviderEmailDecision } from "../domain/fiscal-provider-email.js";

/** Durable admission precedes every adapter write. Remote IO never runs inside the persistence transaction. */
export class FiscalIssuanceService {
  constructor(private readonly store: FiscalIssuanceStorePort, private readonly providers: FiscalProviderFactoryPort, private readonly payments: FiscalPaymentEvidencePort) {}
  reprocess(scope: FiscalTenant, id: string, profileId: string, actor: { actorKind: string; actorId: string; permission: string }) { return this.store.reprocess(scope, id, profileId, actor); }
  private async accepted<T>(session: FiscalIssuanceSessionPort, result: FiscalWriteResult<T>): Promise<T | null> {
    if (result.outcome === "accepted") return result.value;
    if (result.outcome === "unknown") await session.pending("reconciliation_required", "fiscal_write_outcome_unknown");
    else if (result.retryAfterMs || result.reasonCode === "fiscal_order_discovery_in_progress") await session.pending("queued", result.reasonCode, result.retryAfterMs ?? 1000);
    else await session.pending("action_required", result.reasonCode);
    return null;
  }
  async run(claim: FiscalIntentRecord): Promise<void> {
    const session = await this.store.open(claim); const { context } = session; const identity = context.identity;
    try {
      if (!context.orderScopeSupported) throw new Error("fiscal_order_scope_unsupported");
      if (context.connection.disconnectedAt) { await session.pending("action_required", "fiscal_reauthorization_required"); return; }
      let revision = await session.revision();
      if (!revision) {
        const evidence = await this.payments.read(context.snapshot);
        const payment = admitFiscalPaymentEvidence(context.snapshot, evidence);
        const issuedAt = this.store.clock().toISOString();
        const payload = this.providers.build(context, issuedAt, payment);
        revision = await session.freeze(payload, evidence!, issuedAt);
      }
      const payload = revision.payload as Readonly<Record<string, unknown>>;
      const provider = this.providers.create(context, payload, session.journal);
      if (provider.provider !== identity.provider) throw new Error("fiscal_identity_mismatch");
      const submitted = await session.journal.read(identity, "invoice.submit");
      const existing = await provider.findByReference(identity);
      // Only an explicitly admitted correction revision may bypass the prior authenticated rejection.
      const correcting = context.intent.issuanceRevision > 1 && !submitted && existing.found && existing.document.status === "rejected";
      if (existing.found && !correcting) { await session.persist(existing.document); return; }
      for (const stage of await session.stages()) {
        if (!stage) continue;
        const reconciled = await provider.reconcileStage(identity, stage);
        if (!reconciled.found || !await session.journal.finish({ ...stage, ...reconciled, outcome: "accepted" })) { await session.pending("reconciliation_required", "fiscal_write_outcome_unknown"); return; }
      }
      let remoteOrderId = context.intent.remoteOrderId ?? undefined; let remoteInvoiceId = context.intent.remoteInvoiceId ?? undefined;
      if (provider.capabilities.salesOrder) {
        const order = await this.accepted(session, await provider.ensureOrder(identity, payload)); if (!order) return; remoteOrderId = order.id;
        if (order.invoiceId) remoteInvoiceId = order.invoiceId;
        const generated = await this.accepted(session, await provider.generate(identity, order)); if (!generated) return;
        if ("remoteInvoiceId" in generated) remoteInvoiceId = generated.remoteInvoiceId;
        else remoteOrderId = generated.remoteOrderId;
      }
      const result = await this.accepted(session, await provider.submit(identity, { payload, ...(remoteOrderId ? { remoteOrderId } : {}), ...(remoteInvoiceId ? { remoteInvoiceId } : {}), sendEmail: fiscalProviderEmailDecision(context.envelope).requested }));
      if (result) await session.persist(result);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const code = /^erp_bling_(?:reauthorization_required|app_changed|app_configuration_invalid)$/.test(raw) ? "fiscal_erp_reconnect_required" : /^fiscal_[a-z0-9_]{1,100}$/.test(raw) ? raw : "fiscal_provider_unavailable";
      if (code === "fiscal_claim_lost") return;
      const uncertain = (await session.stages()).length > 0 || !!context.intent.writeStartedAt || !!context.intent.remoteInvoiceId;
      const retryable = code === "fiscal_credential_refresh_temporarily_unavailable" || !!(error && typeof error === "object" && "retryable" in error && error.retryable === true);
      await session.pending(uncertain ? "reconciliation_required" : retryable ? "queued" : "action_required", code);
    }
  }
}
