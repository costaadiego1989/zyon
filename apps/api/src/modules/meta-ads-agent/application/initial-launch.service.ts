import type {MetaAdsApproveLaunchInput,MetaAdsCampaignLaunchReview,MetaAdsCampaignDraft,MetaAdsProduct} from '@zyon/shared-types';
import {MetaAdsError,type MetaAdsRepository,type CommerceContextPort,type Clock} from '../domain/types.js';
import {requireIdentifier,requireEntitlement,stableDigest} from '../domain/offer.js';
import {publicCampaignReadyNotice,type CampaignReadyNoticeRepository} from '../domain/campaign-ready-notice.port.js';
import type {CampaignPreparationRepository} from '../domain/campaign-preparation.port.js';
import {assertReviewedProposal} from './proposal.service.js';
import type {ProposalService} from './proposal.service.js';
import type {CampaignService} from './campaign.service.js';
import type {ExecutionService} from './execution.service.js';
import {budgetBlocker,type CampaignBudgetAssessmentPort} from './budget-guidance.js';

interface Dependencies{
  repo:MetaAdsRepository;commerce:Pick<CommerceContextPort,'getPlan'|'products'>;
  campaigns:Pick<CampaignService,'owned'|'readiness'>;proposals:Pick<ProposalService,'approve'>;executions:Pick<ExecutionService,'execute'>;
  preparations:Pick<CampaignPreparationRepository,'list'>;notices:Pick<CampaignReadyNoticeRepository,'list'|'setReviewState'>;
  authorizeActor:(merchantId:string,actorId:string)=>Promise<void>;enabled:()=>boolean;clock?:Clock;
  budgetAssessment?:CampaignBudgetAssessmentPort;
}
export class InitialLaunchService{
  private readonly clock:Clock;private timer:ReturnType<typeof setInterval>|undefined;private active:Promise<void>|undefined;private stopping=false;
  constructor(private readonly deps:Dependencies){this.clock=deps.clock??(()=>new Date());}
  private async actor(merchantId:string,actorId:string){requireIdentifier(merchantId);requireIdentifier(actorId);await this.deps.authorizeActor(merchantId,actorId);}
  async review(merchantId:string,actorId:string,campaignId:string,proposalId?:string):Promise<MetaAdsCampaignLaunchReview>{
    await this.actor(merchantId,actorId);requireIdentifier(campaignId);if(proposalId)requireIdentifier(proposalId);
    const current=await this.deps.campaigns.owned(merchantId,campaignId),state=await this.deps.repo.read(merchantId);
    const candidates=Object.values(state.proposals).filter(p=>p.campaignId===campaignId&&p.kind==='launch').sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));
    const proposal=proposalId?candidates.find(p=>p.id===proposalId):candidates.find(p=>p.status==='pending_review'||p.status==='approved')??candidates[0];
    if(!proposal)throw new MetaAdsError('proposal_not_found',404);
    assertReviewedProposal(merchantId,proposal,await this.deps.repo.getRecord(merchantId,`proposal-version:${proposal.id}`));
    const missing:string[]=[];
    const budgetIssue=budgetBlocker(await this.deps.budgetAssessment?.(merchantId,current.draft.budget));if(budgetIssue)missing.push(budgetIssue);
    try{requireEntitlement(await this.deps.commerce.getPlan(merchantId),state,this.clock());}catch(error){missing.push(error instanceof MetaAdsError?error.code:'addon_not_entitled');}
    if(!this.deps.enabled())missing.push('campaign_launch_unavailable');
    if(!state.connection.capabilities.publish)missing.push('meta_capability_unavailable');
    try{missing.push(...(await this.deps.campaigns.readiness(merchantId,campaignId)).missingSetup);}catch(error){missing.push(error instanceof MetaAdsError?error.code:'campaign_data_unavailable');}
    const products=await this.deps.commerce.products(merchantId,{variantIds:current.draft.variantIds});
    const productMap=(values:MetaAdsProduct[])=>Object.fromEntries(values.map(p=>[p.variantId,p]));
    if(proposal.connectionEpoch!==state.connection.epoch||['stale','rejected'].includes(proposal.status)||stableDigest(proposal.after.draft)!==stableDigest(current.draft)||stableDigest(productMap(proposal.after.products as MetaAdsProduct[]))!==stableDigest(productMap(products))||stableDigest(current.draft.mediaIds.map(id=>state.media[id]??null))!==stableDigest(proposal.after.media)||
      proposal.after.accountId!==(state.connection.account?.id??null)||proposal.after.pageId!==(state.connection.page?.id??null)||proposal.after.datasetId!==(state.connection.dataset?.id??null)||proposal.after.whatsappId!==(state.connection.whatsapp?.id??null))missing.push('proposal_stale');
    const preparations=await this.deps.preparations.list(merchantId,campaignId),notices=await this.deps.notices.list(merchantId,campaignId);
    const preparation=preparations.find(job=>job.proposalId===proposal.id)??null,notice=notices.find(n=>n.proposalId===proposal.id&&n.proposalDigest===proposal.digest)??null;
    if(notice?.reviewState==='superseded')missing.push('proposal_stale');
    // The displayed material is the frozen review, even when the live campaign changed.
    const campaign={...current,draft:structuredClone(proposal.after.draft) as MetaAdsCampaignDraft,products:structuredClone(proposal.after.products) as MetaAdsProduct[]};
    const execution=proposal.executionId?state.executions[proposal.executionId]??null:null;
    await this.actor(merchantId,actorId);
    return{campaign,proposal,media:structuredClone(proposal.after.media) as MetaAdsCampaignLaunchReview['media'],preparation:preparation?{id:preparation.id,campaignId,requestedImages:preparation.requestedImages,intentDigest:preparation.intentDigest,status:preparation.status,generationId:preparation.generationId,proposalId:preparation.proposalId,missing:preparation.missing,error:preparation.error,createdAt:preparation.createdAt,updatedAt:preparation.updatedAt}:null,
      notice:notice?publicCampaignReadyNotice(notice):null,execution,canApprove:proposal.status==='pending_review'&&!proposal.executionId&&missing.length===0,missing:[...new Set(missing)]};
  }
  async approveAndLaunch(merchantId:string,actorId:string,campaignId:string,proposalId:string,input:MetaAdsApproveLaunchInput):Promise<MetaAdsCampaignLaunchReview>{
    await this.actor(merchantId,actorId);requireIdentifier(campaignId);requireIdentifier(proposalId);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).length!==2||Object.keys(input).some(key=>!['digest','idempotencyKey'].includes(key))||!/^[a-f0-9]{64}$/.test(input.digest))throw new MetaAdsError('launch_request_invalid');
    requireIdentifier(input.idempotencyKey);const key=`launch-request:${input.idempotencyKey}`,hash=stableDigest({campaignId,proposalId,actorId,digest:input.digest});
    const previous=await this.deps.repo.getRecord<{hash:string}>(merchantId,key);
    if(previous&&previous.payload.hash!==hash)throw new MetaAdsError('launch_request_conflict',409);
    const view=await this.review(merchantId,actorId,campaignId,proposalId);
    if(view.proposal.digest!==input.digest)throw new MetaAdsError('proposal_version_changed',409);
    if(previous&&view.proposal.approvedBy===actorId&&view.proposal.executionId)return view;
    const recoverable=previous&&view.proposal.status==='approved'&&view.proposal.approvedBy===actorId&&!view.proposal.executionId;
    if(!view.canApprove&&!recoverable)throw new MetaAdsError(view.missing[0]??'proposal_not_pending',409);
    if(view.missing.length)throw new MetaAdsError(view.missing[0],409);
    await this.deps.repo.mutate(merchantId,[key],(_state,records)=>{
      const current=records.get(key)?.payload as {hash:string}|undefined;
      if(current&&current.hash!==hash)throw new MetaAdsError('launch_request_conflict',409);
      return{result:null,records:current?[]:[{key,kind:'audit',payload:{hash,campaignId,proposalId,actorId,digest:input.digest},createdAt:this.clock().toISOString()}]};
    });
    await this.actor(merchantId,actorId);await this.deps.proposals.approve(merchantId,proposalId,actorId,input.digest);
    for(const notice of await this.deps.notices.list(merchantId,campaignId))if(notice.proposalId===proposalId&&notice.proposalDigest===input.digest)await this.deps.notices.setReviewState(merchantId,notice.id,'approved');
    return this.review(merchantId,actorId,campaignId,proposalId);
  }
  onModuleInit(){if(this.deps.enabled()){this.timer=setInterval(()=>{void this.drain();},3000);this.timer.unref();void this.drain();}}
  async onModuleDestroy(){this.stopping=true;clearInterval(this.timer);await this.active;}
  drain():Promise<void>{if(this.stopping||!this.deps.enabled())return Promise.resolve();return this.active??=this.run().catch(()=>undefined).finally(()=>{this.active=undefined;});}
  private async run(){
    let after:string|undefined;
    while(!this.stopping&&this.deps.enabled()){
      const stores=await this.deps.repo.listStoreIds(100,after);if(!stores.length)return;
      for(const merchantId of stores){
        const state=await this.deps.repo.read(merchantId);
        for(const proposal of Object.values(state.proposals))if(proposal.kind==='launch'&&proposal.status==='approved'&&proposal.approvedBy&&!proposal.executionId){
          if(this.stopping||!this.deps.enabled())return;
          try{await this.actor(merchantId,proposal.approvedBy);await this.deps.executions.execute(merchantId,proposal.id,proposal.approvedBy);}catch{/* Current authority or version blocks this store without granting another write. */}
        }
      }
      if(stores.length<100)return;after=stores.at(-1);
    }
  }
}
