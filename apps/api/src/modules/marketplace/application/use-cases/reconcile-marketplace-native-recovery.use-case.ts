import type { MarketplaceNativeRecoveryProvider, MarketplaceNativeRecoveryRepository } from "../../domain/ports/marketplace-native-recovery.port.js";

/** Internal, explicit GET-only reconciliation. No public route and no financial POST. */
export class ReconcileMarketplaceNativeRecoveryUseCase {
  constructor(private readonly repository: MarketplaceNativeRecoveryRepository, private readonly provider: MarketplaceNativeRecoveryProvider) {}
  async execute(hostMerchantId: string, payoutId: string): Promise<"partial" | "confirmed" | "blocked"> {
    const request = await this.repository.prepare(hostMerchantId, payoutId);
    return this.reconcile(request);
  }
  async executeResidual(hostMerchantId: string, residualOperationId: string): Promise<"partial" | "confirmed" | "blocked"> {
    const request = await this.repository.prepareResidual(hostMerchantId, residualOperationId);
    return this.reconcile(request);
  }
  private async reconcile(request: Awaited<ReturnType<MarketplaceNativeRecoveryRepository["prepare"]>>): Promise<"partial" | "confirmed" | "blocked"> {
    if (!request) return "blocked";
    let proof;
    try { proof = await this.provider.reconcile(request); } catch { return "blocked"; }
    return proof ? this.repository.record(request, proof) : "blocked";
  }
}
