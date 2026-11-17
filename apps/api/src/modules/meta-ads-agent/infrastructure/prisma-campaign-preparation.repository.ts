import {randomUUID} from 'node:crypto';
import {Prisma,type PrismaClient,type MetaAdsCampaignPreparation} from '@prisma/client';
import {MetaAdsError,type Clock} from '../domain/types.js';
import {requireIdentifier,stableDigest} from '../domain/offer.js';
import type {CampaignPreparationAdmission,CampaignPreparationCheckpoint,CampaignPreparationJob,CampaignPreparationLease,CampaignPreparationRepository} from '../domain/campaign-preparation.port.js';

const json=(value:unknown):Prisma.InputJsonValue=>{stableDigest(value);return JSON.parse(JSON.stringify(value));};
const page=(limit:number)=>{if(!Number.isInteger(limit)||limit<1||limit>100)throw new MetaAdsError('preparation_page_invalid');return limit;};
const digest=(value:string)=>{if(!/^[a-f0-9]{64}$/.test(value))throw new MetaAdsError('preparation_digest_invalid');return value;};
function map(row:MetaAdsCampaignPreparation):CampaignPreparationJob {
  return {...row,status:row.status as CampaignPreparationJob['status'],checkpoint:row.checkpoint as Record<string,unknown>,missing:row.missing as string[],
    leaseUntil:row.leaseUntil?.toISOString()??null,nextAttemptAt:row.nextAttemptAt.toISOString(),createdAt:row.createdAt.toISOString(),updatedAt:row.updatedAt.toISOString()};
}
export class PrismaCampaignPreparationRepository implements CampaignPreparationRepository {
  constructor(private readonly db:PrismaClient,private readonly clock:Clock=()=>new Date()){}
  async admit(input:CampaignPreparationAdmission):Promise<CampaignPreparationJob>{
    for(const value of [input.merchantId,input.campaignId,input.requestedBy])requireIdentifier(value);
    digest(input.intentDigest);digest(input.campaignDigest);
    if(!Number.isSafeInteger(input.requestedImages)||input.requestedImages<1||input.requestedImages>10)throw new MetaAdsError('image_count_invalid');
    const id=`preparation_${stableDigest({merchantId:input.merchantId,campaignId:input.campaignId,intentDigest:input.intentDigest})}`,now=this.clock();
    await this.db.$executeRaw`INSERT INTO meta_ads_campaign_preparations(id,merchant_id,campaign_id,intent_digest,campaign_digest,requested_by,requested_images,next_attempt_at,created_at,updated_at)
      VALUES(${id},${input.merchantId},${input.campaignId},${input.intentDigest},${input.campaignDigest},${input.requestedBy},${input.requestedImages},${now},${now},${now}) ON CONFLICT DO NOTHING`;
    const saved=await this.read(input.merchantId,id);
    if(saved.campaignId!==input.campaignId||saved.intentDigest!==input.intentDigest||saved.requestedImages!==input.requestedImages)throw new MetaAdsError('preparation_request_conflict',409);
    return saved;
  }
  async read(merchantId:string,id:string):Promise<CampaignPreparationJob>{
    requireIdentifier(merchantId);requireIdentifier(id);const row=await this.db.metaAdsCampaignPreparation.findFirst({where:{id,merchantId}});
    if(!row)throw new MetaAdsError('preparation_not_found',404);return map(row);
  }
  async list(merchantId:string,campaignId:string,limit=20):Promise<CampaignPreparationJob[]>{
    requireIdentifier(merchantId);requireIdentifier(campaignId);return (await this.db.metaAdsCampaignPreparation.findMany({where:{merchantId,campaignId},orderBy:[{updatedAt:'desc'},{id:'asc'}],take:page(limit)})).map(map);
  }
  async pending(limit=50):Promise<CampaignPreparationJob[]>{
    const now=this.clock();return (await this.db.metaAdsCampaignPreparation.findMany({where:{OR:[{status:{in:['queued','creative_pending','blocked']},nextAttemptAt:{lte:now}},{status:'preparing',leaseUntil:{lte:now}}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:page(limit)})).map(map);
  }
  async claim(merchantId:string,id:string):Promise<CampaignPreparationLease|null>{
    requireIdentifier(merchantId);requireIdentifier(id);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM meta_ads_campaign_preparations WHERE id=${id} AND merchant_id=${merchantId} FOR UPDATE`;
      const row=await tx.metaAdsCampaignPreparation.findFirst({where:{id,merchantId}});if(!row)throw new MetaAdsError('preparation_not_found',404);
      const now=this.clock();
      if(!['queued','preparing','creative_pending','blocked'].includes(row.status)||row.status==='preparing'&&row.leaseUntil&&row.leaseUntil>now||row.status!=='preparing'&&row.nextAttemptAt>now)return null;
      return map(await tx.metaAdsCampaignPreparation.update({where:{id},data:{status:'preparing',fence:{increment:1},leaseToken:randomUUID(),leaseUntil:new Date(now.getTime()+120000),updatedAt:now}})) as CampaignPreparationLease;
    },{maxWait:20000,timeout:20000});
  }
  private where(lease:CampaignPreparationLease){return {id:lease.id,merchantId:lease.merchantId,status:'preparing',fence:lease.fence,leaseToken:lease.leaseToken,leaseUntil:{gt:this.clock()}};}
  async heartbeat(lease:CampaignPreparationLease):Promise<void>{
    const now=this.clock();const result=await this.db.metaAdsCampaignPreparation.updateMany({where:this.where(lease),data:{leaseUntil:new Date(now.getTime()+120000),updatedAt:now}});
    if(result.count!==1)throw new MetaAdsError('preparation_lease_lost',409);
  }
  async checkpoint(lease:CampaignPreparationLease,patch:CampaignPreparationCheckpoint):Promise<CampaignPreparationLease>{
    for(const value of [patch.generationId,patch.proposalId])if(value!==null&&value!==undefined)requireIdentifier(value);
    if(patch.campaignDigest!==undefined)digest(patch.campaignDigest);
    if(patch.error!==undefined&&patch.error!==null&&!/^[a-z][a-z0-9_]{1,100}$/.test(patch.error))throw new MetaAdsError('preparation_error_invalid');
    return this.db.$transaction(async tx=>{
      const saved=await tx.metaAdsCampaignPreparation.updateMany({where:this.where(lease),data:{updatedAt:this.clock(),
        ...(patch.generationId===undefined?{}:{generationId:patch.generationId}),...(patch.proposalId===undefined?{}:{proposalId:patch.proposalId}),
        ...(patch.campaignDigest===undefined?{}:{campaignDigest:patch.campaignDigest}),...(patch.error===undefined?{}:{error:patch.error}),...(patch.checkpoint===undefined?{}:{checkpoint:json(patch.checkpoint)}),...(patch.missing===undefined?{}:{missing:json(patch.missing)})}});
      if(saved.count!==1)throw new MetaAdsError('preparation_lease_lost',409);
      return map(await tx.metaAdsCampaignPreparation.findUniqueOrThrow({where:{id:lease.id}})) as CampaignPreparationLease;
    });
  }
  async finish(lease:CampaignPreparationLease,status:Parameters<CampaignPreparationRepository['finish']>[1],nextAttemptAt?:Date):Promise<void>{
    const now=this.clock(),next=nextAttemptAt??new Date(now.getTime()+(['creative_pending','blocked'].includes(status)?60000:0));
    const saved=await this.db.metaAdsCampaignPreparation.updateMany({where:this.where(lease),data:{status,leaseToken:null,leaseUntil:null,nextAttemptAt:next,updatedAt:now}});
    if(saved.count!==1)throw new MetaAdsError('preparation_lease_lost',409);
  }
  async revise(merchantId:string,id:string,expectedDigest:string,input:{campaignDigest:string;requestedBy:string;forceReview?:boolean}):Promise<CampaignPreparationJob>{
    requireIdentifier(merchantId);requireIdentifier(id);requireIdentifier(input.requestedBy);digest(expectedDigest);digest(input.campaignDigest);
    return this.db.$transaction(async tx=>{
      await tx.$queryRaw`SELECT id FROM meta_ads_campaign_preparations WHERE id=${id} AND merchant_id=${merchantId} FOR UPDATE`;
      const row=await tx.metaAdsCampaignPreparation.findFirst({where:{id,merchantId}});if(!row)throw new MetaAdsError('preparation_not_found',404);
      if(row.campaignDigest!==expectedDigest)throw new MetaAdsError('preparation_version_changed',409);
      if(row.campaignDigest===input.campaignDigest&&row.requestedBy===input.requestedBy&&!input.forceReview)return map(row);
      const checkpoint={...row.checkpoint as Record<string,unknown>};delete checkpoint.proposalRequestKey;
      return map(await tx.metaAdsCampaignPreparation.update({where:{id},data:{campaignDigest:input.campaignDigest,requestedBy:input.requestedBy,status:row.status==='unknown'?'unknown':'queued',proposalId:null,
        checkpoint:json(checkpoint),missing:json([]),error:row.status==='unknown'?row.error:null,fence:{increment:1},leaseToken:null,leaseUntil:null,nextAttemptAt:this.clock(),updatedAt:this.clock()}}));
    },{maxWait:20000,timeout:20000});
  }
}
