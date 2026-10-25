import type { MarketplaceCancellationExecutionProvider, MarketplaceCancellationExecutionRepository, MarketplaceCancellationReason } from "../../domain/ports/marketplace-cancellation-execution.port.js";

/** Explicit intent is required to cancel. Restart recovery only observes that intent. */
export class ExecuteMarketplaceCancellationUseCase {
  constructor(private readonly repository: MarketplaceCancellationExecutionRepository, private readonly provider: MarketplaceCancellationExecutionProvider) {}

  async execute(hostMerchantId: string, paymentIntentId: string, reason: MarketplaceCancellationReason = "requested_by_customer"):
    Promise<"released" | "pending" | "blocked"> {
    if (!hostMerchantId?.trim() || !paymentIntentId?.trim()) throw new Error("marketplace_cancellation_scope_required");
    const operation = await this.repository.prepare(hostMerchantId, paymentIntentId, reason);
    return this.run(hostMerchantId, operation.operationId, false);
  }

  private async run(hostMerchantId: string, operationId: string, reconcileOnly: boolean): Promise<"released" | "pending" | "blocked"> {
    const claim = await this.repository.claim(hostMerchantId, operationId, new Date(), { reconcileOnly });
    if (!claim) return "blocked";
    const { operation } = claim;
    if (operation.state === "confirmed") return "released";
    if (operation.state === "blocked") return "blocked";
    if (claim.submit) {
      if (reconcileOnly) return "blocked";
      try { await this.provider.submitCancellation(operation.request); } catch { /* Admitted unknown stays unknown. */ }
      // Never trust a POST response, including a purported terminal response.
      await this.repository.record(operation, { state: "unknown" });
      return "pending";
    }
    let observation;
    try { observation = await this.provider.reconcileCancellation(operation.request); }
    catch { observation = { state: "unknown" as const }; }
    const recorded = await this.repository.record(operation, observation);
    if (!recorded) return "pending";
    return observation.state === "confirmed" ? "released" : observation.state === "blocked" ? "blocked" : "pending";
  }

  async recover(limit = 20) {
    const rows = await this.repository.listUnresolved(limit);
    let reconciled = 0, failed = 0, next = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++]!;
        try { if (await this.run(row.hostMerchantId, row.operationId, true) === "released") reconciled++; }
        catch { failed++; }
      }
    }));
    return { attempted: rows.length, reconciled, failed };
  }
}
