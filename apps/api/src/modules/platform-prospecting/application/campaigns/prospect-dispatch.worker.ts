import { randomUUID } from "node:crypto";
import type {PlatformSenderBinding,ProspectCampaign} from "@zyon/shared-types";
import type { AttemptReservation,CampaignRepositoryPort,CanonicalBillingOfferPort, PlatformSenderPort, ProspectSendResult } from "../../domain/prospecting.ports.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";

import type { SenderReadinessService } from "./sender-readiness.service.js";

export interface DispatchReservations extends Pick<CampaignRepositoryPort,"recordResult">{
  reserveAttempt(recipientId:string,owner:string,now:Date,ordinal?:0|1):Promise<AttemptReservation|null>;
  deferReservation(packet:AttemptReservation):Promise<void>;
  dispatchReview(campaignId:string):Promise<{binding:PlatformSenderBinding;hash:string;offer:ProspectCampaign["offer"];campaign:Pick<ProspectCampaign,"senderBindingId"|"senderVersion"|"template"|"message">}|null>;
  markSubmitting(id:string,owner:string,clock:()=>Date,reviewHash:string,offerStillCurrent:()=>Promise<boolean>):Promise<boolean>;
}
export class ProspectDispatchWorker {
  constructor(
    private readonly repository: DispatchReservations,
    private readonly readiness: SenderReadinessService,
    private readonly offers: CanonicalBillingOfferPort,
    private readonly sender: Pick<PlatformSenderPort,"send">,
    private readonly clock: ()=>Date = ()=>new Date(),
  ) {}
  async processRecipient(recipientId:string,ordinal:0|1=0){
    const token=randomUUID();
    const packet=await this.repository.reserveAttempt(recipientId,token,this.clock(),ordinal);
    if(!packet?.campaignId)return {blocked:"reservation_unavailable"};
    const defer=async(blocked:string)=>{await this.repository.deferReservation(packet);return {blocked};};
    const review=await this.repository.dispatchReview(packet.campaignId);
    if(!review?.offer)return defer("offer_unavailable");
    const blockers=await this.readiness.forCampaign(review.campaign);
    if(blockers.length)return defer(blockers[0]);
    const approvedOffer=review.offer;
    const offerStillCurrent=async()=>{
      const current=await this.offers.current(approvedOffer.planKey);
      return this.offers.allowedUrl(current.canonicalUrl)&&stableDirectoryJson(current)===stableDirectoryJson(approvedOffer);
    };
    if(!await offerStillCurrent())return defer("approval_stale");
    if(!await this.repository.markSubmitting(packet.attempt.id,token,this.clock,review.hash,offerStillCurrent))return defer("submission_fenced");
    let result:ProspectSendResult;
    try{result=await this.sender.send(packet,review.binding);}
    catch{result={state:"outcome_unknown",errorCode:"provider_acceptance_unknown"};}
    return this.repository.recordResult(packet.attempt.id,token,result);
  }
}
