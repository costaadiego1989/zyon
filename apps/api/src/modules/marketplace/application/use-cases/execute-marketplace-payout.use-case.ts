import type { MarketplacePayoutProvider } from "../../domain/ports/marketplace-payout-provider.port.js";
import type { MarketplacePayoutRepository } from "../../domain/ports/marketplace-payout-repository.port.js";

/** A crash before/after POST is recovered by GET, never by resubmitting money. */
export class ExecuteMarketplacePayoutUseCase {
  constructor(private readonly repository: MarketplacePayoutRepository, private readonly provider: MarketplacePayoutProvider) {}

  async execute(settlementId: string, now = new Date()): Promise<"confirmed" | "blocked" | "pending"> {
    const claim = await this.repository.claim(settlementId, now);
    if (!claim) return "blocked";
    const { operation, submit } = claim;
    if (operation.state === "confirmed") return "confirmed";
    if (operation.state === "failed" || operation.state === "cancelled") return "blocked";
    let observation;
    if (submit) {
      let submission;
      try { submission = await this.provider.submit(operation.request); }
      catch { submission = { state: "unknown" as const }; }
      if (submission.state === "not_submitted") {
        await this.repository.releaseUnsubmittedClaim(operation);
        return "blocked";
      }
      observation = submission;
      await this.repository.record(operation, observation);
      // The receipt must be read independently on the next reconciliation pass.
      return "pending";
    }
    try { observation = await this.provider.reconcile(operation.request, operation.providerTransferId); }
    catch { observation = { state: "unknown" as const }; }
    const recorded = await this.repository.record(operation, observation);
    return recorded && observation.state === "confirmed" ? "confirmed" : "pending";
  }
}
