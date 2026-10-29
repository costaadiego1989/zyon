import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER, MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY,
  type MarketplaceContributionCheckoutRepository, type MarketplaceContributionCheckoutProvider,
  type MarketplaceContributionCheckoutApproval, type MarketplaceContributionCheckoutJournal } from "../domain/ports/marketplace-contribution-checkout.port.js";
import { MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER } from "../domain/ports/marketplace-refund-contribution.port.js";
import type { MarketplaceContributionActor, MarketplaceContributionReceiptProvider } from "../domain/ports/marketplace-refund-contribution-journal.port.js";
import { MarketplaceRefundContributionService } from "./marketplace-refund-contribution.service.js";

@Injectable()
export class MarketplaceContributionCheckoutService {
  constructor(@Inject(MARKETPLACE_CONTRIBUTION_CHECKOUT_REPOSITORY) private readonly repository: MarketplaceContributionCheckoutRepository,
    @Inject(MARKETPLACE_CONTRIBUTION_CHECKOUT_PROVIDER) private readonly provider: MarketplaceContributionCheckoutProvider,
    @Inject(MARKETPLACE_REFUND_CONTRIBUTION_PROVIDER) private readonly receipts: MarketplaceContributionReceiptProvider,
    @Inject(MarketplaceRefundContributionService) private readonly contributions: MarketplaceRefundContributionService) {}
  async prepare(actor:MarketplaceContributionActor,input:MarketplaceContributionCheckoutApproval) {
    const scope=await this.repository.customerScope(actor,input.refundPlanId,input.customerId);
    const customer=await this.receipts.readCustomerBinding(scope);
    if(!customer) throw new ConflictException("marketplace_contribution_customer_unproven");
    return this.repository.prepare(actor,input,customer);
  }
  get(actor:MarketplaceContributionActor,id:string){return this.repository.get(actor,id);}
  cancel(actor:MarketplaceContributionActor,id:string){return this.repository.cancel(actor,id);}
  list(actor:MarketplaceContributionActor,limit=20,cursor?:string){return this.repository.list(actor,limit,cursor);}
  context(actor:MarketplaceContributionActor,refundPlanId:string){return this.repository.context(actor,refundPlanId);}
  /** Explicit human command. A consumed first claim cannot submit again. */
  async execute(actor:MarketplaceContributionActor,id:string,grossAmountCents:number) {
    const operation=await this.repository.claim(actor,id,grossAmountCents);
    if(!operation) return this.repository.get(actor,id);
    const observation=await this.provider.submit(operation.request);
    return this.repository.record(actor,id,observation);
  }
  /** GET-only PSP recovery. Crediting uses the already journaled human consent;
   * it cannot authorise another payment or increase its frozen gross amount. */
  async reconcile(actor:MarketplaceContributionActor,id:string):Promise<MarketplaceContributionCheckoutJournal> {
    let journal=await this.repository.get(actor,id);
    if(["creating","open","unproven","paid"].includes(journal.status)) {
      journal=await this.repository.record(actor,id,await this.provider.observe(journal.request,journal.sessionId));
      if(journal.status==="paid" && journal.paymentIntentId) {
        const r=journal.request, author={merchantId:r.merchantId,userId:r.actorUserId};
        await this.contributions.approve(author,{refundPlanId:r.refundPlanId,contributionId:r.contributionId,customerId:r.customerId,
          providerPaymentIntentId:journal.paymentIntentId,grossAmountCents:r.grossAmountCents,confirmed:true,
          collection:{journalId:r.contributionId,requestHash:r.requestHash,reference:r.reference}});
        const credited=await this.contributions.reconcile(author,id);
        if(credited.status==="credited") await this.repository.reconcileCredit(actor,id);
      }
    }
    journal=await this.repository.get(actor,id);
    if(journal.excessLiabilityCents && ["unknown","pending"].includes(journal.excessStatus ?? "")) {
      const operation=await this.repository.claimExcess(actor,id,journal.excessLiabilityCents,true);
      if(operation) await this.repository.recordExcess(actor,operation,await this.provider.observeExcess(operation.request,operation.providerRefundId));
    }
    return this.repository.get(actor,id);
  }
  async returnExcess(actor:MarketplaceContributionActor,id:string,amountCents:number) {
    const operation=await this.repository.claimExcess(actor,id,amountCents,false);
    if(!operation) return this.repository.get(actor,id);
    const observation=operation.submit ? await this.provider.submitExcess(operation.request) : await this.provider.observeExcess(operation.request,operation.providerRefundId);
    await this.repository.recordExcess(actor,operation,observation);
    return this.repository.get(actor,id);
  }
  async recover(limit=20) {
    const rows=await this.repository.listUnresolved(limit),result={attempted:rows.length,reconciled:0,failed:0};
    for(const row of rows){try{const journal=await this.reconcile(row.actor,row.contributionId);
      if(journal.status==="credited" || journal.status==="expired")result.reconciled++;
    }catch{result.failed++;}}
    return result;
  }
}
