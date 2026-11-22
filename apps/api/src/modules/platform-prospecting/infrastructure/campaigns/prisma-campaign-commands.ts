import { Prisma,type PrismaClient,type ProspectCampaign as CampaignRow } from "@prisma/client";
import type { ApproveProspectCampaign, CampaignRecipientRecord, ProspectCampaign, ProspectCampaignAction, ProspectingBlocker, ProspectingTemplate, SaveProspectCampaign } from "@zyon/shared-types";
import type { CampaignCommandStore } from "../../application/campaigns/campaign.service.js";
import type { CanonicalBillingOfferPort, ProspectingActor } from "../../domain/prospecting.ports.js";
import { campaignContentHash,campaignTransition,validateSendWindow } from "../../domain/campaigns/prospecting-campaign.js";
import { stableDirectoryJson } from "../../domain/company-directory/directory-values.js";
import { prospectAudit,prospectCommand } from "../crm/prospect-command.js";
import { storedReview,releasePreSubmission } from "./prisma-campaign.repository.js";

type Tx=Prisma.TransactionClient;
export type CampaignActivation=(campaign:ProspectCampaign)=>Promise<ProspectingBlocker[]>;
const json=(v:unknown)=>JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue;
function project(c:CampaignRow):ProspectCampaign{
 const review=storedReview(c);
 return {id:c.id,name:c.name,revision:c.revision,state:c.state as ProspectCampaign["state"],audienceHash:c.audienceHash,contentHash:campaignContentHash(review),selectionId:c.selectionId,message:c.message,offer:c.offerSnapshot as unknown as ProspectCampaign["offer"],senderBindingId:c.senderBindingId,senderVersion:c.senderVersion,template:c.template as unknown as ProspectingTemplate|null,limits:review.limits,sendWindow:c.sendWindow as unknown as ProspectCampaign["sendWindow"],approvedRevision:c.approvedRevision,approvedBy:c.approvedBy,approvedAt:c.approvedAt?.toISOString()??null,blockers:c.blockers as ProspectingBlocker[],recipientCount:c.recipientCount,reservedCents:Number(c.reservedCents),spentCents:Number(c.spentCents),createdAt:c.createdAt.toISOString(),updatedAt:c.updatedAt.toISOString()};
}
async function locked(tx:Tx,id:string,revision:number){
 await tx.$queryRaw`SELECT id FROM prospect_campaigns WHERE id=${id} FOR UPDATE`;
 const c=await tx.prospectCampaign.findUnique({where:{id}});
 if(!c)throw new Error("campaign_not_found");if(c.revision!==revision)throw new Error("version_conflict");return c;
}
export class PrismaCampaignCommands implements CampaignCommandStore {
 constructor(private readonly prisma:PrismaClient,private readonly offers:CanonicalBillingOfferPort,private readonly activation:CampaignActivation){}
 private async input(tx:Tx,c:SaveProspectCampaign){
  const sender=await tx.platformProspectSenderBinding.findFirst({where:{id:c.senderBindingId,version:c.senderVersion,active:true,scope:"zyon_platform"}});
  if(!sender)throw new Error("sender_identity_mismatch");
  const offer=await this.offers.current(c.planKey);if(offer.planKey!==c.planKey||!this.offers.allowedUrl(offer.canonicalUrl))throw new Error("offer_unavailable");
  return {name:c.name.trim(),message:c.message,offerSnapshot:json(offer),senderBindingId:sender.id,senderVersion:sender.version,template:c.template?json(c.template):Prisma.DbNull,dailyRecipientLimit:c.limits.dailyRecipients,budgetCents:BigInt(c.limits.budget.amountCents),currency:"BRL",sendWindow:json(validateSendWindow(c.sendWindow))};
 }
 private async current(tx:Tx,c:CampaignRow){
  const offer=project(c).offer;
  const sender=await tx.platformProspectSenderBinding.findFirst({where:{id:c.senderBindingId??"",active:true,scope:"zyon_platform",version:c.senderVersion??0}});
  if(!sender||!offer||!this.offers.allowedUrl(offer.canonicalUrl)||stableDirectoryJson(offer)!==stableDirectoryJson(await this.offers.current(offer.planKey)))throw new Error("approval_stale");
 }
 private async result(tx:Tx,c:CampaignRow,actor:ProspectingActor,kind:string){
  await prospectAudit(tx,actor,kind,"campaign",c.id,c.revision);
  return {result:project(c),resourceIds:[c.id]};
 }
 create(cmd:SaveProspectCampaign,actor:ProspectingActor){
  return prospectCommand(this.prisma,"campaign.create",cmd,actor,async tx=>this.result(tx,await tx.prospectCampaign.create({data:{...await this.input(tx,cmd),createdBy:actor.operatorId}}),actor,"campaign.create"));
 }
 revise(id:string,cmd:SaveProspectCampaign,actor:ProspectingActor){
  return prospectCommand(this.prisma,"campaign.revise",{...cmd,id},actor,async tx=>{
   const c=await locked(tx,id,cmd.expectedRevision!);if(["running","completed","freezing"].includes(c.state))throw new Error("campaign_state_conflict");
   const data=await this.input(tx,cmd);
   const keepAudience=!!c.audienceHash&&c.senderBindingId===data.senderBindingId;
   if(!keepAudience && await tx.outreachAttempt.count({where:{recipient:{campaignId:id}}}))throw new Error("campaign_state_conflict");
   const updated=await tx.prospectCampaign.update({where:{id},data:{...data,revision:{increment:1},state:keepAudience?"review_ready":"draft",...(!keepAudience?{audienceHash:null,selectionId:null,recipientCount:0}:{}),approvedRevision:null,approvedHash:null,approvedAt:null,approvedBy:null,contentHash:null}});
   return this.result(tx,updated,actor,"campaign.revise");
  });
 }
 approve(id:string,cmd:ApproveProspectCampaign,actor:ProspectingActor){
  return prospectCommand(this.prisma,"campaign.approve",{...cmd,id},actor,async tx=>{
   const c=await locked(tx,id,cmd.expectedRevision);
   const hash=campaignContentHash(storedReview(c));
   if(c.state!=="review_ready"||!c.audienceHash||!c.dailyRecipientLimit||!c.budgetCents||c.audienceHash!==cmd.audienceHash||cmd.contentHash!==hash)throw new Error("approval_stale");
   await this.current(tx,c);
   const row=await tx.prospectCampaign.update({where:{id},data:{state:"approved",approvedRevision:c.revision,approvedHash:hash,contentHash:hash,approvedBy:actor.operatorId,approvedAt:new Date()}});
   return this.result(tx,row,actor,"campaign.approve");
  });
 }
 changeState(id:string,cmd:ProspectCampaignAction,actor:ProspectingActor){
  return prospectCommand(this.prisma,"campaign."+cmd.action,{...cmd,id},actor,async tx=>{
   if(cmd.action==="pause")await tx.$queryRaw`SELECT ep.id FROM prospect_endpoints ep JOIN campaign_recipients r ON ep.id=r.endpoint_id WHERE r.campaign_id=${id} ORDER BY ep.id FOR UPDATE OF ep`;
   const c=await locked(tx,id,cmd.expectedRevision);const blockers:ProspectingBlocker[]=[];
   if(cmd.action!=="pause"){
    await this.current(tx,c);blockers.push(...await this.activation(project(c)));
    if(!await tx.campaignRecipient.count({where:{campaignId:id,eligibility:"opted_in",state:{not:"blocked"}}}))blockers.push("provider_policy_blocked");
   }
   const state=campaignTransition(c.state as ProspectCampaign["state"],cmd.action,c.approvedRevision===c.revision && c.approvedHash===campaignContentHash(storedReview(c)),blockers);
   if(state==="paused"){
    const pending=await tx.outreachAttempt.findMany({where:{recipient:{campaignId:id},state:"reserved"}});
    for(const attempt of pending)await releasePreSubmission(tx,attempt,id,"campaign_paused");
   }
   const row=await tx.prospectCampaign.update({where:{id},data:{state}});
   return this.result(tx,row,actor,"campaign."+cmd.action);
  });
 }
 async find(id:string){const c=await this.prisma.prospectCampaign.findUnique({where:{id}});return c?project(c):null;}
 async list(cursor?:string){const rows=await this.prisma.prospectCampaign.findMany({where:cursor?{id:{gt:cursor}}:{},orderBy:{id:"asc"},take:51});return {items:rows.slice(0,50).map(project),nextCursor:rows.length>50?rows[49].id:null};}
 async recipients(id:string,cursor?:string){
  if(!await this.prisma.prospectCampaign.findUnique({where:{id},select:{id:true}}))throw new Error("campaign_not_found");
  const rows=await this.prisma.campaignRecipient.findMany({where:{campaignId:id,...(cursor?{id:{gt:cursor}}:{})},orderBy:{id:"asc"},take:51,include:{attempts:{orderBy:{ordinal:"desc"},take:1}}});
  const items=rows.slice(0,50).map(r=>({id:r.id,campaignId:r.campaignId,prospectId:r.prospectId,endpointId:r.endpointId,sequenceKey:r.sequenceKey,eligibility:r.eligibility as CampaignRecipientRecord["eligibility"],frozenSnapshot:r.frozenSnapshot as CampaignRecipientRecord["frozenSnapshot"],state:r.state as CampaignRecipientRecord["state"],blockers:r.blockers as ProspectingBlocker[],attemptId:r.attempts[0]?.id??null}));
  return {items,nextCursor:rows.length>50?rows[49].id:null};
 }
}
