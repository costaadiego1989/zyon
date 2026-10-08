import type { MarketplaceResidualProvider } from "../../domain/ports/marketplace-residual-provider.port.js";
import type { MarketplaceResidualRepository } from "../../domain/ports/marketplace-residual-repository.port.js";
import type { MarketplaceResidualGenerationCoordinator } from "../../domain/ports/marketplace-residual-generation-coordinator.port.js";

export class ExecuteMarketplaceResidualUseCase {
  constructor(private readonly repository: MarketplaceResidualRepository, private readonly provider: MarketplaceResidualProvider,
    private readonly generations?: MarketplaceResidualGenerationCoordinator) {}

  async execute(hostMerchantId: string, operationId: string, now = new Date(), reconcileOnly = false): Promise<"confirmed" | "blocked" | "pending"> {
    const claim = await this.repository.claim(hostMerchantId, operationId, now, { reconcileOnly });
    if (!claim) return "blocked";
    const { operation } = claim;
    if (operation.state === "confirmed") return "confirmed";
    if (["failed", "cancelled"].includes(operation.state)) return "blocked";
    if (claim.submit) {
      if (reconcileOnly) return "blocked";
      let result;
      try { result = await this.provider.submit(operation.request); }
      catch { result = { state: "unknown" as const }; }
      if (result.state === "not_submitted") {
        await this.repository.releaseUnsubmittedClaim(operation);
        return "blocked";
      }
      // A POST never closes accounting. A later, independent GET must prove it.
      await this.repository.record(operation, { ...result, state: result.state === "unknown" ? "unknown" : "pending" });
      return "pending";
    }
    let result;
    try { result = await this.provider.reconcile(operation.request, operation.providerTransferId); }
    catch { result = { state: "unknown" as const }; }
    const recorded = await this.repository.record(operation, result);
    if (recorded && result.state === "confirmed" && this.generations) {
      try { await this.generations.certifyPlan(hostMerchantId, operation.residualPlanId, now); }
      catch { return "pending"; } // The native receipt was preserved; GET recovery remains available.
    }
    return recorded && result.state === "confirmed" ? "confirmed" : "pending";
  }

  async recover(limit = 20) {
    let generationReport = { attempted: 0, reconciled: 0, failed: 0 };
    try { if (this.generations) generationReport = await this.generations.recover(limit); }
    catch { generationReport.failed++; }
    const rows = await this.repository.listUnresolved(limit);
    let reconciled = 0, failed = 0, next = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (next < rows.length) {
        const row = rows[next++]!;
        try { if (await this.execute(row.hostMerchantId, row.operationId, new Date(), true) === "confirmed") reconciled++; }
        catch { failed++; }
      }
    }));
    return { attempted: rows.length + generationReport.attempted, reconciled: reconciled + generationReport.reconciled,
      failed: failed + generationReport.failed };
  }
}
