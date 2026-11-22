import { randomUUID } from "node:crypto";
import type { CanonicalBillingOfferPort, PlatformSenderPort, ProspectSendResult } from "../../domain/prospecting.ports.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";
import type { PrismaCampaignRepository } from "../../infrastructure/campaigns/prisma-campaign.repository.js";
import type { SenderReadinessService } from "./sender-readiness.service.js";

export class ProspectDispatchWorker {
  constructor(
    private readonly repository: Pick<PrismaCampaignRepository,"reserveAttempt"|"deferReservation"|"dispatchReview"|"markSubmitting"|"recordResult">,
    private readonly readiness: SenderReadinessService,
    private readonly offers: CanonicalBillingOfferPort,
    private readonly sender: Pick<PlatformSenderPort,"send">,
    private readonly clock: ()=>Date = ()=>new Date(),
  ) {}
  async processRecipient(recipientId:string){
    const token=randomUUID();
    const packet=await this.repository.reserveAttempt(recipientId,token,this.clock());
    if(!packet?.campaignId)return {blocked:"reservation_unavailable"};
    const defer=async(blocked:string)=>{await this.repository.deferReservation(packet);return {blocked};};
    const review=await this.repository.dispatchReview(packet.campaignId);
    if(!review?.offer)return defer("offer_unavailable");
    const blockers=await this.readiness.forCampaign(review.campaign);
    if(blockers.length)return defer(blockers[0]);
    const current=await this.offers.current(review.offer.planKey);
    if(!this.offers.allowedUrl(current.canonicalUrl)||stableDirectoryJson(current)!==stableDirectoryJson(review.offer))return defer("approval_stale");
    if(!await this.repository.markSubmitting(packet.attempt.id,token,this.clock,review.hash))return defer("submission_fenced");
    let result:ProspectSendResult;
    try{result=await this.sender.send(packet,review.binding);}
    catch{result={state:"outcome_unknown",errorCode:"provider_acceptance_unknown"};}
    return this.repository.recordResult(packet.attempt.id,token,result);
  }
}
