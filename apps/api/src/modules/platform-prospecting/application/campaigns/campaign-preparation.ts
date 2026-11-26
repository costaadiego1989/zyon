import type {ProspectOfferPolicy,ProspectAudienceJob} from "@zyon/shared-types";
import type {CanonicalBillingOfferPort,ProspectingActor} from "../../domain/prospecting.ports.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
import {prospectText,prospectVersion} from "../crm/prospect.service.js";
/** The envelope pins the catalog and execution prerequisites without altering legacy snapshots. */
export class CampaignExecutionIdentity {
 constructor(private readonly offers:CanonicalBillingOfferPort,private readonly observe:()=>Promise<unknown>,private readonly assertExecutable?:()=>void){}
 async snapshot(policy:ProspectOfferPolicy){
  const offers=policy.mode==="catalog"?await this.offers.catalog?.():[await this.offers.current(policy.planKey)];
  if(!offers?.length||offers.some(o=>!this.offers.allowedUrl(o.canonicalUrl)))throw Error("offer_unavailable");
  return {mode:policy.mode,offers:[...offers].sort((a,b)=>a.planKey.localeCompare(b.planKey)),execution:JSON.parse(JSON.stringify(await this.observe()))};
 }
 async current(value:unknown){
  const v=value as {mode?:string;offers?:{planKey:string}[]};
  if(!v||!v.offers?.length||!['catalog','fixed'].includes(v.mode??''))return false;
  try{this.assertExecutable?.();return stableDirectoryJson(await this.snapshot(v.mode==="catalog"?{mode:"catalog"}:{mode:"fixed",planKey:v.offers[0].planKey}))===stableDirectoryJson(value);}catch{return false;}
 }
}
export interface PrepareCampaignExecution {expectedRevision:number;clientRequestId:string;templateRegistryId?:string}
export interface CampaignPreparationStore {prepare(id:string,cmd:PrepareCampaignExecution,actor:ProspectingActor):Promise<ProspectAudienceJob>}
export class CampaignPreparation {
 constructor(private readonly store:CampaignPreparationStore){}
 prepare(id:string,cmd:PrepareCampaignExecution,actor:ProspectingActor){prospectVersion(cmd.expectedRevision);if(cmd.templateRegistryId!==undefined)prospectText(cmd.templateRegistryId,"templateRegistryId");return this.store.prepare(id,cmd,actor);}
}
