import type {MetaAdsCampaignPreparation,MetaAdsCampaignPreparationStatus} from '@zyon/shared-types';

export interface CampaignPreparationJob extends MetaAdsCampaignPreparation {
  merchantId:string;campaignDigest:string;requestedBy:string;checkpoint:Record<string,unknown>;
  fence:number;leaseToken:string|null;leaseUntil:string|null;nextAttemptAt:string;
}
export interface CampaignPreparationLease extends CampaignPreparationJob {status:'preparing';leaseToken:string;leaseUntil:string;}
export interface CampaignPreparationAdmission {
  merchantId:string;campaignId:string;intentDigest:string;campaignDigest:string;requestedBy:string;requestedImages:number;
}
export interface CampaignPreparationCheckpoint {
  generationId?:string|null;proposalId?:string|null;campaignDigest?:string;
  checkpoint?:Record<string,unknown>;missing?:string[];
  error?:string|null;
}
export interface CampaignPreparationRepository {
  admit(input:CampaignPreparationAdmission):Promise<CampaignPreparationJob>;
  read(merchantId:string,id:string):Promise<CampaignPreparationJob>;
  list(merchantId:string,campaignId:string,limit?:number):Promise<CampaignPreparationJob[]>;
  pending(limit?:number):Promise<CampaignPreparationJob[]>;
  claim(merchantId:string,id:string):Promise<CampaignPreparationLease|null>;
  heartbeat(lease:CampaignPreparationLease):Promise<void>;
  checkpoint(lease:CampaignPreparationLease,patch:CampaignPreparationCheckpoint):Promise<CampaignPreparationLease>;
  finish(lease:CampaignPreparationLease,status:Exclude<MetaAdsCampaignPreparationStatus,'queued'|'preparing'>,nextAttemptAt?:Date):Promise<void>;
  revise(merchantId:string,id:string,expectedDigest:string,input:{campaignDigest:string;requestedBy:string;forceReview?:boolean}):Promise<CampaignPreparationJob>;
}
export function publicCampaignPreparation(value:CampaignPreparationJob):MetaAdsCampaignPreparation{
  return{id:value.id,campaignId:value.campaignId,intentDigest:value.intentDigest,status:value.status,requestedImages:value.requestedImages,generationId:value.generationId,proposalId:value.proposalId,missing:value.missing,error:value.error,createdAt:value.createdAt,updatedAt:value.updatedAt};
}
