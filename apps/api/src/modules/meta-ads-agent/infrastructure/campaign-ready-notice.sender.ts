import type {PrismaClient} from '@prisma/client';
import {MetaAdsError,type Clock} from '../domain/types.js';
import {stableDigest} from '../domain/offer.js';
import {CAMPAIGN_NOTICE_CONSENT_VERSION,publicCampaignReadyNotice,type CampaignReadyNoticeLease,type CampaignReadyNoticeRepository,type CampaignReadyNoticeRecord,type CampaignNoticeSendOutcome} from '../domain/campaign-ready-notice.port.js';
import type {InitialLaunchService} from '../application/initial-launch.service.js';
import type {WhatsAppConfigRepository} from '../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js';
import {connectedMetaCloudCredentials} from '../../whatsapp-channel/domain/services/connected-meta-cloud-credentials.js';
import type {WhatsAppTemplateRepositoryPort} from '../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js';
import type {WhatsAppTemplateSenderPort,TemplateSendResult} from '../../whatsapp-templates/domain/ports/whatsapp-template-sender.port.js';
import {isApprovedSalesTemplate,normalizeRecoveryRecipient} from '../../whatsapp-templates/domain/services/recovery-whatsapp-policy.js';
import {templateDispatchDigest} from '../../whatsapp-templates/domain/services/template-dispatch-binding.js';

