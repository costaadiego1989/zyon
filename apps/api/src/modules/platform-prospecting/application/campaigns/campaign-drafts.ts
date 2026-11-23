import type {CreateProspectCampaignDraft,EditProspectCampaignDraft,ProspectCampaignDraft,ProspectingPage} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {prospectText,prospectVersion} from "../crm/prospect.service.js";
import {validateLimits,validateSendWindow} from "../../domain/campaigns/prospecting-campaign.js";
import {canonicalCnpj} from "../../domain/company-directory/cnpj.js";
export interface CampaignDraftStore {
 create(c:CreateProspectCampaignDraft,a:ProspectingActor):Promise<ProspectCampaignDraft>;
 edit(id:string,c:EditProspectCampaignDraft,a:ProspectingActor):Promise<ProspectCampaignDraft>;
 find(id:string):Promise<ProspectCampaignDraft>;
 list(cursor?:string):Promise<ProspectingPage<ProspectCampaignDraft>>;
}
export function companyReferences(input:{snapshotId:string;cnpjs:string[]}){
 if(!input||Object.keys(input).some(k=>!["snapshotId","cnpjs"].includes(k)))throw Error("invalid_command:companies");
 prospectText(input.snapshotId,"snapshotId");
 if(!Array.isArray(input.cnpjs)||!input.cnpjs.length||input.cnpjs.length>100)throw Error("invalid_command:cnpjs");
 return {...input,cnpjs:[...new Set(input.cnpjs.map(canonicalCnpj))].sort()};
}
export class CampaignDraftService {
 constructor(private readonly store:CampaignDraftStore){}
 async create(c:CreateProspectCampaignDraft,a:ProspectingActor){
  prospectText(c.name,"name",120);if(c.businessContext!==undefined)prospectText(c.businessContext,"businessContext",4000);
  if(c.companies)c={...c,companies:companyReferences(c.companies)};return this.store.create(c,a);
 }
 async edit(id:string,c:EditProspectCampaignDraft,a:ProspectingActor){
  prospectVersion(c.expectedRevision);
  if(c.name!==undefined)prospectText(c.name,"name",120);
  if(c.businessContext!==undefined&&c.businessContext!==null)prospectText(c.businessContext,"businessContext",4000);
  if(c.message!==undefined&&c.message!==null)prospectText(c.message,"message",4000);
  if(c.offerPolicy){const p=c.offerPolicy;if(!["catalog","fixed"].includes(p.mode)||Object.keys(p).some(k=>!["mode",...(p.mode==="fixed"?["planKey"]:[])].includes(k)))throw Error("invalid_command:offerPolicy");if(p.mode==="fixed")prospectText(p.planKey,"planKey",80);}
  if(c.limits)validateLimits(c.limits);if(c.sendWindow)validateSendWindow(c.sendWindow);
  if(c.senderBindingId!==undefined&&c.senderBindingId!==null)prospectText(c.senderBindingId,"senderBindingId");
  if(c.senderVersion!==undefined&&c.senderVersion!==null)prospectVersion(c.senderVersion);
  if(c.template!==undefined&&c.template!==null)throw Error("invalid_command:registered_template_required");
  return this.store.edit(id,c,a);
 }
 find(id:string){return this.store.find(id);}
 list(cursor?:string){return this.store.list(cursor);}
}
