import type { PrismaClient } from "@prisma/client";
import type { MarketplaceResidualGenerationCoordinator } from "../domain/ports/marketplace-residual-generation-coordinator.port.js";
import type { StripeMarketplaceSuccessiveResidualCertificationService } from "./stripe-marketplace-successive-residual-certification.service.js";
import type { MarketplaceAsaasHostRetentionService } from "./services/marketplace-asaas-host-retention.service.js";

/** Keeps generation certification separate from native transfer receipts.
 * Both recovery paths perform GET only and retain financial holds. */
export class MarketplaceResidualGenerationCertificationCoordinator implements MarketplaceResidualGenerationCoordinator {
  constructor(private readonly prisma: PrismaClient,
    private readonly stripe: StripeMarketplaceSuccessiveResidualCertificationService,
    private readonly asaas: MarketplaceAsaasHostRetentionService) {}

  async certifyPlan(hostMerchantId: string, residualPlanId: string, now = new Date()): Promise<void> {
    const plan = await this.prisma.marketplaceResidualPlan.findFirst({where: {id: residualPlanId, hostMerchantId}});
    if (!plan) throw Error("marketplace_residual_generation_missing");
    const version = (plan.basis as {version?: number}).version;
    if (version === 6) {
      if (!await this.stripe.certifyPlan(hostMerchantId, residualPlanId)) throw Error("marketplace_residual_generation_unproven");
    } else if (version === 7) {
      if ((await this.asaas.certifyPlan(hostMerchantId, residualPlanId, now)).state !== "certified") {
        throw Error("marketplace_residual_generation_unproven");
      }
    }
  }

  async recover(limit: number): Promise<{attempted: number; reconciled: number; failed: number}> {
    const report = {attempted: 0, reconciled: 0, failed: 0};
    // A missing proof in one PSP must not prevent receipt recovery in another.
    try {
      const asaas = await this.asaas.recover(limit);
      report.attempted += asaas.attempted; report.reconciled += asaas.certified; report.failed += asaas.failed;
    } catch {report.failed++;}
    try {
      const stripe = await this.stripe.recover(limit);
      report.attempted += stripe.inspected; report.reconciled += stripe.recorded;
    } catch {report.failed++;}
    return report;
  }
}