interface Dependencies{
  db:PrismaClient;notices:CampaignReadyNoticeRepository;configs:Pick<WhatsAppConfigRepository,'findByMerchantId'>;
  templates:Pick<WhatsAppTemplateRepositoryPort,'findByMerchantAndType'>;templateSender:WhatsAppTemplateSenderPort;launches:Pick<InitialLaunchService,'review'>;
  authorizeActor:(merchantId:string,actorId:string)=>Promise<void>;storeName:(merchantId:string)=>Promise<string>;dashboardUrl:string;clock?:Clock;
  enabled?:()=>boolean;
}
export function campaignReadyReviewUrl(base:string,merchantId:string,campaignId:string,proposalId:string):string{
  try{const url=new URL(base);if(url.protocol!=='https:'||url.username||url.password||url.search)throw Error();url.hash=`meta-ads-agent?${new URLSearchParams({store:merchantId,campaign:campaignId,proposal:proposalId})}`;return url.href;}catch{throw new MetaAdsError('campaign_notice_review_url_invalid');}
}
export class CampaignReadyNoticeSender{
  constructor(private readonly deps:Dependencies){}
  private assertEnabled(){if(this.deps.enabled&&!this.deps.enabled())throw new MetaAdsError('campaign_notice_unavailable',409);}
  private async eligibility(notice:CampaignReadyNoticeRecord){
    this.assertEnabled();
    const contact=await this.deps.db.metaAdsCampaignNoticeContact.findUnique({where:{merchantId:notice.merchantId}});
    if(!contact?.phoneNumber||!contact.consentedBy||!contact.consentedAt||contact.consentVersion!==CAMPAIGN_NOTICE_CONSENT_VERSION)throw new MetaAdsError('campaign_notice_contact_required',409);
    await this.deps.authorizeActor(notice.merchantId,contact.consentedBy);
    const config=await this.deps.configs.findByMerchantId(notice.merchantId),credentials=connectedMetaCloudCredentials(config,notice.merchantId);
    if(!config||!credentials)throw new MetaAdsError('meta_connection_unavailable',409);
    const senderNumber=normalizeRecoveryRecipient(config.whatsappNumber??config.phoneNumber??'');
    if(!senderNumber)throw new MetaAdsError('meta_connection_unavailable',409);
    if(senderNumber===contact.phoneNumber)throw new MetaAdsError('campaign_notice_self_recipient',409);
    const template=await this.deps.templates.findByMerchantAndType(notice.merchantId,'campaign_ready','whatsapp');
    if(!isApprovedSalesTemplate(template,notice.merchantId,'campaign_ready',credentials.wabaId)||!template.metaTemplateBody||!template.metaVariableMap||!Number.isSafeInteger(template.metaRevision)||template.metaRevision!<1)throw new MetaAdsError('approved_template_unavailable',409);
    const map=template.metaVariableMap,semantics=Object.values(map),allowed=['campaignName','campaignVersion','campaignReviewLink','storeName'];
    if(semantics.some(name=>!allowed.includes(name))||new Set(semantics).size!==semantics.length||['campaignName','campaignVersion','campaignReviewLink'].some(name=>!semantics.includes(name))||Object.keys(map).sort((a,b)=>Number(a)-Number(b)).some((key,index)=>key!==String(index+1)))throw new MetaAdsError('campaign_notice_template_invalid',409);
    const view=await this.deps.launches.review(notice.merchantId,contact.consentedBy,notice.campaignId,notice.proposalId);
    if(!view.canApprove||view.proposal.digest!==notice.proposalDigest)throw new MetaAdsError('proposal_stale',409);
    this.assertEnabled();
    return{view,template,snapshot:{recipientNumber:contact.phoneNumber,contactVersion:contact.version,consentVersion:contact.consentVersion,consentedBy:contact.consentedBy,configId:config.id,wabaId:credentials.wabaId,phoneNumberId:credentials.phoneNumberId,senderNumber,templateName:template.twilioContentSid,templateLanguage:template.metaLanguage??'pt_BR',templateRevision:template.metaRevision!,templateBodyDigest:templateDispatchDigest(template)}};
  }
  async send(lease:CampaignReadyNoticeLease){
    let current=await this.deps.notices.read(lease.merchantId,lease.id);
    if(current.dispatchStartedAt||['accepted','delivered','failed','unknown'].includes(current.whatsappStatus))return publicCampaignReadyNotice(current);
    let active=lease,started=false;
    try{
      const eligible=await this.eligibility(current);
      active=await this.deps.notices.pinRecipient(lease,eligible.snapshot);
      const values:Record<string,string>={campaignName:eligible.view.campaign.draft.name.replace(/\s+/g,' '),campaignVersion:current.proposalDigest.slice(0,12),campaignReviewLink:campaignReadyReviewUrl(this.deps.dashboardUrl,current.merchantId,current.campaignId,current.proposalId),storeName:await this.deps.storeName(current.merchantId)};
      const contentVariables=Object.fromEntries(Object.entries(eligible.template.metaVariableMap!).map(([position,name])=>[position,values[name]]));
      active=await this.deps.notices.startDispatch(active);started=true;
      let result:TemplateSendResult;
      try{result=await this.deps.templateSender.sendTemplate({merchantId:current.merchantId,type:'campaign_ready',toNumber:eligible.snapshot.recipientNumber,contentSid:eligible.snapshot.templateName,language:eligible.snapshot.templateLanguage,contentVariables,correlationId:active.deliveryId!,
        expectedConnection:{configId:eligible.snapshot.configId,wabaId:eligible.snapshot.wabaId,phoneNumberId:eligible.snapshot.phoneNumberId},expectedTemplate:{revision:eligible.snapshot.templateRevision,bodyDigest:eligible.snapshot.templateBodyDigest},
        assertDispatchAuthorized:async()=>{const latest=await this.eligibility(current);if(stableDigest(latest.snapshot)!==stableDigest(eligible.snapshot))throw new MetaAdsError('campaign_notice_contact_changed',409);await this.deps.authorizeActor(current.merchantId,eligible.snapshot.consentedBy);await this.deps.notices.assertDispatch(active);this.assertEnabled();}});}catch{result={status:'uncertain',messageId:'',reason:'provider_acceptance_unknown'};}
      const safeReason=typeof result.reason==='string'&&/^[a-z][a-z0-9_]{1,100}$/.test(result.reason)?result.reason:'provider_acceptance_unknown';
      const outcome:CampaignNoticeSendOutcome=result.status==='sent'&&result.messageId?{status:'accepted',messageId:result.messageId}:result.status==='skipped'||result.status==='failed'&&result.acceptance==='not_accepted'?{status:'not_dispatched',reason:safeReason}:{status:'unknown',reason:'provider_acceptance_unknown',...(result.messageId?{messageId:result.messageId}:{})};
      current=await this.deps.notices.completeDispatch(active,outcome);
    }catch(error){
      try{
        if(started)current=await this.deps.notices.completeDispatch(active,{status:'unknown',reason:'provider_acceptance_unknown'});
        else{const reason=error instanceof MetaAdsError&&/^[a-z][a-z0-9_]{1,100}$/.test(error.code)?error.code:'campaign_notice_unavailable';await this.deps.notices.block(active,reason);}
      }catch{/* An expired/closed dispatch stays preserved for reconciliation, never retried here. */}
      current=await this.deps.notices.read(lease.merchantId,lease.id);
    }
    return publicCampaignReadyNotice(current);
  }
}
