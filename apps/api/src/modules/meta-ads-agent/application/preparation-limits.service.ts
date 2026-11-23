import type {MetaAdsPreparationLimitsInput,MetaAdsPreparationLimitsView} from '@zyon/shared-types';
import {MetaAdsError,type Clock,type CommerceContextPort,type MetaAdsRepository,type MetaAdsStoreState,type PreparationAdmission} from '../domain/types.js';
import {requireEntitlement,requireIdentifier,stableDigest} from '../domain/offer.js';
import {defaultPreparationLimits as defaults,preparationQueue} from './preparation-queue.js';

interface Dependencies {repo:MetaAdsRepository;commerce:Pick<CommerceContextPort,'getPlan'>;authorizeActor(merchantId:string,actorId:string):Promise<void>;localDay(merchantId:string):Promise<string>;clock?:Clock}
export type OpportunityAdmissionInput=Pick<PreparationAdmission,'opportunityDigest'|'policyId'|'policyVersion'|'connectionEpoch'|'actorId'>;

export class PreparationLimitsService {
 private readonly clock:Clock;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 private async day(merchantId:string):Promise<string|null>{try{const day=await this.deps.localDay(merchantId);return /^\d{4}-\d{2}-\d{2}$/.test(day)&&new Date(day).toISOString().slice(0,10)===day?day:null;}catch{return null;}}
 private projection(state:MetaAdsStoreState,day:string|null,plan:string):MetaAdsPreparationLimitsView{
  const limits=state.preparationLimits??defaults();let capacity=0,reason:string|null=null;
  try{capacity=requireEntitlement(plan,state,this.clock()).offer.maxManagedCampaigns;}catch{reason='addon_not_entitled';}
  const admissions=Object.values(state.preparationAdmissions??{}),usedToday=admissions.filter(a=>a.accountLocalDay===day).length,queue=preparationQueue(state);
  const effectiveDailyLimit=Math.min(limits.dailyNewProposals,capacity),effectivePendingLimit=Math.min(limits.maximumPendingProposals,capacity);
  const occupied=Object.values(state.campaigns).filter(c=>c.managed).length+queue.unboundReservations;
  if(!reason)reason=!day?'meta_timezone_unavailable':!effectiveDailyLimit||!effectivePendingLimit?'preparation_disabled':occupied>=capacity?'campaign_capacity_exceeded':queue.pending>=effectivePendingLimit?'preparation_pending_limit':usedToday>=effectiveDailyLimit?'preparation_daily_limit':null;
  return{limits:structuredClone(limits),effectiveDailyLimit,effectivePendingLimit,planCampaignCapacity:capacity,usedToday,pending:queue.pending,availableToday:Math.max(0,effectiveDailyLimit-usedToday),availablePendingSlots:Math.max(0,Math.min(effectivePendingLimit-queue.pending,capacity-occupied)),localDay:day,blockedReason:reason};
 }
 async view(merchantId:string):Promise<MetaAdsPreparationLimitsView>{requireIdentifier(merchantId);const [state,day,plan]=await Promise.all([this.deps.repo.read(merchantId),this.day(merchantId),this.deps.commerce.getPlan(merchantId)]);return this.projection(state,day,plan);}
 async update(merchantId:string,actorId:string,input:MetaAdsPreparationLimitsInput):Promise<MetaAdsPreparationLimitsView>{
  requireIdentifier(merchantId);requireIdentifier(actorId);await this.deps.authorizeActor(merchantId,actorId);
  if(!input||Object.keys(input).length!==3||Object.keys(input).some(k=>!['dailyNewProposals','maximumPendingProposals','expectedVersion'].includes(k))||Object.values(input).some(v=>!Number.isSafeInteger(v)||v<0))throw new MetaAdsError('preparation_limits_invalid');
  const [plan,day]=await Promise.all([this.deps.commerce.getPlan(merchantId),this.day(merchantId)]);
  return this.deps.repo.mutate(merchantId,[],state=>{
   const capacity=requireEntitlement(plan,state,this.clock()).offer.maxManagedCampaigns;
   if(input.dailyNewProposals>capacity||input.maximumPendingProposals>capacity)throw new MetaAdsError('preparation_limits_invalid');
   const previous=state.preparationLimits??defaults();if(previous.version!==input.expectedVersion)throw new MetaAdsError('preparation_limits_version_changed',409);
   const now=this.clock().toISOString();state.preparationLimits={dailyNewProposals:input.dailyNewProposals,maximumPendingProposals:input.maximumPendingProposals,version:previous.version+1,updatedAt:now};
   return{result:this.projection(state,day,plan),records:[{key:`preparation-limits:${previous.version+1}`,kind:'audit',payload:{actorId,limits:state.preparationLimits},createdAt:now}]};
  });
 }
 async admit(merchantId:string,input:OpportunityAdmissionInput):Promise<PreparationAdmission>{
  requireIdentifier(merchantId);requireIdentifier(input.actorId);requireIdentifier(input.policyId);await this.deps.authorizeActor(merchantId,input.actorId);
  if(!/^[a-f0-9]{64}$/.test(input.opportunityDigest)||!Number.isSafeInteger(input.policyVersion)||input.policyVersion<1||!Number.isSafeInteger(input.connectionEpoch)||input.connectionEpoch<0)throw new MetaAdsError('preparation_admission_invalid');
  const [plan,day]=await Promise.all([this.deps.commerce.getPlan(merchantId),this.day(merchantId)]),id=`opportunity_${stableDigest({merchantId,policyId:input.policyId,opportunityDigest:input.opportunityDigest})}`;
  return this.deps.repo.mutate(merchantId,[],state=>{
   requireEntitlement(plan,state,this.clock());
   if(state.automation?.activePolicyId!==input.policyId||state.automation.version!==input.policyVersion||state.connection.epoch!==input.connectionEpoch)throw new MetaAdsError('automatic_authority_unavailable',409);
   const existing=state.preparationAdmissions?.[id];if(existing)return{result:existing};
   const view=this.projection(state,day,plan);if(view.blockedReason)throw new MetaAdsError(view.blockedReason,409);
   const now=this.clock().toISOString(),admission:PreparationAdmission={...input,id,accountLocalDay:day!,campaignId:null,state:'reserved',createdAt:now,updatedAt:now,error:null};
   (state.preparationAdmissions??={})[id]=admission;
   return{result:admission,records:[{key:`preparation-admission:${id}`,kind:'audit',payload:{id,actorId:input.actorId,opportunityDigest:input.opportunityDigest,policyId:input.policyId,policyVersion:input.policyVersion},createdAt:now}]};
  });
 }
 async checkpoint(merchantId:string,id:string,patch:Pick<PreparationAdmission,'state'|'error'>&{campaignId?:string}):Promise<PreparationAdmission>{
  requireIdentifier(merchantId);requireIdentifier(id);if(patch.campaignId)requireIdentifier(patch.campaignId);
  return this.deps.repo.mutate(merchantId,[],state=>{const admission=state.preparationAdmissions?.[id];if(!admission)throw new MetaAdsError('preparation_admission_not_found',404);if(admission.state==='closed'&&patch.state!=='closed')throw new MetaAdsError('preparation_admission_closed',409);Object.assign(admission,patch,{updatedAt:this.clock().toISOString()});return{result:admission};});
 }
}
