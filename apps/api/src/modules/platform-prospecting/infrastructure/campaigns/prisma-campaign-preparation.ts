import {createHash} from "node:crypto";
import type {PrismaClient} from "@prisma/client";
import type {ProspectOfferPolicy} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {validateLimits,validateSendWindow} from "../../domain/campaigns/prospecting-campaign.js";
import {lockDraft,draftInvalidation,projectDraft} from "./prisma-campaign-drafts.js";
import {prospectAudit,prospectCommand} from "../crm/prospect-command.js";
import type {PrismaAudienceRepository} from "./prisma-audience.repository.js";
import type {PlatformTemplateService} from "../../application/campaigns/platform-template.service.js";
import type {CampaignPreparationStore,CampaignExecutionIdentity} from "../../application/campaigns/campaign-preparation.js";
import {prospectVersion} from "../../application/crm/prospect.service.js";
export class PrismaCampaignPreparation implements CampaignPreparationStore {
 constructor(private readonly db:PrismaClient,private readonly templates:Pick<PlatformTemplateService,"compatible">,private readonly identity:CampaignExecutionIdentity,private readonly audience:Pick<PrismaAudienceRepository,"enqueueDraft">){}
 async prepare(id:string,cmd:{expectedRevision:number;clientRequestId:string;templateRegistryId?:string},actor:ProspectingActor){
  prospectVersion(cmd.expectedRevision);
  // A completed attachment replays before any fresh observation; the freeze has its own durable identity.
  const attached=await prospectCommand(this.db,"campaign.prepare",{...cmd,id,clientRequestId:"prepare:"+createHash("sha256").update(cmd.clientRequestId).digest("hex")},actor,async tx=>{
   const c=await lockDraft(tx,id,cmd.expectedRevision);
   validateLimits(c.dailyRecipientLimit&&c.budgetCents?{dailyRecipients:c.dailyRecipientLimit,budget:{amountCents:Number(c.budgetCents),currency:c.currency}}:null);
   validateSendWindow(c.sendWindow as any);
   if(!c.senderBindingId||!c.senderVersion)throw Error("sender_unavailable");
   const template=await this.templates.compatible(c.senderBindingId,c.senderVersion,cmd.templateRegistryId);
   if(!template?.previewText)throw Error("template_unavailable");
   if(c.message&&c.message!==template.previewText)throw Error("template_binding_mismatch");
   const offerSnapshot=await this.identity.snapshot(c.offerPolicy as unknown as ProspectOfferPolicy);
   const row=await tx.prospectCampaign.update({where:{id},data:{...draftInvalidation,revision:{increment:1},message:template.previewText,template:JSON.parse(JSON.stringify(template)),offerSnapshot:JSON.parse(JSON.stringify(offerSnapshot))}});
   await prospectAudit(tx,actor,"campaign.prepare","campaign",id,row.revision);
   return {result:await projectDraft(tx,row),resourceIds:[id]};
  });
  return this.audience.enqueueDraft(id,{expectedRevision:attached.revision,clientRequestId:cmd.clientRequestId},actor);
 }
}
