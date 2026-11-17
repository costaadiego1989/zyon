import type {PrismaClient,MetaAdsCampaignNoticeContact as ContactRow} from '@prisma/client';
import type {MetaAdsCampaignNoticeContact,MetaAdsCampaignNoticeContactInput} from '@zyon/shared-types';
import {MetaAdsError,type Clock} from '../domain/types.js';
import {requireIdentifier} from '../domain/offer.js';

export const CAMPAIGN_NOTICE_CONSENT_VERSION='campaign_ready.v1';
interface Dependencies {
  db:PrismaClient;authorizeActor:(merchantId:string,actorId:string)=>Promise<void>;
  senderNumber:(merchantId:string)=>Promise<string|null>;clock?:Clock;
}
function view(row:ContactRow|null):MetaAdsCampaignNoticeContact {
  return {phoneNumber:row?.phoneNumber??null,consented:!!(row?.phoneNumber&&row.consentedBy&&row.consentedAt&&row.consentVersion===CAMPAIGN_NOTICE_CONSENT_VERSION),
    consentVersion:row?.consentVersion??null,consentedAt:row?.consentedAt?.toISOString()??null,version:row?.version??0,updatedAt:row?.updatedAt.toISOString()??null};
}
function phone(value:string|null):string|null {
  if(value===null||typeof value==='string'&&!value.trim())return null;
  if(typeof value!=='string'||value.length>64)throw new MetaAdsError('campaign_notice_phone_invalid');
  const normalized=value.trim().replace(/[\s().-]/g,'');
  if(!/^\+[1-9][0-9]{7,14}$/.test(normalized))throw new MetaAdsError('campaign_notice_phone_invalid');
  return normalized;
}
export class CampaignNoticeContactService {
  private readonly clock:Clock;
  constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
  private async actor(merchantId:string,actorId:string){requireIdentifier(merchantId);requireIdentifier(actorId);await this.deps.authorizeActor(merchantId,actorId);}
  async read(merchantId:string,actorId:string):Promise<MetaAdsCampaignNoticeContact>{
    await this.actor(merchantId,actorId);
    if(!await this.deps.db.merchant.findUnique({where:{id:merchantId},select:{id:true}}))throw new MetaAdsError('merchant_not_found',404);
    return view(await this.deps.db.metaAdsCampaignNoticeContact.findUnique({where:{merchantId}}));
  }
  async save(merchantId:string,actorId:string,input:MetaAdsCampaignNoticeContactInput):Promise<MetaAdsCampaignNoticeContact>{
    await this.actor(merchantId,actorId);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==3||Object.keys(input).some(key=>!['phoneNumber','consented','expectedVersion'].includes(key))||typeof input.consented!=='boolean'||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<0)throw new MetaAdsError('campaign_notice_contact_invalid');
    const phoneNumber=phone(input.phoneNumber);
    if(input.consented&&!phoneNumber)throw new MetaAdsError('campaign_notice_contact_required');
    const sender=await this.deps.senderNumber(merchantId);
    if(phoneNumber&&sender&&phoneNumber.replace(/\D/g,'')===sender.replace(/\D/g,''))throw new MetaAdsError('campaign_notice_self_recipient');
    return this.deps.db.$transaction(async tx=>{
      const stores=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
      if(!stores.length)throw new MetaAdsError('merchant_not_found',404);
      await this.deps.authorizeActor(merchantId,actorId);
      const previous=await tx.metaAdsCampaignNoticeContact.findUnique({where:{merchantId}});
      if((previous?.version??0)!==input.expectedVersion)throw new MetaAdsError('campaign_notice_contact_changed',409);
      const unchanged=(previous?.phoneNumber??null)===phoneNumber&&(input.consented
        ? previous?.consentedBy===actorId&&!!previous.consentedAt&&previous.consentVersion===CAMPAIGN_NOTICE_CONSENT_VERSION
        : !previous?.consentedAt&&!previous?.consentedBy&&!previous?.consentVersion);
      if(unchanged)return view(previous);
      const now=this.clock(),version=(previous?.version??0)+1;
      const data={phoneNumber,version,consentVersion:input.consented?CAMPAIGN_NOTICE_CONSENT_VERSION:null,consentedBy:input.consented?actorId:null,consentedAt:input.consented?now:null,updatedAt:now};
      const saved=await tx.metaAdsCampaignNoticeContact.upsert({where:{merchantId},create:{merchantId,...data,createdAt:now},update:data});
      await tx.metaAdsAgentRecord.create({data:{merchantId,key:`campaign-notice-contact:${version}`,kind:'audit',createdAt:now,payload:{action:'campaign_notice_contact_changed',actorId,version,consented:input.consented,consentVersion:data.consentVersion,phoneChanged:(previous?.phoneNumber??null)!==phoneNumber,changedAt:now.toISOString()}}});
      return view(saved);
    },{maxWait:20000,timeout:20000});
  }
}
