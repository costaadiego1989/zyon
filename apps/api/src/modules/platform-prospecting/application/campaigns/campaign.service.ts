import type { SaveProspectCampaign, ProspectCampaignAction, ApproveProspectCampaign, ProspectCampaign, ProspectingPage } from "@zyon/shared-types";
import type { CampaignRepositoryPort, ProspectingActor } from "../../domain/prospecting.ports.js";
import { validateLimits,validateSendWindow } from "../../domain/campaigns/prospecting-campaign.js";
import { prospectText,prospectVersion } from "../crm/prospect.service.js";
export type CampaignCommandStore=Pick<CampaignRepositoryPort,"create"|"revise"|"find"|"approve"|"changeState"|"recipients">&{list(cursor?:string):Promise<ProspectingPage<ProspectCampaign>>};
export class CampaignService {
 constructor(private readonly store:CampaignCommandStore){}
 private check(c:SaveProspectCampaign){
  prospectText(c.name,"name",120);prospectText(c.message,"message",4000);prospectText(c.planKey,"planKey",80);prospectText(c.senderBindingId,"senderBindingId");prospectVersion(c.senderVersion);
  validateLimits(c.limits);validateSendWindow(c.sendWindow);
  if(c.template){
    for(const k of ["id","wabaId","name","language","revision","category","status"] as const)prospectText(c.template[k],k);
    if(!["MARKETING","UTILITY","AUTHENTICATION"].includes(c.template.category))throw new Error("invalid_command:template");
  }
 }
 async create(c:SaveProspectCampaign,a:ProspectingActor){this.check(c);if(c.expectedRevision!==undefined)throw new Error("invalid_command:expectedRevision");return this.store.create(c,a);}
 async revise(id:string,c:SaveProspectCampaign,a:ProspectingActor){this.check(c);prospectVersion(c.expectedRevision);return this.store.revise(id,c,a);}
 async find(id:string){const c=await this.store.find(id);if(!c)throw new Error("campaign_not_found");return c;}
 list(cursor?:string){return this.store.list(cursor);}
 recipients(id:string,cursor?:string){return this.store.recipients(id,cursor);}
 async approve(id:string,c:ApproveProspectCampaign,a:ProspectingActor){prospectVersion(c.expectedRevision);prospectText(c.audienceHash,"audienceHash");prospectText(c.contentHash,"contentHash");return this.store.approve(id,c,a);}
 async action(id:string,c:ProspectCampaignAction,a:ProspectingActor){prospectVersion(c.expectedRevision);if(!["start","pause","resume"].includes(c.action))throw new Error("invalid_command:action");return this.store.changeState(id,c,a);}
}
