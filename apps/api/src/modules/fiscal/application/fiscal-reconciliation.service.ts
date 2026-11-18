import type { FiscalIssuanceStorePort, FiscalProviderFactoryPort } from "../domain/fiscal-issuance.port.js";
import type { FiscalIntentRecord, FiscalTenant } from "../domain/fiscal-repository.port.js";
import type { FiscalStockEvidencePort, FiscalStockEffectEvidence } from "../domain/fiscal-stock-evidence.port.js";
import type { FiscalStockPort } from "../domain/fiscal-stock.port.js";
import { assertFiscalIdentity } from "../domain/fiscal-provider.js";

export class FiscalReconciliationService {
  constructor(private readonly store: FiscalIssuanceStorePort, private readonly providers: FiscalProviderFactoryPort, private readonly effects: FiscalStockEvidencePort, private readonly stock: FiscalStockPort) {}
  async reconcile(scope: FiscalTenant, id: string) {
    const claim = await this.store.claimForQuery(scope, id); if (!claim) throw new Error("fiscal_intent_not_found_or_busy"); return this.process(claim);
  }
  async run(claim: FiscalIntentRecord): Promise<void> { await this.process(claim); }
  private async process(claim: FiscalIntentRecord): Promise<{ retryable: boolean }> {
    const session = await this.store.open(claim); const { context } = session; const terminal = ["authorized", "cancelled"].includes(context.intent.state);
    const pending = async (code: string) => terminal ? session.finishRead(code) : session.pending(code === "fiscal_reauthorization_required" ? "action_required" : "reconciliation_required", code);
    try {
      const release = terminal && context.intent.state === "authorized" ? await session.releaseEvidence() : null;
      if (release) {
        try { await this.stock.release({ merchantId: claim.merchantId, environment: claim.environment }, claim.id, release); await session.finishRead(); }
        catch (error) { await session.finishRead(error instanceof Error && /^fiscal_stock_[a-z_]+$/.test(error.message) ? error.message : "fiscal_stock_release_pending"); }
        return { retryable: false };
      }
      if (context.connection.disconnectedAt) { await pending("fiscal_reauthorization_required"); return { retryable: false }; }
      const revision = await session.revision(); if (!revision) { await pending("fiscal_issuance_context_required"); return { retryable: false }; }
      const payload = revision.payload as Readonly<Record<string, unknown>>; const provider = this.providers.create(context, payload, session.journal);
      const result = await provider.query(context.identity, context.intent.remoteInvoiceId ?? undefined);
      if (!result.found) { await pending("fiscal_provider_document_not_found"); return { retryable: false }; }
      assertFiscalIdentity(context.identity, result.document.identity);
      if (result.document.verifiedBy !== "authenticated_query") { await pending("fiscal_authenticated_query_required"); return { retryable: false }; }
      let evidence: FiscalStockEffectEvidence | undefined; let stockReason: string | undefined;
      if (result.document.status === "authorized" && context.envelope.policy.stockOwner === "provider") {
        const originalOrderId = result.document.remoteOrderId ?? context.intent.remoteOrderId;
        const effect = originalOrderId ? await this.effects.read(context, payload, result.document.remoteInvoiceId, originalOrderId) : { found: false as const, reasonCode: "fiscal_stock_order_binding_required" };
        if (!effect.found) stockReason = effect.reasonCode;
        else {
          try {
            assertFiscalIdentity(context.identity, effect.evidence.identity); const binding = await this.stock.binding({ merchantId: claim.merchantId, environment: claim.environment }, claim.id);
            if (effect.evidence.intentId !== claim.id || effect.evidence.snapshotHash !== context.snapshot.contentHash || effect.evidence.remoteInvoiceId !== result.document.remoteInvoiceId
              || context.intent.remoteOrderId && effect.evidence.remoteOrderId !== context.intent.remoteOrderId || !effect.evidence.evidenceReference || effect.evidence.lines.length !== binding.lines.length
              || binding.lines.some(line => effect.evidence.lines.filter(x => x.sku === line.sku).reduce((n, x) => n + x.quantity, 0) !== line.quantity)) throw new Error("fiscal_stock_evidence_mismatch");
            evidence = effect.evidence;
          } catch { stockReason = "fiscal_stock_evidence_mismatch"; }
        }
      }
      // A stale processing/rejected response cannot change an already confirmed terminal result.
      if (terminal && result.document.status !== "cancelled" && !evidence) { await session.finishRead(stockReason); return { retryable: false }; }
      try { if (!await session.persist(result.document, evidence, stockReason)) return { retryable: true }; }
      catch { await pending("fiscal_reconciliation_persistence_failed"); return { retryable: true }; }
      return { retryable: false };
    } catch (error) {
      const raw = error instanceof Error ? error.message : ""; await pending(/^fiscal_[a-z0-9_]{1,100}$/.test(raw) ? raw : "fiscal_provider_query_failed"); return { retryable: true };
    }
  }
}
