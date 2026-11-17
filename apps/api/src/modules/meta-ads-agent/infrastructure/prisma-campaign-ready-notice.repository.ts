import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient} from '@prisma/client';
import {MetaAdsError,type Clock} from '../domain/types.js';
import {requireIdentifier,stableDigest} from '../domain/offer.js';
import {CAMPAIGN_NOTICE_CONSENT_VERSION,type CampaignNoticeAdmission,type CampaignNoticeSnapshot,type CampaignNoticeRecipient,type CampaignNoticeSendOutcome,type CampaignReadyNoticeLease,type CampaignReadyNoticeRecord,type CampaignReadyNoticeRepository} from '../domain/campaign-ready-notice.port.js';

const include={delivery:true} as const;
type Row=Prisma.MetaAdsCampaignReadyNoticeGetPayload<{include:typeof include}>;
const json=(value:unknown):Prisma.InputJsonValue=>{stableDigest(value);return JSON.parse(JSON.stringify(value));};
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const reason=(value:string)=>{if(!/^[a-z][a-z0-9_]{1,100}$/.test(value))throw new MetaAdsError('campaign_notice_reason_invalid');return value;};
const page=(limit:number)=>{if(!Number.isInteger(limit)||limit<1||limit>100)throw new MetaAdsError('campaign_notice_page_invalid');return limit;};
function map(row:Row):CampaignReadyNoticeRecord {
  const raw=object(row.dispatchSnapshot),{admittedRecipient:admission,...dispatch}=raw;
  const snapshot=typeof dispatch.configId==='string'?dispatch as unknown as CampaignNoticeSnapshot:null;
  const admittedRecipient=Object.hasOwn(raw,'admittedRecipient')?(admission as CampaignNoticeRecipient|null):snapshot?{recipientNumber:snapshot.recipientNumber,contactVersion:snapshot.contactVersion,consentVersion:snapshot.consentVersion,consentedBy:snapshot.consentedBy}:null;
  return {id:row.id,merchantId:row.merchantId,campaignId:row.campaignId,proposalId:row.proposalId,proposalDigest:row.proposalDigest,notificationId:row.notificationId,
    reviewState:row.reviewState as CampaignReadyNoticeRecord['reviewState'],whatsappStatus:row.whatsappStatus as CampaignReadyNoticeRecord['whatsappStatus'],recipientHint:snapshot?`•••• ${snapshot.recipientNumber.slice(-4)}`:null,
    error:row.error,inboxCreatedAt:row.inboxCreatedAt?.toISOString()??null,admittedRecipient,dispatchSnapshot:snapshot,dispatchStartedAt:row.dispatchStartedAt?.toISOString()??null,deliveryId:row.delivery?.id??null,
    fence:row.fence,leaseToken:row.leaseToken,leaseUntil:row.leaseUntil?.toISOString()??null,nextAttemptAt:row.nextAttemptAt.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
function validateSnapshot(value:CampaignNoticeSnapshot):void {
  const keys=['recipientNumber','contactVersion','consentVersion','consentedBy','configId','wabaId','phoneNumberId','senderNumber','templateName','templateLanguage','templateRevision','templateBodyDigest'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||Object.keys(value).some(key=>!keys.includes(key))||
    !/^\+[1-9][0-9]{7,14}$/.test(value.recipientNumber)||!/^\+[1-9][0-9]{7,14}$/.test(value.senderNumber)||value.senderNumber===value.recipientNumber||
    !Number.isSafeInteger(value.contactVersion)||value.contactVersion<1||value.consentVersion!==CAMPAIGN_NOTICE_CONSENT_VERSION||!/^\d{5,40}$/.test(value.wabaId)||!/^\d{5,40}$/.test(value.phoneNumberId)||
    !/^[a-z0-9_]{1,512}$/.test(value.templateName)||! /^[a-z]{2,3}(?:_[A-Z]{2})?$/.test(value.templateLanguage)||!Number.isSafeInteger(value.templateRevision)||value.templateRevision<1||!/^[a-f0-9]{64}$/.test(value.templateBodyDigest))throw new MetaAdsError('campaign_notice_snapshot_invalid');
  requireIdentifier(value.configId);requireIdentifier(value.consentedBy);
}
function reviewUrl(value:string,row:Row):string {
  try{
    const url=new URL(value),[tab,query]=url.hash.slice(1).split('?'),params=new URLSearchParams(query);
    if(url.protocol!=='https:'||url.username||url.password||url.search||tab!=='meta-ads-agent'||[...params.keys()].length!==3||params.get('store')!==row.merchantId||params.get('campaign')!==row.campaignId||params.get('proposal')!==row.proposalId)throw Error();
    return url.href;
  }catch{throw new MetaAdsError('campaign_notice_review_url_invalid');}
}
export class PrismaCampaignReadyNoticeRepository implements CampaignReadyNoticeRepository {
  constructor(private readonly db:PrismaClient,private readonly clock:Clock=()=>new Date()){}
  private async locked(tx:Prisma.TransactionClient,merchantId:string,id:string):Promise<Row>{
    requireIdentifier(merchantId);requireIdentifier(id);await tx.$queryRaw`SELECT id FROM meta_ads_campaign_ready_notices WHERE id=${id} AND merchant_id=${merchantId} FOR UPDATE`;
    const row=await tx.metaAdsCampaignReadyNotice.findFirst({where:{id,merchantId},include});if(!row)throw new MetaAdsError('campaign_notice_not_found',404);return row;
  }
  private mutate<T>(merchantId:string,id:string,change:(tx:Prisma.TransactionClient,row:Row)=>Promise<T>):Promise<T>{return this.db.$transaction(async tx=>change(tx,await this.locked(tx,merchantId,id)),{maxWait:20000,timeout:20000});}
  private validLease(row:Row,lease:CampaignReadyNoticeLease){if(row.id!==lease.id||row.merchantId!==lease.merchantId||row.fence!==lease.fence||row.leaseToken!==lease.leaseToken||row.whatsappStatus!=='sending'||!row.leaseUntil||row.leaseUntil<=this.clock())throw new MetaAdsError('campaign_notice_lease_lost',409);}
  private async saved(tx:Prisma.TransactionClient,id:string){return map(await tx.metaAdsCampaignReadyNotice.findUniqueOrThrow({where:{id},include}));}
  async admit(input:CampaignNoticeAdmission):Promise<CampaignReadyNoticeRecord>{
    for(const value of [input.merchantId,input.campaignId,input.proposalId])requireIdentifier(value);if(!/^[a-f0-9]{64}$/.test(input.proposalDigest))throw new MetaAdsError('campaign_notice_digest_invalid');
    const hash=stableDigest({merchantId:input.merchantId,proposalId:input.proposalId,proposalDigest:input.proposalDigest}),id=`campaign_notice_${hash}`,notificationId=`campaign_ready_${hash}`,now=this.clock();
    await this.db.$transaction(async tx=>{
      const stores=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM merchants WHERE id=${input.merchantId} FOR UPDATE`;
      if(!stores.length)throw new MetaAdsError('merchant_not_found',404);
      const contact=await tx.metaAdsCampaignNoticeContact.findUnique({where:{merchantId:input.merchantId}});
      const admittedRecipient=contact?.phoneNumber&&contact.consentedAt&&contact.consentedBy&&contact.consentVersion===CAMPAIGN_NOTICE_CONSENT_VERSION?{recipientNumber:contact.phoneNumber,contactVersion:contact.version,consentVersion:contact.consentVersion,consentedBy:contact.consentedBy}:null;
      const metadata=JSON.stringify({admittedRecipient});
      await tx.$executeRaw`INSERT INTO meta_ads_campaign_ready_notices(id,merchant_id,campaign_id,proposal_id,proposal_digest,notification_id,dispatch_snapshot,next_attempt_at,created_at,updated_at)
        VALUES(${id},${input.merchantId},${input.campaignId},${input.proposalId},${input.proposalDigest},${notificationId},CAST(${metadata} AS jsonb),${now},${now},${now}) ON CONFLICT DO NOTHING`;
    },{maxWait:20000,timeout:20000});
    const row=await this.read(input.merchantId,id);if(row.campaignId!==input.campaignId)throw new MetaAdsError('campaign_notice_identity_conflict',409);return row;
  }
  async read(merchantId:string,id:string):Promise<CampaignReadyNoticeRecord>{
    requireIdentifier(merchantId);requireIdentifier(id);const row=await this.db.metaAdsCampaignReadyNotice.findFirst({where:{id,merchantId},include});if(!row)throw new MetaAdsError('campaign_notice_not_found',404);return map(row);
  }
  async list(merchantId:string,campaignId:string,limit=20):Promise<CampaignReadyNoticeRecord[]>{requireIdentifier(merchantId);requireIdentifier(campaignId);return (await this.db.metaAdsCampaignReadyNotice.findMany({where:{merchantId,campaignId},orderBy:[{createdAt:'desc'},{id:'asc'}],take:page(limit),include})).map(map);}
  async ensureInbox(merchantId:string,id:string,input:{campaignName:string;reviewUrl:string}):Promise<CampaignReadyNoticeRecord>{
    return this.mutate(merchantId,id,async(tx,row)=>{
      if(row.inboxCreatedAt)return map(row);const url=reviewUrl(input.reviewUrl,row);
      if(typeof input.campaignName!=='string'||!input.campaignName.trim()||input.campaignName.length>120)throw new MetaAdsError('campaign_notice_name_invalid');
      const existing=await tx.merchantNotification.findUnique({where:{id:row.notificationId}});
      if(existing&&(existing.merchantId!==merchantId||existing.campaignReadyNoticeId!==id))throw new MetaAdsError('campaign_notice_identity_conflict',409);
      const metadata={campaignId:row.campaignId,proposalId:row.proposalId,proposalDigest:row.proposalDigest,merchantId,reviewState:row.reviewState,reviewUrl:url};
      const title=row.reviewState==='awaiting_approval'?'Campanha pronta para aprovação':row.reviewState==='approved'?'Campanha aprovada':'Campanha atualizada';
      const body=row.reviewState==='awaiting_approval'?`Campanha ${input.campaignName.trim()} pronta para aprovação administrativa.`:row.reviewState==='approved'?`A aprovação da campanha ${input.campaignName.trim()} foi registrada.`:`Esta revisão da campanha ${input.campaignName.trim()} foi substituída.`;
      if(existing)await tx.merchantNotification.update({where:{id:row.notificationId},data:{title,body,metadata}});
      else await tx.merchantNotification.create({data:{id:row.notificationId,merchantId,type:'campaign_ready',title,body,metadata,campaignReadyNoticeId:id,createdAt:this.clock()}});
      await tx.metaAdsCampaignReadyNotice.update({where:{id},data:{inboxCreatedAt:this.clock(),updatedAt:this.clock()}});return this.saved(tx,id);
    });
  }
  async pending(limit=50):Promise<CampaignReadyNoticeRecord[]>{
    const now=this.clock();return (await this.db.metaAdsCampaignReadyNotice.findMany({where:{OR:[{inboxCreatedAt:null},{reviewState:'awaiting_approval',whatsappStatus:{in:['queued','blocked']},nextAttemptAt:{lte:now}},{reviewState:'awaiting_approval',whatsappStatus:'sending',leaseUntil:{lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:page(limit),include})).map(map);
  }
  async claim(merchantId:string,id:string):Promise<CampaignReadyNoticeLease|null>{
    return this.mutate(merchantId,id,async(tx,row)=>{
      const now=this.clock();if(row.reviewState!=='awaiting_approval'||!['queued','blocked','sending'].includes(row.whatsappStatus)||row.whatsappStatus==='sending'&&row.leaseUntil&&row.leaseUntil>now||row.whatsappStatus!=='sending'&&row.nextAttemptAt>now)return null;
      if(row.dispatchStartedAt){
        await tx.metaAdsCampaignReadyNotice.update({where:{id},data:{whatsappStatus:'unknown',error:'provider_acceptance_unknown',leaseToken:null,leaseUntil:null,updatedAt:now}});
        if(row.delivery)await tx.whatsAppDelivery.update({where:{id:row.delivery.id},data:{state:'submission_unknown',response:json({...object(row.delivery.response),status:'unknown',reason:'provider_acceptance_unknown'}),updatedAt:now}});
        return null;
      }
      await tx.metaAdsCampaignReadyNotice.update({where:{id},data:{whatsappStatus:'sending',fence:{increment:1},leaseToken:randomUUID(),leaseUntil:new Date(now.getTime()+120000),updatedAt:now}});return await this.saved(tx,id) as CampaignReadyNoticeLease;
    });
  }
  async heartbeat(lease:CampaignReadyNoticeLease):Promise<void>{await this.mutate(lease.merchantId,lease.id,async(tx,row)=>{this.validLease(row,lease);const now=this.clock();await tx.metaAdsCampaignReadyNotice.update({where:{id:row.id},data:{leaseUntil:new Date(now.getTime()+120000),updatedAt:now}});});}
  private async currentContact(tx:Prisma.TransactionClient,merchantId:string,snapshot:CampaignNoticeSnapshot):Promise<void>{
    const contact=await tx.metaAdsCampaignNoticeContact.findUnique({where:{merchantId}});
    if(!contact||contact.phoneNumber!==snapshot.recipientNumber||contact.version!==snapshot.contactVersion||!contact.consentedAt||contact.consentedBy!==snapshot.consentedBy||contact.consentVersion!==snapshot.consentVersion)throw new MetaAdsError('campaign_notice_contact_changed',409);
  }
  async pinRecipient(lease:CampaignReadyNoticeLease,snapshot:CampaignNoticeSnapshot):Promise<CampaignReadyNoticeLease>{
    validateSnapshot(snapshot);return this.mutate(lease.merchantId,lease.id,async(tx,row)=>{
      this.validLease(row,lease);if(row.reviewState!=='awaiting_approval'||row.dispatchStartedAt)throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      const saved=map(row),previous=saved.dispatchSnapshot,admitted=saved.admittedRecipient;
      if(previous&&previous.recipientNumber!==snapshot.recipientNumber)throw new MetaAdsError('campaign_notice_recipient_changed',409);
      if(!admitted)throw new MetaAdsError('campaign_notice_contact_required',409);
      if(admitted.recipientNumber!==snapshot.recipientNumber||admitted.contactVersion!==snapshot.contactVersion||admitted.consentedBy!==snapshot.consentedBy||admitted.consentVersion!==snapshot.consentVersion)throw new MetaAdsError('campaign_notice_contact_changed',409);
      await this.currentContact(tx,row.merchantId,snapshot);
      await tx.metaAdsCampaignReadyNotice.update({where:{id:row.id},data:{dispatchSnapshot:json({...snapshot,admittedRecipient:admitted}),error:null,updatedAt:this.clock()}});return await this.saved(tx,row.id) as CampaignReadyNoticeLease;
    });
  }
  async startDispatch(lease:CampaignReadyNoticeLease):Promise<CampaignReadyNoticeLease>{
    return this.mutate(lease.merchantId,lease.id,async(tx,row)=>{
      this.validLease(row,lease);if(!row.inboxCreatedAt)throw new MetaAdsError('campaign_notice_inbox_required',409);if(row.dispatchStartedAt)throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      const snapshot=map(row).dispatchSnapshot;if(!snapshot||row.reviewState!=='awaiting_approval')throw new MetaAdsError('campaign_notice_snapshot_required',409);
      await this.currentContact(tx,row.merchantId,snapshot);
      const id=`campaign_ready:${stableDigest({merchantId:row.merchantId,proposalId:row.proposalId,proposalDigest:row.proposalDigest})}`;
      if(row.delivery&&(row.delivery.id!==id||row.delivery.state!=='campaign_notice_skipped'))throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      const existing=await tx.whatsAppDelivery.findUnique({where:{id}});
      if(existing&&(existing.merchantId!==row.merchantId||existing.campaignReadyNoticeId!==row.id||existing.state!=='campaign_notice_skipped'))throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      const now=this.clock(),data={merchantId:row.merchantId,configId:snapshot.configId,deviceId:snapshot.phoneNumberId,state:'sending',processingToken:lease.leaseToken,providerMessageId:null,response:json({kind:'campaign_ready',channel:'whatsapp_template',status:'sending',noticeId:row.id,campaignId:row.campaignId,proposalId:row.proposalId,proposalDigest:row.proposalDigest,attemptFence:row.fence}),campaignReadyNoticeId:row.id,updatedAt:now};
      if(existing)await tx.whatsAppDelivery.update({where:{id},data});else await tx.whatsAppDelivery.create({data:{id,...data,createdAt:now}});
      await tx.metaAdsCampaignReadyNotice.update({where:{id:row.id},data:{dispatchStartedAt:now,updatedAt:now}});return await this.saved(tx,row.id) as CampaignReadyNoticeLease;
    });
  }
  async assertDispatch(lease:CampaignReadyNoticeLease):Promise<void>{
    await this.mutate(lease.merchantId,lease.id,async(tx,row)=>{
      this.validLease(row,lease);const snapshot=map(row).dispatchSnapshot;
      if(row.reviewState!=='awaiting_approval'||!row.dispatchStartedAt||!row.delivery||row.delivery.processingToken!==lease.leaseToken||!snapshot)throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      await this.currentContact(tx,row.merchantId,snapshot);
    });
  }
  async completeDispatch(lease:CampaignReadyNoticeLease,outcome:CampaignNoticeSendOutcome):Promise<CampaignReadyNoticeRecord>{
    const messageId=outcome.messageId??null;
    if(messageId!==null&&(typeof messageId!=='string'||!messageId||messageId.length>1024||/[\s\u0000-\u001f]/.test(messageId))||outcome.status==='accepted'&&!messageId||outcome.status==='not_dispatched'&&messageId)throw new MetaAdsError('campaign_notice_outcome_invalid');
    if(outcome.status!=='accepted')reason(outcome.reason);
    return this.mutate(lease.merchantId,lease.id,async(tx,row)=>{
      if(!row.dispatchStartedAt||!row.delivery||row.fence!==lease.fence||row.delivery.processingToken!==lease.leaseToken)throw new MetaAdsError('campaign_notice_lease_lost',409);
      if(row.delivery.providerMessageId&&messageId&&row.delivery.providerMessageId!==messageId)throw new MetaAdsError('campaign_notice_message_changed',409);
      if(outcome.status==='not_dispatched'&&row.whatsappStatus!=='sending')throw new MetaAdsError('campaign_notice_dispatch_unknown',409);
      if(['accepted','delivered','failed'].includes(row.whatsappStatus))return map(row);
      const skipped=outcome.status==='not_dispatched',now=this.clock(),status=skipped?'blocked':outcome.status;
      const response={...object(row.delivery.response),status:outcome.status} as Record<string,unknown>;
      if(outcome.status==='accepted')delete response.reason;else response.reason=outcome.reason;
      await tx.whatsAppDelivery.update({where:{id:row.delivery.id},data:{providerMessageId:messageId??row.delivery.providerMessageId,state:skipped?'campaign_notice_skipped':status==='accepted'?'sent':status==='unknown'?'submission_unknown':'notification_delivery_failed',response:json(response),updatedAt:now}});
      await tx.metaAdsCampaignReadyNotice.update({where:{id:row.id},data:{whatsappStatus:status,error:outcome.status==='accepted'?null:outcome.reason,dispatchStartedAt:skipped?null:row.dispatchStartedAt,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(now.getTime()+60000),updatedAt:now}});return this.saved(tx,row.id);
    });
  }
  async block(lease:CampaignReadyNoticeLease,value:string):Promise<void>{
    reason(value);await this.mutate(lease.merchantId,lease.id,async(tx,row)=>{this.validLease(row,lease);if(row.dispatchStartedAt)throw new MetaAdsError('campaign_notice_dispatch_unknown',409);const now=this.clock();await tx.metaAdsCampaignReadyNotice.update({where:{id:row.id},data:{whatsappStatus:'blocked',error:value,leaseToken:null,leaseUntil:null,nextAttemptAt:new Date(now.getTime()+60000),updatedAt:now}});});
  }
  async setReviewState(merchantId:string,id:string,state:'approved'|'superseded'):Promise<void>{
    await this.mutate(merchantId,id,async(tx,row)=>{
      if(row.reviewState===state)return;if(row.reviewState==='superseded'&&state==='approved')throw new MetaAdsError('campaign_notice_review_closed',409);
      await tx.metaAdsCampaignReadyNotice.update({where:{id},data:{reviewState:state,leaseToken:null,leaseUntil:null,updatedAt:this.clock()}});
      const inbox=await tx.merchantNotification.findUnique({where:{id:row.notificationId}});
      if(inbox?.merchantId===merchantId&&inbox.campaignReadyNoticeId===id)await tx.merchantNotification.update({where:{id:row.notificationId},data:{title:state==='approved'?'Campanha aprovada':'Campanha atualizada',metadata:json({...object(inbox.metadata),reviewState:state})}});
    });
  }
}
