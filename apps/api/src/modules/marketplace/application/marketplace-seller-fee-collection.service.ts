import { BadRequestException, ConflictException, Inject, Injectable, Optional } from "@nestjs/common";
import { TenantContextService } from "../../../shared/tenant/tenant-context.service.js";
import { MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY, MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER,
  type MarketplaceSellerFeeCollectionRepository, type MarketplaceSellerFeeCollectionProvider, type MarketplaceSellerFeeCollectionApproval,
  type MarketplaceSellerFeeHostedApproval } from "../domain/ports/marketplace-seller-fee-collection.port.js";
import type { MarketplaceContributionActor } from "../domain/ports/marketplace-refund-contribution-journal.port.js";

@Injectable()
export class MarketplaceSellerFeeCollectionService {
  constructor(@Inject(MARKETPLACE_SELLER_FEE_COLLECTION_REPOSITORY) private readonly repository:MarketplaceSellerFeeCollectionRepository,
    @Inject(MARKETPLACE_SELLER_FEE_COLLECTION_PROVIDER) private readonly provider:MarketplaceSellerFeeCollectionProvider,
    @Optional() private readonly tenants?:TenantContextService) {}
  async prepare(actor:MarketplaceContributionActor,input:MarketplaceSellerFeeCollectionApproval) {
    this.amount(input.grossAmountCents);
    const scope=await this.repository.customerScope(actor,input),proof=await this.provider.customer(scope);
    if(!proof)throw new ConflictException("marketplace_seller_fee_customer_unproven");
    return this.repository.prepare(actor,input,proof);
  }
  async hosted(actor:MarketplaceContributionActor,input:MarketplaceSellerFeeHostedApproval) {
    this.amount(input.grossAmountCents);
    const customerId=await this.repository.hostedCustomerId(actor,input.debtId);
    if(!customerId)throw new ConflictException("marketplace_seller_fee_customer_setup_required");
    // Server discovery is not native ownership proof. The existing GET proof
    // validates the original account and environment before persisting consent.
    return this.prepare(actor,{...input,customerId});
  }
  hostedContext(actor:MarketplaceContributionActor,debtId:string){return this.repository.dashboardContext(actor,debtId);}
  candidates(actor:MarketplaceContributionActor,limit=20,cursor?:string){return this.repository.candidates(actor,limit,cursor);}
  context(actor:MarketplaceContributionActor,debtId:string){return this.repository.context(actor,debtId);}
  get(actor:MarketplaceContributionActor,id:string){return this.repository.get(actor,id);}
  cancel(actor:MarketplaceContributionActor,id:string){return this.repository.cancel(actor,id);}
  closeObligation(actor:MarketplaceContributionActor,debtId:string){return this.repository.closeObligation(actor,debtId);}
  list(actor:MarketplaceContributionActor,debtId:string,limit=20,cursor?:string){return this.repository.list(actor,debtId,limit,cursor);}
  async execute(actor:MarketplaceContributionActor,id:string,gross:number) {
    this.amount(gross);
    const journal=await this.repository.get(actor,id);
    if(journal.status!=="approved")return journal;
    // Historical approvals remain readable and cancellable, but cannot spend
    // their first submission claim below Stripe's BRL minimum.
    this.amount(journal.request.grossAmountCents);
    const operation=await this.repository.claim(actor,id,gross);
    if(!operation)return this.repository.get(actor,id);
    // A transport error consumes the durable first claim. Only GET recovery is
    // allowed afterwards; retrying this human command never sends another POST.
    let observation;try{observation=await this.provider.submit(operation.request);}catch{observation={state:"unknown" as const};}
    return this.repository.record(actor,id,observation);
  }
  private amount(gross:number) {
    if(!Number.isSafeInteger(gross)||gross<50||gross>2147483647)
      throw new BadRequestException("invalid_marketplace_seller_fee_confirmation");
  }
  async reconcile(actor:MarketplaceContributionActor,id:string) {
    let journal=await this.repository.get(actor,id);
    if(["creating","open","paid","unproven"].includes(journal.status))
      journal=await this.repository.record(actor,id,await this.provider.observe(journal.request,journal.sessionId));
    if(journal.credit?.excessLiabilityCents && ["unknown","pending"].includes(journal.excessStatus??"")) {
      const operation=await this.repository.claimExcess(actor,id,journal.credit.excessLiabilityCents,true);
      if(operation) {
        let observation;try{observation=await this.provider.observeExcess(operation.request,operation.providerRefundId);}catch{observation={state:"unknown" as const};}
        journal=await this.repository.recordExcess(actor,operation,observation);
      }
    }
    return journal;
  }
  async returnExcess(actor:MarketplaceContributionActor,id:string,amountCents:number) {
    if(!Number.isSafeInteger(amountCents)||amountCents<1||amountCents>2147483647)
      throw new BadRequestException("invalid_marketplace_seller_fee_excess_confirmation");
    const operation=await this.repository.claimExcess(actor,id,amountCents,false);
    if(!operation)return this.repository.get(actor,id);
    let observation;try{observation=operation.submit?await this.provider.submitExcess(operation.request):
      await this.provider.observeExcess(operation.request,operation.providerRefundId);}catch{observation={state:"unknown" as const};}
    return this.repository.recordExcess(actor,operation,observation);
  }
  async recover(limit=20) {
    const rows=await this.repository.unresolved(limit),result={attempted:rows.length,reconciled:0,failed:0};
    for(const row of rows){try{
      const run=()=>this.reconcile(row.actor,row.collectionId);
      const journal=await (this.tenants?this.tenants.run({merchantId:row.actor.merchantId,userId:row.actor.userId,role:"system"},run):run());
      if(["credited","expired"].includes(journal.status) && !["unknown","pending"].includes(journal.excessStatus??""))result.reconciled++;
    }catch{result.failed++;}}
    const closures=await this.repository.unclosedObligations(limit);
    result.attempted+=closures.length;
    for(const row of closures){try{
      const run=()=>this.repository.closeObligation(row.actor,row.debtId);
      await (this.tenants?this.tenants.run({merchantId:row.actor.merchantId,userId:row.actor.userId,role:"system"},run):run());
      result.reconciled++;
    }catch{result.failed++;}}
    return result;
  }
}
