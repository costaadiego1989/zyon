import type { MarketplaceContributionActor } from "../../domain/ports/marketplace-refund-contribution-journal.port.js";
import type { MarketplaceDisputeClosureProvider, MarketplaceDisputeClosureRepository } from "../../domain/ports/marketplace-dispute-closure.port.js";
import type { MarketplaceOrderDisputeClosureRepository } from "../../domain/ports/marketplace-order-dispute-closure.port.js";

/** Two separate accounting commands. Only the original account's native GET
 * can supply new proof; a durable terminal certificate is recovered locally. */
export class ReconcileMarketplaceOrderDisputeClosureUseCase {
  constructor(private readonly repository: MarketplaceOrderDisputeClosureRepository,
    private readonly nativeLedger: MarketplaceDisputeClosureRepository, private readonly provider: MarketplaceDisputeClosureProvider) {}
  context(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    this.validate(actor, paymentIntentId, providerDisputeId); return this.repository.context(actor, paymentIntentId, providerDisputeId);
  }
  async extinguishHostPrincipal(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    this.validate(actor, paymentIntentId, providerDisputeId);
    const replay = await this.repository.replayHostPrincipal(actor, paymentIntentId, providerDisputeId);
    if (replay) return { state: "recorded" as const, ...replay };
    const observed = await this.observe(actor, paymentIntentId, providerDisputeId);
    if (!observed) return { state: "pending" as const };
    return { state: "recorded" as const, ...await this.repository.recordHostPrincipal(actor, observed.request, observed.proof) };
  }
  async close(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    this.validate(actor, paymentIntentId, providerDisputeId);
    const replay = await this.repository.replayClosure(actor, paymentIntentId, providerDisputeId);
    if (replay) return { state: "recorded" as const, ...replay };
    const observed = await this.observe(actor, paymentIntentId, providerDisputeId);
    if (!observed) return { state: "pending" as const };
    return { state: "recorded" as const, ...await this.repository.recordClosure(actor, observed.request, observed.proof) };
  }
  private async observe(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    // request rechecks active host membership before obtaining the immutable
    // original account binding. Neither HTTP nor the caller chooses another PSP.
    const request = await this.repository.request(actor, paymentIntentId, providerDisputeId);
    if (request.hostMerchantId !== actor.merchantId || request.paymentIntentId !== paymentIntentId || request.providerDisputeId !== providerDisputeId)
      throw Error("marketplace_order_dispute_request_scope_changed");
    let proof;
    try { proof = await this.provider.read(request); } catch { return null; }
    if (!proof || proof.status !== "won") return null;
    await this.nativeLedger.record(request, proof);
    return { request, proof };
  }
  private validate(actor: MarketplaceContributionActor, paymentIntentId: string, providerDisputeId: string) {
    const id = (v: unknown) => typeof v === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(v);
    if (!actor || !id(actor.merchantId) || !id(actor.userId) || !id(paymentIntentId) || !/^(dp|du)_[A-Za-z0-9_]{1,100}$/.test(providerDisputeId))
      throw Error("marketplace_order_dispute_scope_required");
  }
}
