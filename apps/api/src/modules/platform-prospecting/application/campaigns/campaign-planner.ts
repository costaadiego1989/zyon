import type {CampaignPlanningJob,PrepareCampaignContext} from "@zyon/shared-types";
import type {ProspectingActor} from "../../domain/prospecting.ports.js";
import {prospectText,prospectVersion} from "../crm/prospect.service.js";
export interface CampaignPlannerStore {prepare(id:string,c:PrepareCampaignContext,a:ProspectingActor):Promise<CampaignPlanningJob>;poll(campaignId:string,id:string):Promise<CampaignPlanningJob>;processNext():Promise<CampaignPlanningJob|null>}
export class CampaignPlanner {
 constructor(private readonly store:CampaignPlannerStore){}
 async prepare(id:string,c:PrepareCampaignContext,a:ProspectingActor){prospectVersion(c.expectedRevision);prospectText(c.snapshotId,"snapshotId");return this.store.prepare(id,c,a);}
 poll(campaignId:string,id:string){return this.store.poll(campaignId,id);}
 processNext(){return this.store.processNext();}
}
