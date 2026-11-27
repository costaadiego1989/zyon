import type { FreezeCampaignAudience as FreezeCommand, ProspectAudienceJob } from "@zyon/shared-types";
import type { ProspectingActor } from "../../domain/prospecting.ports.js";
export interface CampaignAudienceStore {
  enqueue(id:string,command:FreezeCommand,actor:ProspectingActor):Promise<ProspectAudienceJob>;
  poll(id:string):Promise<ProspectAudienceJob|null>;
  processNext(size:number):Promise<ProspectAudienceJob|null>;
}
export class FreezeCampaignAudience {
  constructor(private readonly store:CampaignAudienceStore) {}
  enqueue(id:string,command:FreezeCommand,actor:ProspectingActor){
    const explicit=Array.isArray(command.cnpjs)&&command.cnpjs.length>0&&command.cnpjs.length<=100;
    if(!Number.isInteger(command.expectedRevision)||command.expectedRevision<1||!command.snapshotId || (command.segmentId ? command.cnpjs!==undefined || !Number.isInteger(command.segmentVersion) || command.segmentVersion!<1 : !explicit || command.segmentVersion!==undefined)) throw new Error("invalid_command:audience");
    return this.store.enqueue(id,command,actor);
  }
  poll(selectionId:string){return this.store.poll(selectionId);}
  processNext(batchSize=50){
    if(!Number.isInteger(batchSize)||batchSize<1||batchSize>100)throw new Error("invalid_command:batchSize");
    return this.store.processNext(batchSize);
  }
}
