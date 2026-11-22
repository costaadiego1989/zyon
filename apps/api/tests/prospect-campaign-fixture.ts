import { createProspectCrmFixture } from "./prospect-crm-fixture.js";
import { campaignContentHash } from "../src/modules/platform-prospecting/domain/campaigns/prospecting-campaign.js";
import { protectedContactLookups } from "../src/modules/platform-prospecting/infrastructure/crm/prisma-prospect-privacy.repository.js";
export const fixtureOffer={planKey:"growth",version:"v1",name:"Growth",price:{amountCents:9900,currency:"BRL"},billingCycle:"monthly",features:["synthetic"],canonicalUrl:"https://zyon.test/growth"};
export const fixtureWindow={timezone:"America/Sao_Paulo",weekdays:[1,2,3,4,5],start:"09:00",end:"18:00"};
export const fixtureTemplate={id:"template",wabaId:"waba",name:"hello",language:"pt_BR",revision:"hash",category:"MARKETING" as const,status:"APPROVED",previewText:"synthetic offer",requiresParameters:false};
export async function createCampaignFixture(){
 const f=await createProspectCrmFixture(); const keys={currentVersion:1,keys:{1:"a".repeat(64)}};
 try {
  const lead=await f.prisma.platformProspect.create({data:{cnpj:"00000000000191",sourceSnapshotId:"search-old"}});
  const identity={kind:"phone" as const,value:"+5511999999999",businessScope:null};
  const endpoint=await f.prisma.prospectEndpoint.create({data:{channel:"whatsapp",senderBindingId:"sender",normalizedValue:identity.value,...protectedContactLookups(identity,keys)[0]}});
  await f.prisma.prospectContactBinding.create({data:{prospectId:lead.id,endpointId:endpoint.id,confirmationState:"confirmed"}});
  await f.prisma.contactPermissionReceipt.create({data:{source:"zyon_platform",senderBindingId:"sender",endpointId:endpoint.id,purpose:"zyon_sales",status:"opted_in",evidenceRef:"fixture-consent",occurredAt:new Date(0)}});
  const review={senderBindingId:"sender",senderVersion:1,message:"synthetic offer",offer:fixtureOffer,audienceHash:"audience",sendWindow:fixtureWindow,limits:{dailyRecipients:2,budget:{amountCents:100,currency:"BRL"}},template:fixtureTemplate};
  const contentHash=campaignContentHash(review);
  const campaign=await f.prisma.prospectCampaign.create({data:{name:"fixture",message:review.message,sendWindow:fixtureWindow,offerSnapshot:fixtureOffer,template:fixtureTemplate,createdBy:"operator",senderBindingId:"sender",senderVersion:1,revision:1,state:"running",approvedRevision:1,approvedHash:contentHash,contentHash,audienceHash:"audience",dailyRecipientLimit:2,budgetCents:100}});
  const recipient=await f.prisma.campaignRecipient.create({data:{campaignId:campaign.id,prospectId:lead.id,endpointId:endpoint.id,sequenceKey:"synthetic",frozenSnapshot:{snapshotId:"search-old",cnpj:lead.cnpj},eligibility:"opted_in"}});
  const quote=()=>({amountCents:25,currency:"BRL" as const,validUntil:new Date(Date.now()+86400000)});
  return {...f,lead,endpoint,campaign,recipient,keys,quote};
 }catch(e){await f.close();throw e;}
}
