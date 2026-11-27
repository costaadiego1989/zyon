import type {MetaAdsCampaignLaunchReview} from '@zyon/shared-types';
import {MetaAdsError,type Clock,type MetaAdsRepository} from '../domain/types.js';
import type {CampaignReadyNoticeRecord,CampaignReadyNoticeRepository} from '../domain/campaign-ready-notice.port.js';
import type {InitialLaunchService} from '../application/initial-launch.service.js';
import {campaignReadyReviewUrl,type CampaignReadyNoticeSender} from './campaign-ready-notice.sender.js';

interface Dependencies{
  repo:MetaAdsRepository;launches:Pick<InitialLaunchService,'review'>;notices:CampaignReadyNoticeRepository;sender:Pick<CampaignReadyNoticeSender,'send'>;
  /** Resolve a real current administrator for system business-data reads, never an approval. */
  reviewActor:(merchantId:string)=>Promise<string|null>;dashboardUrl:string;enabled:()=>boolean;whatsappEnabled?:()=>boolean;clock?:Clock;
}
export class CampaignReadyNoticeWorker{
  private timer:ReturnType<typeof setInterval>|undefined;private active:Promise<void>|undefined;private stopping=false;
  constructor(private readonly deps:Dependencies){}
  onModuleInit(){if(this.deps.enabled()){this.timer=setInterval(()=>{void this.drain();},3000);this.timer.unref();void this.drain();}}
  async onModuleDestroy(){this.stopping=true;clearInterval(this.timer);await this.active;}
  drain():Promise<void>{if(this.stopping||!this.deps.enabled())return Promise.resolve();return this.active??=this.run().catch(()=>undefined).finally(()=>{this.active=undefined;});}
  private async review(merchantId:string,campaignId:string){const actor=await this.deps.reviewActor(merchantId);if(!actor)throw new MetaAdsError('campaign_notice_administrator_unavailable',409);return this.deps.launches.review(merchantId,actor,campaignId);}
  private async inbox(notice:CampaignReadyNoticeRecord,name:string){return this.deps.notices.ensureInbox(notice.merchantId,notice.id,{campaignName:name,reviewUrl:campaignReadyReviewUrl(this.deps.dashboardUrl,notice.merchantId,notice.campaignId,notice.proposalId)});}
  private async close(notice:CampaignReadyNoticeRecord,state:'approved'|'superseded',name:string){
    if(notice.reviewState==='superseded'&&state==='approved')return;
    if(notice.reviewState!==state){await this.deps.notices.setReviewState(notice.merchantId,notice.id,state);await this.inbox(notice,name);}
    else if(!notice.inboxCreatedAt)await this.inbox(notice,name);
  }
  private async approved(view:MetaAdsCampaignLaunchReview,merchantId:string){
    const p=view.proposal;if(!p.approvedBy||!p.approvedAt||!['approved','executed'].includes(p.status))return false;
    const receipt=(await this.deps.repo.getRecord<Record<string,unknown>>(merchantId,`proposal-approval:${p.id}`))?.payload;
    return !!receipt&&receipt.actorId===p.approvedBy&&receipt.approvedAt===p.approvedAt&&receipt.digest===p.digest&&receipt.kind==='launch'&&receipt.campaignId===p.campaignId&&receipt.connectionEpoch===p.connectionEpoch;
  }
  private async reconcile(){
    let after:string|undefined;
    while(!this.stopping&&this.deps.enabled()){
      const stores=await this.deps.repo.listStoreIds(100,after);if(!stores.length)return;
      for(const merchantId of stores){
        const state=await this.deps.repo.read(merchantId);
        for(const campaign of Object.values(state.campaigns)){
          if(this.stopping||!this.deps.enabled())return;
          if(!Object.values(state.proposals).some(p=>p.campaignId===campaign.id&&p.kind==='launch'))continue;
          try{
            const view=await this.review(merchantId,campaign.id),approved=await this.approved(view,merchantId);
            for(const notice of await this.deps.notices.list(merchantId,campaign.id)){
              if(notice.proposalId!==view.proposal.id||notice.proposalDigest!==view.proposal.digest||view.missing.includes('proposal_stale'))await this.close(notice,'superseded',campaign.draft.name);
              else if(approved)await this.close(notice,'approved',campaign.draft.name);
              else if(notice.reviewState==='superseded'&&!notice.inboxCreatedAt)await this.inbox(notice,campaign.draft.name);
            }
            if(view.canApprove)await this.deps.notices.admit({merchantId,campaignId:campaign.id,proposalId:view.proposal.id,proposalDigest:view.proposal.digest});
          }catch{/* Current administrative access or data is required before admitting a new notice. */}
        }
      }
      if(stores.length<100)return;after=stores.at(-1);
    }
  }
  private async process(notice:CampaignReadyNoticeRecord){
    const state=await this.deps.repo.read(notice.merchantId),campaign=state.campaigns[notice.campaignId],proposal=state.proposals[notice.proposalId];
    if(!campaign||!proposal||proposal.campaignId!==notice.campaignId){await this.deps.notices.setReviewState(notice.merchantId,notice.id,'superseded');return;}
    if(notice.reviewState!=='awaiting_approval'){if(!notice.inboxCreatedAt)await this.inbox(notice,campaign.draft.name);return;}
    let view:MetaAdsCampaignLaunchReview;
    try{view=await this.review(notice.merchantId,notice.campaignId);}
    catch(error){const lease=await this.deps.notices.claim(notice.merchantId,notice.id);if(lease)await this.deps.notices.block(lease,error instanceof MetaAdsError?error.code:'campaign_notice_unavailable');return;}
    if(view.proposal.id!==notice.proposalId||view.proposal.digest!==notice.proposalDigest||view.missing.includes('proposal_stale')){await this.close(notice,'superseded',campaign.draft.name);return;}
    if(await this.approved(view,notice.merchantId)){await this.close(notice,'approved',campaign.draft.name);return;}
    if(!view.canApprove){const lease=await this.deps.notices.claim(notice.merchantId,notice.id);if(lease)await this.deps.notices.block(lease,view.missing[0]??'campaign_notice_review_unavailable');return;}
    if(!notice.inboxCreatedAt)await this.inbox(notice,campaign.draft.name);
    const lease=await this.deps.notices.claim(notice.merchantId,notice.id);if(!lease)return;
    if(this.deps.whatsappEnabled&&!this.deps.whatsappEnabled()){await this.deps.notices.block(lease,'campaign_notice_unavailable');return;}
    const heartbeat=setInterval(()=>{void this.deps.notices.heartbeat(lease).catch(()=>undefined);},30000);heartbeat.unref();
    try{await this.deps.sender.send(lease);}finally{clearInterval(heartbeat);}
  }
  private async run(){
    await this.reconcile();
    for(const notice of await this.deps.notices.pending(50)){
      if(this.stopping||!this.deps.enabled())return;
      try{await this.process(notice);}catch{/* Durable inbox/outbox state remains available to the next worker. */}
    }
  }
}
