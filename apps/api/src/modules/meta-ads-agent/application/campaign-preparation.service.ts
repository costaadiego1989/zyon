import type {MetaAdsCampaignPreparationInput} from '@zyon/shared-types';
import {MetaAdsError,type MetaAdsRepository,type CommerceContextPort,type Clock} from '../domain/types.js';
import {requireIdentifier,requireEntitlement,stableDigest} from '../domain/offer.js';
import {campaignPreparationContent,campaignPreparationDigest,campaignPreparationIntent} from '../domain/campaign-preparation.js';
import {publicCampaignPreparation,type CampaignPreparationRepository} from '../domain/campaign-preparation.port.js';
import type {CampaignService} from './campaign.service.js';
import type {ConnectionService} from './connection.service.js';
import {creditWallet} from './credits.service.js';

interface Dependencies{
  repo:MetaAdsRepository;commerce:Pick<CommerceContextPort,'getPlan'|'products'>;campaigns:Pick<CampaignService,'owned'>;
  connection:Pick<ConnectionService,'access'>;preparations:CampaignPreparationRepository;
  authorizeActor:(merchantId:string,actorId:string)=>Promise<void>;enabled:()=>boolean;clock?:Clock;
  authorizePreparation?:(merchantId:string,actorId:string)=>Promise<void>;
}
export class CampaignPreparationService{
  private readonly clock:Clock;
  constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
  private async actor(merchantId:string,actorId:string,campaignId:string){for(const id of [merchantId,actorId,campaignId])requireIdentifier(id);await this.deps.authorizeActor(merchantId,actorId);}
  async read(merchantId:string,actorId:string,campaignId:string){
    await this.actor(merchantId,actorId,campaignId);const campaign=await this.deps.campaigns.owned(merchantId,campaignId);
    return{campaignDigest:campaignPreparationDigest(campaign),preparations:(await this.deps.preparations.list(merchantId,campaignId)).map(publicCampaignPreparation)};
  }
  async request(merchantId:string,actorId:string,campaignId:string,input:MetaAdsCampaignPreparationInput){
    await this.actor(merchantId,actorId,campaignId);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||Object.keys(input).some(key=>!['campaignDigest','imageCount'].includes(key))||!/^[a-f0-9]{64}$/.test(input.campaignDigest))throw new MetaAdsError('preparation_request_invalid');
    if(this.deps.enabled())await this.deps.authorizePreparation?.(merchantId,actorId);
    let state=await this.deps.repo.read(merchantId);requireEntitlement(await this.deps.commerce.getPlan(merchantId),state,this.clock());
    const campaign=await this.deps.campaigns.owned(merchantId,campaignId),digest=campaignPreparationDigest(campaign);
    if(digest!==input.campaignDigest)throw new MetaAdsError('preparation_version_changed',409);
    if(campaign.remoteCampaignId)throw new MetaAdsError('campaign_already_prepared',409);
    const intentDigest=campaignPreparationIntent(merchantId,campaign,input.imageCount),products=await this.deps.commerce.products(merchantId,{variantIds:campaign.draft.variantIds});
    const content=campaignPreparationContent(campaign,products,Object.values(state.media));
    const missing=content.missing.filter(code=>!['campaign_media_required','creative_terms_unverified','campaign_media_unavailable'].includes(code));
    if(!this.deps.enabled())missing.unshift('campaign_preparation_unavailable');
    try{await this.deps.connection.access(merchantId,{destination:campaign.draft.destination,operation:'prepare'});}catch(error){missing.push(error instanceof MetaAdsError?error.code:'meta_connection_required');}
    await this.actor(merchantId,actorId,campaignId);
    if(this.deps.enabled())await this.deps.authorizePreparation?.(merchantId,actorId);
    state=await this.deps.repo.read(merchantId);requireEntitlement(await this.deps.commerce.getPlan(merchantId),state,this.clock());
    if(!state.campaigns[campaignId]||campaignPreparationDigest(state.campaigns[campaignId])!==digest)throw new MetaAdsError('preparation_version_changed',409);
    let job=await this.deps.preparations.admit({merchantId,campaignId,intentDigest,campaignDigest:digest,requestedBy:actorId,requestedImages:input.imageCount});
    const wallet=creditWallet(state,this.clock()),needed=Math.max(0,input.imageCount-content.reusableMediaIds.length);
    if(!job.generationId&&needed>wallet.monthlyAvailable+wallet.extraAvailable)missing.push('image_credits_insufficient');
    const oldProposal=job.proposalId?state.proposals[job.proposalId]:null;
    const forceReview=job.status==='review_ready'&&(!oldProposal||oldProposal.connectionEpoch!==state.connection.epoch||['stale','rejected'].includes(oldProposal.status))||job.status==='blocked'&&missing.length===0;
    if(job.campaignDigest!==digest||job.requestedBy!==actorId||forceReview)job=await this.deps.preparations.revise(merchantId,job.id,job.campaignDigest,{campaignDigest:digest,requestedBy:actorId,forceReview});
    if(job.status==='unknown'||job.status==='review_ready')return publicCampaignPreparation(job);
    const auditKey=`preparation-request:${stableDigest({jobId:job.id,digest,actorId})}`;
    await this.deps.repo.mutate(merchantId,[auditKey],(_current,records)=>({result:null,records:records.has(auditKey)?[]:[{key:auditKey,kind:'audit',payload:{jobId:job.id,campaignId,campaignDigest:digest,intentDigest,requestedBy:actorId,requestedImages:input.imageCount},createdAt:this.clock().toISOString()}]}));
    if(missing.length){
      const lease=await this.deps.preparations.claim(merchantId,job.id);
      if(lease){await this.deps.preparations.checkpoint(lease,{missing:[...new Set(missing)],error:missing[0]});await this.deps.preparations.finish(lease,'blocked');}
      job=await this.deps.preparations.read(merchantId,job.id);
    }
    return publicCampaignPreparation(job);
  }
}
