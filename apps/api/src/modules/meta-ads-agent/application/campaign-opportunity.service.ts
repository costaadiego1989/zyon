import type {MetaAdsAutomationPolicy,MetaAdsCampaign,MetaAdsOpportunitySummary} from '@zyon/shared-types';
import {MetaAdsError,type Clock,type CommerceContextPort,type MetaAdsRepository,type OpportunityModelPort,type PreparationAdmission,type ProductOpportunityFact,type ProductOpportunityReader} from '../domain/types.js';
import {stableDigest,requireIdentifier} from '../domain/offer.js';
import {campaignName} from '../domain/campaign-name.js';
import {campaignPreparationDigest} from '../domain/campaign-preparation.js';
import {assertCommercialTerms,type CampaignService} from './campaign.service.js';
import type {AutomationPolicyService} from './automation-policy.service.js';
import type {PreparationLimitsService} from './preparation-limits.service.js';
import type {CampaignPreparationService} from './campaign-preparation.service.js';
import type {ConnectionService} from './connection.service.js';
interface Dependencies {repo:MetaAdsRepository;commerce:Pick<CommerceContextPort,'products'>;policies:Pick<AutomationPolicyService,'view'>;limits:Pick<PreparationLimitsService,'view'|'admit'|'checkpoint'>;campaigns:Pick<CampaignService,'create'|'owned'>;preparation:Pick<CampaignPreparationService,'request'>;facts:ProductOpportunityReader;model:OpportunityModelPort;authorizeActor(merchantId:string,actorId:string):Promise<void>;connection:Pick<ConnectionService,'access'>;enabled():boolean;clock?:Clock}
const valid=(fact:ProductOpportunityFact,policy:MetaAdsAutomationPolicy)=>{const p=fact.product;let image=false;try{const url=new URL(p.imageUrl??'');image=url.protocol==='https:'&&!url.username&&!url.password;}catch{/* No product image. */}return policy.scope.variantIds.includes(p.variantId)&&p.active&&(p.stockQuantity===null||p.stockQuantity>0)&&p.currency==='BRL'&&Number.isSafeInteger(p.priceCents)&&p.priceCents>0&&image;};

