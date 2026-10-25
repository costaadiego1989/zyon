import { ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER } from "../domain/ports/marketplace-refund-contribution.port.js";
import { MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR, MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL,
  type MarketplaceContributionActor, type MarketplaceContributionApproval, type MarketplaceContributionActivator,
  type MarketplaceContributionJournal, type MarketplaceContributionReceiptProvider,
  type MarketplaceRefundContributionJournalRepository } from "../domain/ports/marketplace-refund-contribution-journal.port.js";
import { buildMarketplaceRefundContributionCertificate } from "../domain/services/marketplace-refund-contribution.js";

@Injectable()
export class MarketplaceRefundContributionService {
  constructor(@Inject(MARKETPLACE_REFUND_CONTRIBUTION_JOURNAL) private readonly repository: MarketplaceRefundContributionJournalRepository,
    @Inject(MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER) private readonly provider: MarketplaceContributionReceiptProvider,
    @Optional() @Inject(MARKETPLACE_REFUND_CONTRIBUTION_ACTIVATOR) private readonly activate?: MarketplaceContributionActivator) {}

  async approve(actor: MarketplaceContributionActor, approval: MarketplaceContributionApproval) {
    const scope = await this.repository.approvalContext(actor, approval);
    const binding = await this.provider.readCustomerBinding(scope);
    if (!binding) throw new ConflictException("marketplace_contribution_customer_unproven");
    return this.repository.approve(actor, approval, binding);
  }
  get(actor: MarketplaceContributionActor, contributionId: string) { return this.repository.get(actor, contributionId); }
  async recover(limit = 20) {
    const rows = await this.repository.listUnresolved(limit);
    const result = { attempted: rows.length, reconciled: 0, failed: 0, examined: rows.length, credited: 0, unproven: 0 };
    for (const row of rows) {
      try { const journal = await this.reconcile(row.actor, row.contributionId);
        if (journal.status === "credited") { result.credited++; result.reconciled++; } else result.unproven++;
      } catch { result.failed++; }
    }
    return result;
  }

  /** A lost GET lease may be reconciled repeatedly; no submission exists here. */
  async reconcile(actor: MarketplaceContributionActor, contributionId: string): Promise<MarketplaceContributionJournal> {
    const operation = await this.repository.claim(actor, contributionId);
    if (!operation) return this.afterCredit(await this.repository.get(actor, contributionId));
    let credited: MarketplaceContributionJournal;
    try {
      const proof = await this.provider.readContribution(operation.request);
      const certificate = proof && buildMarketplaceRefundContributionCertificate(operation.request, proof);
      if (!certificate) { await this.repository.release(operation); return this.repository.get(actor, contributionId); }
      credited = await this.repository.record(operation, certificate);
    } catch (error) {
      await this.repository.release(operation);
      throw error;
    }
    return this.afterCredit(credited);
  }
  private async afterCredit(journal: MarketplaceContributionJournal) {
    // Local activation is independently retryable after the credit commit.
    if (journal.status === "credited" && this.activate) await this.activate(journal.hostMerchantId, journal.refundPlanId);
    return journal;
  }
}
