import type { MarketplaceRefundObservation, MarketplaceRefundProvider } from "../../domain/ports/marketplace-refund-provider.port.js";
import type { MarketplaceTransferReversalRepository } from "../../domain/ports/marketplace-transfer-reversal-repository.port.js";

/** Recovery is GET only, including unknown outcomes and application restarts. */
export class ExecuteMarketplaceTransferReversalUseCase {
  constructor(private readonly repository: MarketplaceTransferReversalRepository, private readonly provider: MarketplaceRefundProvider) {}

  execute(hostMerchantId: string, operationId: string, now = new Date()): Promise<"confirmed" | "blocked" | "pending"> {
    return this.run(hostMerchantId, operationId, now, false);
  }

  async recover(limit = 20): Promise<{ attempted: number; reconciled: number; failed: number }> {
    const rows = await this.repository.listUnresolved(Number.isSafeInteger(limit) ? Math.min(100, Math.max(1, limit)) : 20);
    const result = { attempted: rows.length, reconciled: 0, failed: 0 };
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(4, rows.length) }, async () => {
      while (cursor < rows.length) {
        const row = rows[cursor++]!;
        try { if (await this.run(row.hostMerchantId, row.operationId, new Date(), true) === "confirmed") result.reconciled++; }
        catch { result.failed++; }
      }
    }));
    return result;
  }

  private async run(hostMerchantId: string, operationId: string, now: Date, reconcileOnly: boolean): Promise<"confirmed" | "blocked" | "pending"> {
    const claim = await this.repository.claim(hostMerchantId, operationId, now, { reconcileOnly });
    if (!claim) return "blocked";
    const { operation, submit } = claim;
    if (operation.request.kind !== "transfer_reversal") throw new Error("marketplace_reversal_operation_invalid");
    if (operation.state === "confirmed") return "confirmed";
    if (operation.state === "failed") return "blocked";
    if (submit) {
      if (reconcileOnly) { await this.repository.releaseUnsubmittedClaim(operation); return "blocked"; }
      let receipt;
      try { receipt = await this.provider.submit(operation.request); }
      catch { receipt = { state: "unknown" as const }; }
      if (receipt.state === "not_submitted") { await this.repository.releaseUnsubmittedClaim(operation); return "blocked"; }
      const observation: MarketplaceRefundObservation = ["confirmed", "failed"].includes(receipt.state) ? { ...receipt, state: "pending" } : receipt;
      await this.repository.record(operation, observation);
      return "pending";
    }
    let receipt: MarketplaceRefundObservation;
    try { receipt = await this.provider.reconcile(operation.request, operation.providerOperationId); }
    catch { receipt = { state: "unknown" }; }
    if (!await this.repository.record(operation, receipt)) return "pending";
    return receipt.state === "confirmed" ? "confirmed" : receipt.state === "failed" ? "blocked" : "pending";
  }
}
