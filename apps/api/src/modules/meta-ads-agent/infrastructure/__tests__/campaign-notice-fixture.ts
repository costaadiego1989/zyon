import {CampaignReadyNoticeSender} from '../campaign-ready-notice.sender.js';
import {campaignLaunchFixture} from '../../application/__tests__/launch-fixture.js';
import {CampaignNoticeContactService} from '../../application/campaign-notice-contact.service.js';
import {InitialLaunchService} from '../../application/initial-launch.service.js';
import {WhatsAppTemplateSenderAdapter} from '../../../whatsapp-templates/infrastructure/adapters/whatsapp-template-sender.adapter.js';
import {getTemplateDefinition} from '../../../whatsapp-templates/domain/catalog/template-catalog.js';
import type {WhatsAppTemplateRecord,WhatsAppTemplateRepositoryPort} from '../../../whatsapp-templates/domain/ports/whatsapp-template-repository.port.js';
import type {WhatsAppChannelConfigEntity,WhatsAppConfigRepository} from '../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js';

export async function campaignNoticeFixture(options:{inbox?:boolean;claim?:boolean;enabled?:()=>boolean;contact?:boolean}={}){
  const f=await campaignLaunchFixture(),originalFetch=globalThis.fetch;let transport='accepted';const requests:Array<{url:string;init?:RequestInit}>=[];
  const config:WhatsAppChannelConfigEntity={id:'config-a',merchantId:'store-a',enabled:true,provider:'META_CLOUD',status:'ACTIVE',credentials:{accessToken:'store-a-private-token',wabaId:'123456789',phoneNumberId:'987654321'},whatsappNumber:'+5511999990000',createdAt:new Date(),updatedAt:new Date()};
  const def=getTemplateDefinition('campaign_ready','Loja Aurora');
  const template:WhatsAppTemplateRecord={id:'template-a',merchantId:'store-a',type:'campaign_ready',channel:'whatsapp',name:def.label,body:def.freeformBody,subject:null,isActive:true,metaCategory:def.category,metaLanguage:'pt_BR',metaTemplateBody:def.metaBody,metaVariableMap:def.variableMap,twilioContentSid:'store_campaign_ready',metaStatus:'approved',metaRejectionReason:null,metaWabaId:'123456789',metaRevision:1,metaLastCheckedAt:new Date(),createdAt:new Date(),updatedAt:new Date()};
  const configs={findByMerchantId:async()=>structuredClone(config)} as unknown as WhatsAppConfigRepository;
  const templates={findByMerchantAndType:async()=>structuredClone(template)} as unknown as WhatsAppTemplateRepositoryPort;
  let duringSync=async()=>{};
  const templateSender=new WhatsAppTemplateSenderAdapter(configs,templates,{createAndSubmit:async()=>{throw Error('not authorized');},syncStatus:async(_merchant,sid)=>{await duringSync();return{status:'approved',contentSid:sid};}});
  globalThis.fetch=async(url,init)=>{requests.push({url:String(url),init});if(transport==='timeout')throw Error('lost store-a-private-token');if(transport==='empty')return Response.json({});if(transport==='reject')return new Response('rejected',{status:400});if(transport==='server')return new Response('error',{status:503});return Response.json({messages:[{id:'wamid.campaign-a'}]});};
  const contacts=new CampaignNoticeContactService({db:f.prisma,authorizeActor:f.authorizeActor,senderNumber:async()=>config.whatsappNumber??null,clock:f.clock});
  if(options.contact!==false)await contacts.save('store-a','owner-a',{phoneNumber:'+5511988887777',consented:true,expectedVersion:0});
  const launches=new InitialLaunchService({repo:f.repo,commerce:f.commerce,campaigns:f.service.campaigns,proposals:f.service.proposals,executions:f.executions,preparations:f.preparations,notices:f.notices,authorizeActor:f.authorizeActor,enabled:()=>true,clock:f.clock});
  const sender=new CampaignReadyNoticeSender({db:f.prisma,notices:f.notices,configs,templates,templateSender,launches,authorizeActor:f.authorizeActor,storeName:async()=> 'Loja Aurora',dashboardUrl:'https://dashboard.example.test',clock:f.clock,enabled:options.enabled});
  const p=await f.propose('launch'),notice=await f.notices.admit({merchantId:'store-a',campaignId:f.campaignId,proposalId:p.id,proposalDigest:p.digest});
  if(options.inbox!==false)await f.notices.ensureInbox('store-a',notice.id,{campaignName:'Camisa',reviewUrl:`https://dashboard.example.test/#meta-ads-agent?store=store-a&campaign=${f.campaignId}&proposal=${p.id}`});
  const lease=(options.claim===false?undefined:await f.notices.claim('store-a',notice.id))!;
  return{...f,p,notice,lease,sender,launches,contacts,config,template,requests,transport:(value:string)=>{transport=value;},duringSync:(fn:()=>Promise<void>)=>{duringSync=fn;},close:async()=>{globalThis.fetch=originalFetch;await f.close();}};
}
