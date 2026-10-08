import type { MarketplaceDisputeClosureProvider, MarketplaceDisputeClosureRepository,
  MarketplaceDisputePrincipalExtinctionInput } from "../../domain/ports/marketplace-dispute-closure.port.js";

/** Explicit native reconciliation and a separate certified principal-extinction
 * command. These paths never submit a transfer, refund or dispute response. */
export class ReconcileMarketplaceDisputeClosureUseCase {
  constructor(private readonly repository: MarketplaceDisputeClosureRepository, private readonly provider: MarketplaceDisputeClosureProvider) {}
  async execute(hostMerchantId: string, paymentIntentId: string, providerDisputeId: string) {
    if (!hostMerchantId?.trim() || !paymentIntentId?.trim() || !/^(dp|du)_[A-Za-z0-9_]+$/.test(providerDisputeId)) {
      throw Error("marketplace_dispute_closure_scope_required");
    }
    const request = await this.repository.request(hostMerchantId, paymentIntentId, providerDisputeId);
    let proof;
    try { proof = await this.provider.read(request); } catch { return { state: "pending" as const }; }
    if (!proof) return { state: "pending" as const };
    return { state: "recorded" as const, ...await this.repository.record(request, proof) };
  }

  /** Explicit principal-only accounting command. Native GET evidence comes
   * from the original provider account, never from the caller's HTTP body. */
  async extinguishPrincipal(input: MarketplaceDisputePrincipalExtinctionInput) {
    if (!input.hostMerchantId?.trim() || !/^[A-Za-z0-9_-]{1,200}$/.test(input.paymentIntentId) ||
        !/^[A-Za-z0-9_-]{1,200}$/.test(input.debtId) || !/^(dp|du)_[A-Za-z0-9_]+$/.test(input.providerDisputeId)) {
      throw Error("marketplace_dispute_principal_extinction_scope_required");
    }
    if (!this.repository.extinguishPrincipal) throw Error("marketplace_dispute_principal_extinction_unavailable");
    const request = await this.repository.request(input.hostMerchantId, input.paymentIntentId, input.providerDisputeId);
    let proof;
    try { proof = await this.provider.read(request); } catch { return { state: "pending" as const }; }
    if (!proof) return { state: "pending" as const };
    await this.repository.record(request, proof);
    return { state: "recorded" as const, ...await this.repository.extinguishPrincipal(input, proof) };
  }
}
