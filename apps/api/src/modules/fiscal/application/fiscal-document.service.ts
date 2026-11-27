import type { FiscalArtifactPort } from "../domain/fiscal-artifact.port.js";
import type { FiscalDocumentAccessPort, FiscalDocumentActor, FiscalDocumentProjection } from "../domain/fiscal-document-access.port.js";
import type { FiscalIssuanceStorePort, FiscalProviderFactoryPort } from "../domain/fiscal-issuance.port.js";
import type { FiscalDocumentKind } from "../domain/fiscal-provider.js";
import type { FiscalTenant } from "../domain/fiscal-repository.port.js";

export class FiscalDocumentService {
  constructor(private readonly access: FiscalDocumentAccessPort, private readonly artifacts: FiscalArtifactPort, private readonly issuance: FiscalIssuanceStorePort, private readonly providers: FiscalProviderFactoryPort) {}
  private projection(row: FiscalDocumentProjection) {
    const doc = row.document; const confirmed = !!doc?.authorizationProtocol && ["authorized", "cancelled"].includes(doc.state);
    return { intentId: row.intentId, sellerMerchantId: row.merchantId, orderId: row.orderId, state: confirmed ? doc!.state : row.state, documentState: doc?.documentState ?? "document_pending",
      ...(confirmed ? { number: doc!.number!, series: doc!.series!, accessKey: doc!.accessKey!, authorizationProtocol: doc!.authorizationProtocol!, authorizedAt: doc!.authorizedAt!.toISOString(),
        ...(doc!.cancellationProtocol ? { cancellationProtocol: doc!.cancellationProtocol, cancelledAt: doc!.cancelledAt!.toISOString() } : {}) } : {}),
      documents: (["xml", "danfe"] as const).map(kind => ({ kind, available: confirmed && !!doc!.artifacts.find(artifact => artifact.kind === kind) })) };
  }
  async forIntent(actor: FiscalDocumentActor, scope: FiscalTenant, id: string) {
    const row = await this.access.find(actor, scope, id); if (!row) throw new Error("fiscal_document_not_found"); return this.projection(row);
  }
  async forOrder(actor: FiscalDocumentActor, input: FiscalTenant & { orderId: string }) {
    const rows = await this.access.order(actor, input); if (!rows) throw new Error("fiscal_document_not_found"); return rows.map(row => this.projection(row));
  }
  /** Trusted durable worker/outbox path. It can only recover existing authorized documents. */
  async recover(scope: FiscalTenant, id: string, kinds: readonly FiscalDocumentKind[] = ["xml", "danfe"]) {
    const row = await this.access.internal(scope, id); if (!row?.document || !row.document.authorizationProtocol || !["authorized", "cancelled"].includes(row.document.state)) return { complete: false, reasonCode: "fiscal_document_pending" };
    let provider: ReturnType<FiscalProviderFactoryPort["create"]> | undefined; let failed = false;
    for (const kind of kinds) {
      try {
        if (await this.artifacts.get(scope, row.document.id, kind)) continue;
        if (!provider) { const session = await this.issuance.readOnly(scope, id); if (session.context.connection.disconnectedAt) throw new Error("fiscal_reauthorization_required"); const revision = await session.revision(); if (!revision) throw new Error("fiscal_issuance_context_required"); provider = this.providers.create(session.context, revision.payload as Readonly<Record<string, unknown>>, session.journal); }
        await this.artifacts.capture(scope, row.document.id, provider, kind);
      } catch { failed = true; }
    }
    const latest = await this.access.internal(scope, id); const complete = !failed && ["xml", "danfe"].every(kind => latest?.document?.artifacts.some(artifact => artifact.kind === kind));
    await this.access.documentState(scope, row.document.id, complete ? "available" : "document_pending");
    return { complete, ...(!complete ? { reasonCode: "fiscal_document_pending" } : {}) };
  }
  async download(actor: FiscalDocumentActor, scope: FiscalTenant, id: string, kind: FiscalDocumentKind) {
    const row = await this.access.find(actor, scope, id); if (!row) throw new Error("fiscal_document_not_found");
    if (!["xml", "danfe"].includes(kind)) throw new Error("fiscal_document_kind_invalid");
    if (!row.document?.authorizationProtocol || !["authorized", "cancelled"].includes(row.document.state)) throw new Error("fiscal_document_pending");
    let artifact = await this.artifacts.get(scope, row.document.id, kind);
    if (!artifact) { await this.recover(scope, id, [kind]); artifact = await this.artifacts.get(scope, row.document.id, kind); }
    if (!artifact) throw new Error("fiscal_document_pending"); return artifact;
  }
}
