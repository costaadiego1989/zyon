import type { MarketplaceRefundProvider, MarketplaceRefundObservation } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceRefundRepository } from "../../domain/ports/marketplace-refund-repository.port.js";

/** Exactly one admitted POST. Restart and uncertain responses use GET only. */
export class ExecuteMarketplaceRefundUseCase {
  constructor(private readonly repository: MarketplaceRefundRepository, private readonly provider: MarketplaceRefundProvider) {}

  async execute(hostMerchantId: string, refundPlanId: string, now = new Date()): Promise<"confirmed" | "blocked" | "pending"> {
    return this.run(hostMerchantId, refundPlanId, now, false);
  }

  async recover(limit = 20): Promise<{ attempted: number; reconciled: number; failed: number }> {
    const batch = Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20;
    const rows = await this.repository.listUnresolved(batch);
    const result = { attempted: rows.length, reconciled: 0, failed: 0 };
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]!;
        try {
          const state = await this.run(row.hostMerchantId, row.refundPlanId, new Date(), true);
          if (state === "confirmed") result.reconciled++;
        } catch { result.failed++; }
      }
    }));
    return result;
  }

  private async run(hostMerchantId: string, refundPlanId: string, now: Date, reconcileOnly: boolean): Promise<"confirmed" | "blocked" | "pending"> {
    const claim = await this.repository.claim(hostMerchantId, refundPlanId, now, { reconcileOnly });
    if (!claim) return "blocked";
    const { operation, submit } = claim;
    if (operation.state === "confirmed") return "confirmed";
    if (operation.state === "failed") return "blocked";
    if (submit) {
      if (reconcileOnly) {
        // Defensive protection if a repository implementation ignores its mode.
        await this.repository.releaseUnsubmittedClaim(operation);
        return "blocked";
      }
      let result;
      try { result = await this.provider.submit(operation.request); }
      catch { result = { state: "unknown" as const }; }
      if (result.state === "not_submitted") {
        await this.repository.releaseUnsubmittedClaim(operation);
        return "blocked";
      }
      // Independently read every terminal POST receipt before settling accounting.
      const observed: MarketplaceRefundObservation = ["confirmed", "failed"].includes(result.state) ?
        { ...result, state: "pending" } : result;
      await this.repository.record(operation, observed);
      return "pending";
    }
    let observation: MarketplaceRefundObservation;
    try { observation = await this.provider.reconcile(operation.request, operation.providerOperationId); }
    catch { observation = { state: "unknown" }; }
    const recorded = await this.repository.record(operation, observation);
    if (!recorded) return "pending";
    return observation.state === "confirmed" ? "confirmed" : observation.state === "failed" ? "blocked" : "pending";
  }
}
