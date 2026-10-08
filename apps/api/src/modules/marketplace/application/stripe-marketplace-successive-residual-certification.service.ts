import { Inject, Injectable } from "@nestjs/common";
import { STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_CERTIFICATION_PROVIDER,
  STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_GENERATION_REPOSITORY,
  type StripeMarketplaceSuccessiveResidualCertificationProvider,
  type StripeMarketplaceSuccessiveResidualGenerationRepository } from "../domain/ports/stripe-marketplace-successive-residual.port.js";

/** A generation is completed only after a durably claimed, complete GET proof.
 * Recovery never submits a payout and cannot release a financial hold. */
@Injectable()
export class StripeMarketplaceSuccessiveResidualCertificationService {
  constructor(
    @Inject(STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_GENERATION_REPOSITORY)
    private readonly repository: StripeMarketplaceSuccessiveResidualGenerationRepository,
    @Inject(STRIPE_MARKETPLACE_SUCCESSIVE_RESIDUAL_CERTIFICATION_PROVIDER)
    private readonly provider: StripeMarketplaceSuccessiveResidualCertificationProvider,
  ) {}
  async certifyPlan(hostMerchantId: string, residualPlanId: string): Promise<boolean> {
    const claim = await this.repository.claimGeneration(hostMerchantId, residualPlanId, new Date());
    if (!claim) return false;
    if (claim.state === "confirmed") return true;
    let observation: Awaited<ReturnType<StripeMarketplaceSuccessiveResidualCertificationProvider["certifyGeneration"]>>;
    try { observation = await this.provider.certifyGeneration(claim.request); }
    catch { observation = { state: "unknown" }; }
    return this.repository.recordGeneration(claim, observation);
  }
  async recover(limit = 20): Promise<{ inspected: number; recorded: number }> {
    const rows = await this.repository.listUnresolvedGenerations(Math.min(100, Math.max(1, Math.floor(limit) || 20)));
    let recorded = 0;
    for (const row of rows) if (await this.certifyPlan(row.hostMerchantId, row.residualPlanId)) recorded++;
    return { inspected: rows.length, recorded };
  }
}
