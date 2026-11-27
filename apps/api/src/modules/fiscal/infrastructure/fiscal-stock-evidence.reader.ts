import type { FiscalIssuanceContext } from "../domain/fiscal-issuance.port.js";
import type { FiscalScope } from "../domain/fiscal-provider.js";
import type { FiscalStockEvidencePort, FiscalStockEvidenceResult } from "../domain/fiscal-stock-evidence.port.js";
import { FiscalHttpTransport, remoteId } from "./providers/provider-http.transport.js";
import { fiscalObjectFingerprint, omieDate } from "./providers/omie-fiscal.payload.js";

/** Documented operation-specific READS only. The provider-owned effect is never inferred from NF status or saldo. */
export class FiscalStockEvidenceReader implements FiscalStockEvidencePort {
  constructor(private readonly options: { credential(scope: FiscalScope): Promise<string>; fetch?: typeof fetch;
    olistOrigin(scope: FiscalScope): Promise<{ objectType: string; source: "verified_provider_contract"; evidenceReference: string } | null> }) {}
  async read(context: FiscalIssuanceContext, payload: Readonly<Record<string, unknown>>, invoice: string, order?: string): Promise<FiscalStockEvidenceResult> {
    const pending = (reasonCode = "fiscal_stock_evidence_pending") => ({ found: false as const, reasonCode });
    if (context.envelope.policy.stockOwner !== "provider") return pending("fiscal_stock_owned_by_zyon");
    if (!["omie", "tiny"].includes(context.identity.provider)) return pending("fiscal_stock_movement_contract_unverified");
    if (!order || !invoice || context.intent.remoteOrderId && context.intent.remoteOrderId !== order || context.intent.remoteInvoiceId && context.intent.remoteInvoiceId !== invoice) return pending("fiscal_stock_evidence_mismatch");
    const quantities = new Map<string, number>();
    for (const line of context.envelope.commercialLines.filter(l => !["digital", "service"].includes(l.productType))) quantities.set(line.sku, (quantities.get(line.sku) ?? 0) + line.quantity);
    const products = payload.products as { id: number; sku: string }[] | undefined;
    if (!products?.length || [...quantities.keys()].some(sku => !products.some(p => p.sku === sku && Number.isSafeInteger(p.id) && p.id > 0))) return pending("fiscal_stock_product_binding_required");
    const origin = context.identity.provider === "tiny" ? await this.options.olistOrigin(context.identity) : null;
    if (context.identity.provider === "tiny" && (!origin?.objectType || origin.source !== "verified_provider_contract" || !origin.evidenceReference)) return pending("fiscal_stock_origin_contract_unverified");
    const omie = context.identity.provider === "omie";
    if (omie && typeof payload.timeZone !== "string") return pending("fiscal_stock_timezone_required");
    const http = new FiscalHttpTransport({ scope: context.identity, credential: () => this.options.credential(context.identity), fetch: this.options.fetch }, omie ? "https://app.omie.com.br" : "https://api.tiny.com.br/public-api/v3", "bearer");
    const receipts: { sku: string; movementId: string; quantity: number }[] = [];
    for (const [sku, quantity] of quantities) {
      const candidates = products.filter(p => p.sku === sku); if (new Set(candidates.map(p => p.id)).size !== 1) return pending("fiscal_stock_product_binding_required");
      const product = candidates[0]!; const ids = new Set<string>(); let complete = false;
      for (let page = 1; page <= 10; page++) {
        let rows: Record<string, unknown>[]; let totalPages: number;
        if (omie) {
          const response = await http.request("/api/v1/estoque/consulta/", { method: "POST", body: JSON.stringify({ call: "ListarMovimentoEstoque", param: [{ nPagina: page, nRegPorPagina: 100, idProd: product.id,
            dDtInicial: omieDate(context.snapshot.completedAt.toISOString(), payload.timeZone as string), dDtFinal: omieDate(new Date().toISOString(), payload.timeZone as string), lista_local_estoque: "TODOS" }] }) });
          if (!response.ok) return pending(response.status === 401 || response.status === 403 ? "fiscal_reauthorization_required" : "fiscal_stock_query_failed");
          const data = await response.json() as Record<string, unknown>;
          if (data.nPagina !== page || !Number.isSafeInteger(data.nTotPaginas) || Number(data.nTotPaginas) < 1 || !Array.isArray(data.movProdutoListar)) return pending("fiscal_stock_query_evidence_invalid");
          rows = data.movProdutoListar; totalPages = Number(data.nTotPaginas);
        } else {
          const data = await http.json("/estoque/" + remoteId(product.id) + "/logs-movimentacao?" + new URLSearchParams({ limit: "100", offset: String((page - 1) * 100) }));
          const pagination = data?.paginacao as { total?: number; offset?: number } | undefined;
          if (!data || !Array.isArray(data.itens) || !Number.isSafeInteger(pagination?.total) || Number(pagination?.total) < 0 || pagination?.offset !== undefined && pagination.offset !== (page - 1) * 100) return pending("fiscal_stock_query_evidence_invalid");
          rows = data.itens; totalPages = Math.max(1, Math.ceil(Number(pagination!.total) / 100));
        }
        if (rows.length > 100) return pending("fiscal_stock_query_evidence_invalid");
        for (const row of rows) {
          const sameOperation = omie ? String(row.idDoc) === invoice && String(row.idPedido) === order && row.idProd === product.id && row.tipo === "saida" && row.operacao === "11" && row.cancelamento === "N" && row.devolucao === "N"
            : String(row.idOrigem) === invoice && row.objOrigem === origin!.objectType && row.idProduto === product.id && row.tipo === "S";
          if (!sameOperation) continue;
          const movementId = remoteId(omie ? row.idMov : row.id); const count = Number(omie ? row.qtde : row.quantidade);
          if (ids.has(movementId) || !Number.isFinite(count) || count <= 0) return pending("fiscal_stock_query_evidence_invalid");
          ids.add(movementId); receipts.push({ sku, movementId, quantity: count });
        }
        if (page >= totalPages) { complete = true; break; }
      }
      if (!complete) return pending("fiscal_stock_history_limit_requires_review");
      if (receipts.filter(r => r.sku === sku).reduce((n, r) => n + r.quantity, 0) !== quantity) return pending();
    }
    const lines = [...quantities].sort(([a], [b]) => a.localeCompare(b)).map(([sku, quantity]) => ({ sku, quantity }));
    const proof = fiscalObjectFingerprint([context.identity, order, invoice, context.snapshot.contentHash, receipts.sort((a, b) => a.movementId.localeCompare(b.movementId)), origin?.evidenceReference]);
    return { found: true, evidence: { identity: context.identity, intentId: context.intent.id, snapshotHash: context.snapshot.contentHash, remoteOrderId: order, remoteInvoiceId: invoice, lines, evidenceReference: context.identity.provider + ":stock-movements:" + receipts.map(r => r.movementId).join(",") + ":" + proof } };
  }
}
