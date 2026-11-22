import type {PrismaClient} from '@prisma/client';
import {MetaAdsError,type AttributionReceipt,type AttributionTouch,type AttributionTouchRepository,type Clock} from '../domain/types.js';
import {requireIdentifier,stableDigest} from '../domain/offer.js';
import {PrismaMetaAdsRepository} from './prisma-meta-ads.repository.js';

export class PrismaAttributionTouchRepository implements AttributionTouchRepository {
 private readonly repo:PrismaMetaAdsRepository;
 constructor(private readonly db:PrismaClient,private readonly clock:Clock=()=>new Date()){this.repo=new PrismaMetaAdsRepository(db);}
 async capture(merchantId:string,receipt:AttributionReceipt,idempotencyKey:string):Promise<AttributionTouch>{
  requireIdentifier(merchantId);requireIdentifier(receipt.campaignId);requireIdentifier(receipt.sessionId);requireIdentifier(idempotencyKey);
  const key=`attribution-touch:${receipt.sessionId}:${idempotencyKey}`,digest=stableDigest({campaignId:receipt.campaignId,sessionId:receipt.sessionId,source:receipt.source});
  return this.repo.mutate(merchantId,[key],(state,records)=>{
   const existing=records.get(key)?.payload as AttributionTouch|undefined;
   if(existing){if(stableDigest({campaignId:existing.campaignId,sessionId:existing.sessionId,source:existing.source})!==digest)throw new MetaAdsError('attribution_touch_conflict',409);return{result:existing};}
   const sequence=(state.attributionObservationSequence??0)+1;if(!Number.isSafeInteger(sequence))throw new MetaAdsError('attribution_sequence_unavailable',503);
   const now=this.clock().toISOString();
   const touch:AttributionTouch={...receipt,sessionId:receipt.sessionId!,id:`touch_${stableDigest({merchantId,key})}`,merchantId,observedAt:now,observationSequence:sequence,idempotencyKey};
   state.attributionObservationSequence=sequence;return{result:touch,records:[{key,kind:'attribution_touch',payload:touch,createdAt:now}]};
  });
 }
 async eligible(merchantId:string,sessionIds:string[],since:string,until:string):Promise<AttributionTouch[]>{
  requireIdentifier(merchantId);if(!Array.isArray(sessionIds)||sessionIds.length>10)throw new MetaAdsError('attribution_sessions_invalid');sessionIds.forEach(requireIdentifier);
  const start=new Date(since),end=new Date(until);if(!Number.isFinite(start.getTime())||!Number.isFinite(end.getTime())||end<start||end.getTime()-start.getTime()>168*3600000)throw new MetaAdsError('attribution_period_invalid');
  if(!sessionIds.length)return[];
  const rows=await this.db.$queryRaw<Array<{payload:AttributionTouch}>>`SELECT payload FROM meta_ads_agent_records WHERE merchant_id=${merchantId} AND kind='attribution_touch' AND payload->>'sessionId'=ANY(${sessionIds}::text[]) AND created_at>=${start} AND created_at<=${end} ORDER BY created_at DESC,(payload->>'observationSequence')::bigint DESC LIMIT 500`;
  return rows.map(row=>row.payload);
 }
}