export class CampaignOpportunityService {
 private readonly clock:Clock;
 constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
 private async authority(merchantId:string,expected:MetaAdsAutomationPolicy,admission?:PreparationAdmission){
  await this.deps.authorizeActor(merchantId,expected.acceptedBy);const current=await this.deps.policies.view(merchantId);
  if(!this.deps.enabled()||current.mode!=='automatic'||current.policy?.id!==expected.id||current.policy.version!==expected.version||current.policy.digest!==expected.digest)throw new MetaAdsError('automatic_authority_unavailable',409);
  const access=await this.deps.connection.access(merchantId,{destination:expected.scope.destination,operation:'prepare'});
  if(access.merchantId!==merchantId||access.accountId!==expected.accountId||access.connectionEpoch!==expected.connectionEpoch)throw new MetaAdsError('automatic_authority_unavailable',409);
  const limits=await this.deps.limits.view(merchantId);
  if(!admission&&limits.blockedReason)throw new MetaAdsError(limits.blockedReason,409);
  if(admission){if(!limits.effectiveDailyLimit||!limits.effectivePendingLimit)throw new MetaAdsError('preparation_disabled',409);if(limits.pending>limits.effectivePendingLimit)throw new MetaAdsError('preparation_pending_limit',409);if(limits.usedToday>limits.effectiveDailyLimit)throw new MetaAdsError('preparation_daily_limit',409);}
 }
 private summary(fact:ProductOpportunityFact,fields:string[]):MetaAdsOpportunitySummary{
  const values:Record<string,number|null>={stockQuantity:fact.product.stockQuantity,priceCents:fact.product.priceCents,paidUnits:fact.paidUnits,netRevenueCents:fact.netRevenueCents,adSpendCents:fact.adSpendCents,adPaidOrders:fact.adPaidOrders,historicalCostCents:fact.historicalCostCents};
  if(!fields.length||fields.some(field=>!Object.hasOwn(values,field)||values[field]===null))throw new MetaAdsError('opportunity_model_invalid',502);
  const observedAt=this.clock().toISOString(),quality=(fact.paidUnits??0)>0||(fact.adPaidOrders??0)>0?'observed':'initial_test';
  const stock=fact.product.stockQuantity===null?'Produto disponível':`${fact.product.stockQuantity} unidades em estoque`;
  const reason=quality==='initial_test'?`Teste inicial: ${stock.toLocaleLowerCase('pt-BR')}. Ainda não há vendas suficientes para comparar o desempenho.`:`${stock}. ${fact.paidUnits??0} unidades em pedidos pagos entre ${fact.since.slice(0,10)} e ${fact.until.slice(0,10)}. A escolha será testada, sem garantia de vendas.`;
  return{quality,reason,evidence:fields.map(field=>({field,value:values[field]!,observedAt}))};
 }
 private async prepare(merchantId:string,policy:MetaAdsAutomationPolicy,admission:PreparationAdmission,campaign:MetaAdsCampaign){
  await this.authority(merchantId,policy,admission);const current=await this.deps.campaigns.owned(merchantId,campaign.id);
  if(current.remoteCampaignId)return current;
  const job=await this.deps.preparation.request(merchantId,policy.acceptedBy,campaign.id,{campaignDigest:campaignPreparationDigest(current),imageCount:1});
  await this.deps.limits.checkpoint(merchantId,admission.id,{state:job.status==='review_ready'?'review_ready':job.status==='unknown'?'unknown':job.status==='blocked'?'blocked':'preparing',error:job.error});return current;
 }
 async evaluate(merchantId:string):Promise<MetaAdsCampaign|null>{
  requireIdentifier(merchantId);if(!this.deps.enabled())return null;const view=await this.deps.policies.view(merchantId),policy=view.policy;
  if(view.mode!=='automatic'||!policy||!policy.scope.allowNewCampaigns||!policy.scope.actions.includes('prepare'))return null;
  const state=await this.deps.repo.read(merchantId),resume=Object.values(state.preparationAdmissions??{}).find(a=>a.policyId===policy.id&&a.policyVersion===policy.version&&['reserved','preparing','blocked','unknown'].includes(a.state));
  await this.authority(merchantId,policy,resume);
  if(resume?.state==='unknown')throw new MetaAdsError('opportunity_outcome_unknown',409);
  if(resume?.campaignId){const campaign=state.campaigns[resume.campaignId];if(!campaign?.managed)return null;return this.prepare(merchantId,policy,resume,campaign);}
  const since=new Date(this.clock().getTime()-14*86400000).toISOString(),until=this.clock().toISOString();let candidates:ProductOpportunityFact[]=[];
  for(let i=0;i<policy.scope.variantIds.length;i+=30)candidates.push(...await this.deps.facts.read(merchantId,policy.scope.variantIds.slice(i,i+30),since,until));
  candidates=candidates.filter(f=>valid(f,policy)&&!Object.values(state.campaigns).some(c=>c.managed&&c.draft.priority===policy.scope.priority&&c.draft.destination===policy.scope.destination&&c.draft.variantIds.includes(f.product.variantId))).sort((a,b)=>(b.paidUnits??-1)-(a.paidUnits??-1)||a.product.variantId.localeCompare(b.product.variantId)).slice(0,10);
  if(!candidates.length)return null;
  const opportunityDigest=stableDigest({accountId:policy.accountId,priority:policy.scope.priority,destination:policy.scope.destination,country:policy.scope.country,products:candidates.map(c=>({variantId:c.product.variantId,version:c.product.commercialVersion}))});
  const admission=resume??await this.deps.limits.admit(merchantId,{opportunityDigest,policyId:policy.id,policyVersion:policy.version,connectionEpoch:policy.connectionEpoch,actorId:policy.acceptedBy});
  try{
   const selected=await this.deps.model.plan({merchantId,actorId:policy.acceptedBy,planningKey:admission.id,priority:policy.scope.priority,destination:policy.scope.destination,candidates});
   const fact=candidates.find(c=>c.product.variantId===selected.variantId);if(!fact)throw new MetaAdsError('opportunity_model_invalid',502);
   await this.authority(merchantId,policy,admission);
   const [fresh]=await this.deps.commerce.products(merchantId,{variantIds:[fact.product.variantId]});
   if(!fresh||fresh.commercialVersion!==fact.product.commercialVersion||!valid({...fact,product:fresh},policy))throw new MetaAdsError('campaign_products_unavailable',409);
   const draft={name:campaignName({products:[fresh],priority:policy.scope.priority,destination:policy.scope.destination}),destination:policy.scope.destination,priority:policy.scope.priority,country:policy.scope.country,variantIds:[fresh.variantId],mediaIds:[],headline:selected.headline,primaryText:selected.primaryText,budget:{amountCents:policy.limits.campaignCeilingCents,currency:policy.limits.currency,cadence:policy.limits.cadence,startsAt:new Date(Math.max(Date.parse(policy.limits.startsAt),this.clock().getTime())).toISOString(),endsAt:policy.limits.endsAt}};
   assertCommercialTerms(draft,[fresh]);const campaign=await this.deps.campaigns.create(merchantId,draft,`auto-${admission.id}`,{admissionId:admission.id,opportunity:this.summary({...fact,product:fresh},selected.evidenceFields)});
   return this.prepare(merchantId,policy,{...admission,campaignId:campaign.id},campaign);
  }catch(error){await this.deps.limits.checkpoint(merchantId,admission.id,{state:error instanceof Error&&'code' in error&&error.code==='assistant_outcome_unknown'?'unknown':'blocked',error:error instanceof MetaAdsError?error.code:'opportunity_planning_unavailable'});throw error;}
 }
}
