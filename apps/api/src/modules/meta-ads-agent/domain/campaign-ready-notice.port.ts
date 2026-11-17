import type {MetaAdsCampaignReadyNotice} from '@zyon/shared-types';

export const CAMPAIGN_NOTICE_CONSENT_VERSION='campaign_ready.v1';
/** Metadata only. Access tokens and private conversations cannot enter the outbox. */
export interface CampaignNoticeSnapshot {
  recipientNumber:string;contactVersion:number;consentVersion:string;consentedBy:string;
  configId:string;wabaId:string;phoneNumberId:string;senderNumber:string;
  templateName:string;templateLanguage:string;templateRevision:number;templateBodyDigest:string;
}
export interface CampaignReadyNoticeRecord extends MetaAdsCampaignReadyNotice {
  merchantId:string;inboxCreatedAt:string|null;dispatchSnapshot:CampaignNoticeSnapshot|null;
  dispatchStartedAt:string|null;deliveryId:string|null;fence:number;
  leaseToken:string|null;leaseUntil:string|null;nextAttemptAt:string;
}
export interface CampaignReadyNoticeLease extends CampaignReadyNoticeRecord {leaseToken:string;leaseUntil:string;}
export interface CampaignNoticeAdmission {merchantId:string;campaignId:string;proposalId:string;proposalDigest:string;}
export type CampaignNoticeSendOutcome = {status:'accepted';messageId:string} | {status:'failed'|'unknown'|'not_dispatched';reason:string;messageId?:string};
export interface CampaignReadyNoticeRepository {
  admit(input:CampaignNoticeAdmission):Promise<CampaignReadyNoticeRecord>;
  read(merchantId:string,id:string):Promise<CampaignReadyNoticeRecord>;
  list(merchantId:string,campaignId:string,limit?:number):Promise<CampaignReadyNoticeRecord[]>;
  ensureInbox(merchantId:string,id:string,input:{campaignName:string;reviewUrl:string}):Promise<CampaignReadyNoticeRecord>;
  pending(limit?:number):Promise<CampaignReadyNoticeRecord[]>;
  claim(merchantId:string,id:string):Promise<CampaignReadyNoticeLease|null>;
  heartbeat(lease:CampaignReadyNoticeLease):Promise<void>;
  pinRecipient(lease:CampaignReadyNoticeLease,snapshot:CampaignNoticeSnapshot):Promise<CampaignReadyNoticeLease>;
  startDispatch(lease:CampaignReadyNoticeLease):Promise<CampaignReadyNoticeLease>;
  assertDispatch(lease:CampaignReadyNoticeLease):Promise<void>;
  completeDispatch(lease:CampaignReadyNoticeLease,outcome:CampaignNoticeSendOutcome):Promise<CampaignReadyNoticeRecord>;
  block(lease:CampaignReadyNoticeLease,reason:string):Promise<void>;
  setReviewState(merchantId:string,id:string,state:'approved'|'superseded'):Promise<void>;
}
export function publicCampaignReadyNotice(value:CampaignReadyNoticeRecord):MetaAdsCampaignReadyNotice {
  return {id:value.id,campaignId:value.campaignId,proposalId:value.proposalId,proposalDigest:value.proposalDigest,notificationId:value.notificationId,
    reviewState:value.reviewState,whatsappStatus:value.whatsappStatus,recipientHint:value.recipientHint,error:value.error,createdAt:value.createdAt,updatedAt:value.updatedAt};
}
