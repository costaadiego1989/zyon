import type {MetaAdsCampaign} from '@zyon/shared-types';
import {MetaAdsError,type MetaAdsRepository,type CommerceContextPort,type Clock,type PreparationGenerationAuthority} from '../domain/types.js';
import {requireEntitlement,stableDigest} from '../domain/offer.js';
import {campaignPreparationContent,campaignPreparationDigest,campaignPreparationIntent} from '../domain/campaign-preparation.js';
import type {CampaignPreparationJob,CampaignPreparationLease,CampaignPreparationRepository} from '../domain/campaign-preparation.port.js';
import type {CampaignReadyNoticeRepository} from '../domain/campaign-ready-notice.port.js';
import type {CampaignService} from '../application/campaign.service.js';
import type {ConnectionService} from '../application/connection.service.js';
import type {GenerationService} from '../application/generation.service.js';
import type {ProposalService} from '../application/proposal.service.js';
import {budgetBlocker,type CampaignBudgetAssessmentPort} from '../application/budget-guidance.js';
import type {CatalogCreativeService} from '../application/catalog-creative.service.js';
import {creditWallet} from '../application/credits.service.js';

interface Dependencies{
  repo:MetaAdsRepository;commerce:Pick<CommerceContextPort,'getPlan'|'products'>;campaigns:Pick<CampaignService,'owned'|'save'>;
  connection:Pick<ConnectionService,'access'>;generations:Pick<GenerationService,'request'>&Partial<Pick<GenerationService,'configured'>>;proposals:Pick<ProposalService,'create'>;
  preparations:CampaignPreparationRepository;notices:Pick<CampaignReadyNoticeRepository,'admit'|'list'|'setReviewState'>;
  authorizeActor:(merchantId:string,actorId:string)=>Promise<void>;enabled:()=>boolean;clock?:Clock;
  authorizeCampaign?:(merchantId:string,actorId:string,campaignId:string)=>Promise<void>;
  budgetAssessment?:CampaignBudgetAssessmentPort;
  catalogCreatives?:Pick<CatalogCreativeService,'capture'>;
}
export class CampaignPreparationWorker{
  private timer:ReturnType<typeof setInterval>|undefined;private active:Promise<void>|undefined;private stopping=false;
  constructor(private readonly deps:Dependencies){}
  onModuleInit(){if(this.deps.enabled()){this.timer=setInterval(()=>{void this.drain();},3000);this.timer.unref();void this.drain();}}
  async onModuleDestroy(){this.stopping=true;clearInterval(this.timer);await this.active;}
  drain():Promise<void>{if(this.stopping||!this.deps.enabled())return Promise.resolve();return this.active??=this.run().catch(()=>undefined).finally(()=>{this.active=undefined;});}
  private async context(job:CampaignPreparationJob){
    await this.deps.authorizeActor(job.merchantId,job.requestedBy);
    await this.deps.authorizeCampaign?.(job.merchantId,job.requestedBy,job.campaignId);
    if(!this.deps.enabled())throw new MetaAdsError('campaign_preparation_unavailable',503);
    const state=await this.deps.repo.read(job.merchantId);requireEntitlement(await this.deps.commerce.getPlan(job.merchantId),state,(this.deps.clock??(()=>new Date()))());
    const campaign=await this.deps.campaigns.owned(job.merchantId,job.campaignId);
    const budgetIssue=budgetBlocker(await this.deps.budgetAssessment?.(job.merchantId,campaign.draft.budget));if(budgetIssue)throw new MetaAdsError(budgetIssue,409);
    if(campaign.remoteCampaignId||campaignPreparationIntent(job.merchantId,campaign,job.requestedImages)!==job.intentDigest)throw new MetaAdsError('preparation_intent_changed',409);
    const products=await this.deps.commerce.products(job.merchantId,{variantIds:campaign.draft.variantIds});
    const content=campaignPreparationContent(campaign,products,Object.values(state.media));
    const fatal=content.missing.filter(code=>!['campaign_media_required','creative_terms_unverified','campaign_media_unavailable'].includes(code));
    if(fatal.length)throw new MetaAdsError(fatal[0],409);
    const access=await this.deps.connection.access(job.merchantId,{destination:campaign.draft.destination,operation:'prepare'});
    return{state,campaign,content,access};
  }
  /** Called by GenerationService for the atomic server-only purpose, before every paid dispatch. */
  async authorizeGeneration(merchantId:string,authority:PreparationGenerationAuthority,frozen:MetaAdsCampaign):Promise<void>{
    const job=await this.deps.preparations.read(merchantId,authority.preparationId);
    const context=await this.context(job);
    if(!['queued','preparing','creative_pending'].includes(job.status)||job.intentDigest!==authority.intentDigest||frozen.id!==job.campaignId||campaignPreparationIntent(merchantId,frozen,job.requestedImages)!==authority.intentDigest||context.campaign.id!==frozen.id)throw new MetaAdsError('generation_authority_unavailable',409);
  }
  private async blocked(lease:CampaignPreparationLease,code:string,status:'blocked'|'creative_pending'|'unknown'='blocked'){
    await this.deps.preparations.checkpoint(lease,{missing:[code],error:code});await this.deps.preparations.finish(lease,status);
  }
  private async process(lease:CampaignPreparationLease){
    let current=lease;
    const heartbeat=setInterval(()=>{void this.deps.preparations.heartbeat(current).catch(()=>undefined);},30000);heartbeat.unref();
    try{
      let context=await this.context(current);await this.deps.preparations.heartbeat(current);
      let generation=current.generationId?context.state.generations[current.generationId]:null;
      if(current.generationId&&!generation){await this.blocked(current,'generation_input_missing','unknown');return;}
      let needed=Math.max(0,current.requestedImages-context.content.reusableMediaIds.length);
      if(generation?.status==='unknown'){await this.blocked(current,'image_provider_outcome_unknown','unknown');return;}
      const wallet=creditWallet(context.state,(this.deps.clock??(()=>new Date()))());
      const fallback=needed&&this.deps.catalogCreatives&&(!generation&&(this.deps.generations.configured?.()===false||needed>wallet.monthlyAvailable+wallet.extraAvailable)||generation&&['failed','partial'].includes(generation.status));
      if(fallback){await this.deps.catalogCreatives!.capture(current.merchantId,current.campaignId,current.requestedImages);context=await this.context(current);needed=Math.max(0,current.requestedImages-context.content.reusableMediaIds.length);}
      if(!generation&&needed){
        generation=await this.deps.generations.request(current.merchantId,current.campaignId,{imageCount:needed,idempotencyKey:`prep-image-${current.id}`},{preparationId:current.id,intentDigest:current.intentDigest});
        current=await this.deps.preparations.checkpoint(current,{generationId:generation.id});
      }
      if(generation){
        if(generation.status==='unknown'){await this.blocked(current,'image_provider_outcome_unknown','unknown');return;}
        if(['reserved','running'].includes(generation.status)){await this.blocked(current,'creative_generation_pending','creative_pending');return;}
        if(generation.status!=='succeeded'&&needed>0){await this.blocked(current,generation.error??'image_generation_incomplete');return;}
      }
      context=await this.context(current);
      const selected=[...new Set([...context.campaign.draft.mediaIds.filter(id=>context.content.reusableMediaIds.includes(id)),...context.content.reusableMediaIds])].slice(0,current.requestedImages);
      if(selected.length<current.requestedImages){
        const rejected=generation?.mediaIds.some(id=>context.state.media[id]?.commercialReview?.status==='rejected');
        await this.blocked(current,rejected?'creative_terms_mismatch':'creative_terms_unverified',rejected?'blocked':'creative_pending');return;
      }
      if(stableDigest(selected)!==stableDigest(context.campaign.draft.mediaIds))await this.deps.campaigns.save(current.merchantId,current.campaignId,{...context.campaign.draft,mediaIds:selected});
      context=await this.context(current);
      if(!context.content.ready){await this.blocked(current,context.content.missing[0]);return;}
      await this.deps.preparations.heartbeat(current);
      current=await this.deps.preparations.checkpoint(current,{campaignDigest:campaignPreparationDigest(context.campaign),checkpoint:{...current.checkpoint,mediaIds:selected},missing:[],error:null});
      let key=current.checkpoint.proposalRequestKey;
      if(typeof key!=='string'){
        key=`launch_${current.id}_${stableDigest({digest:current.campaignDigest,epoch:context.access.connectionEpoch,media:selected.map(id=>context.state.media[id]),fence:current.fence})}`;
        current=await this.deps.preparations.checkpoint(current,{checkpoint:{...current.checkpoint,proposalRequestKey:key}});
      }
      const proposal=await this.deps.proposals.create(current.merchantId,current.campaignId,{kind:'launch',reasoning:'Campanha preparada para sua revisão e aprovação administrativa',idempotencyKey:key as string});
      current=await this.deps.preparations.checkpoint(current,{proposalId:proposal.id});
      context=await this.context(current);
      const live=(await this.deps.repo.read(current.merchantId)).proposals[proposal.id];
      if(!live||live.status!=='pending_review'||live.digest!==proposal.digest||live.connectionEpoch!==context.access.connectionEpoch||stableDigest(live.after.draft)!==stableDigest(context.campaign.draft)||stableDigest(live.after.media)!==stableDigest(context.campaign.draft.mediaIds.map(id=>context.state.media[id])))throw new MetaAdsError('proposal_stale',409);
      await this.deps.notices.admit({merchantId:current.merchantId,campaignId:current.campaignId,proposalId:proposal.id,proposalDigest:proposal.digest});
      for(const old of await this.deps.notices.list(current.merchantId,current.campaignId))if(old.proposalId!==proposal.id&&old.reviewState==='awaiting_approval')await this.deps.notices.setReviewState(current.merchantId,old.id,'superseded');
      await this.deps.preparations.finish(current,'review_ready');
    }catch(error){
      try{
        if(error instanceof MetaAdsError&&error.code==='preparation_intent_changed')await this.deps.preparations.finish(current,'superseded');
        else{const code=error instanceof MetaAdsError&&/^[a-z][a-z0-9_]{1,100}$/.test(error.code)?error.code:'campaign_preparation_failed';await this.blocked(current,code);}
      }catch{/* Fenced or deleted jobs cannot be revived by an old worker. */}
    }finally{clearInterval(heartbeat);}
  }
  private async run(){
    for(const job of await this.deps.preparations.pending(50)){
      if(this.stopping||!this.deps.enabled())return;
      try{const lease=await this.deps.preparations.claim(job.merchantId,job.id);if(lease)await this.process(lease);}catch{/* A store failure never grants another store's work. */}
    }
  }
}
