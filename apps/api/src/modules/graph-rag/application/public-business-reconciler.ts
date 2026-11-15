import type { PublicBusinessSourceType } from "../domain/public-business-source.js";

export interface PublicBusinessSourcePagePort {
  pageIdentities(merchantId: string, sourceType: PublicBusinessSourceType, cursor?: string, limit?: number): Promise<{
    sourceIds: string[]; nextCursor?: string;
  }>;
}
export interface PublicBusinessNormalizationPort {
  normalizeCurrent(merchantId: string, sourceType: PublicBusinessSourceType, sourceId: string): Promise<unknown>;
}
const sourceTypes: PublicBusinessSourceType[] = ["company", "business_hours", "professional", "service", "faq", "policy"];

/** Reconcile public fingerprints without contacting embeddings or the graph.
 * The canonical normalization port owns scoped transactions and idempotence.
 * Cursors advance only after the whole page commits; a restart can safely replay.
 */
export class PublicBusinessReconciler {
  private readonly cursors = new Map<string, Partial<Record<PublicBusinessSourceType, string>>>();
  constructor(private readonly sources: PublicBusinessSourcePagePort,
    private readonly work: PublicBusinessNormalizationPort) {}

  async reconcile(merchantId: string, stopping: () => boolean = () => false): Promise<void> {
    if (!merchantId.trim() || merchantId.length > 191) throw new Error("public_reconciliation_scope_invalid");
    if (stopping()) return;
    const cursors = this.cursors.get(merchantId) ?? {};
    this.cursors.set(merchantId, cursors);
    for (const type of sourceTypes) {
      const seen = new Set<string>();
      for (let page = 0; page < 2; page++) {
        if (stopping()) return;
        const cursor = cursors[type];
        const result = await this.sources.pageIdentities(merchantId, type, cursor, 100);
        if (stopping()) return;
        if (result.sourceIds.length > 100 || new Set(result.sourceIds).size !== result.sourceIds.length
          || result.sourceIds.some(id => typeof id !== "string" || !id.trim() || id.length > 191)
          || result.nextCursor !== undefined && (!result.sourceIds.length || !result.nextCursor.trim()
            || result.nextCursor.length > 191 || result.nextCursor === cursor || seen.has(result.nextCursor)))
          throw new Error("public_reconciliation_page_invalid");
        for (const sourceId of result.sourceIds) {
          if (stopping()) return;
          await this.work.normalizeCurrent(merchantId, type, sourceId);
        }
        if (stopping()) return;
        if (!result.nextCursor) { delete cursors[type]; break; }
        seen.add(result.nextCursor);
        cursors[type] = result.nextCursor;
      }
    }
  }
}
