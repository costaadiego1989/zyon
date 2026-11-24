import type { ContactPermissionStatus, ProspectCampaign, PlatformSenderBinding, PlatformSenderReadiness, ProspectingBlocker, ProspectingTemplate } from "@zyon/shared-types";

export interface PlatformSenderCredential {binding:PlatformSenderBinding;accessToken:string;businessId:string;authorizationMethod?:"system_user";systemUserId?:string}
export interface SenderObservationStore {
 credential():Promise<PlatformSenderCredential|null>;
 save(binding:PlatformSenderBinding,result:PlatformSenderReadiness):Promise<boolean>;
 permission(senderId:string,endpointId:string):Promise<ContactPermissionStatus>;
}
export interface HealthObservation {
 templates:ProspectingTemplate[]; portfolioLimit:number|null; portfolioTier:string|null; blockers:ProspectingBlocker[];
 entities:{type:string;id:string;status:string;errorCodes:number[]}[];
}
export interface SenderHealthReader {read(credential:PlatformSenderCredential):Promise<HealthObservation>}
export function campaignSelectionBlockers(health:PlatformSenderReadiness,senderId:string,version:number,template:ProspectingTemplate|null,reviewedMessage?:string|null){
  const blockers=[...health.blockers];
  if(health.status!=="ready"&&!blockers.length)blockers.push("sender_unavailable");
  if(health.binding?.id!==senderId||health.binding.version!==version)blockers.push("sender_identity_mismatch");
  if(!template)blockers.push("template_unavailable");
  else {
   const current=health.templates?.find(t=>t.id===template.id);
   if(!current||current.status!=="APPROVED"||current.requiresParameters!==false||current.category!=="MARKETING")blockers.push("template_unavailable");
   else if(current.wabaId!==template.wabaId||current.name!==template.name||current.language!==template.language||current.category!==template.category||current.revision!==template.revision||!current.previewText||current.previewText!==reviewedMessage||template.previewText!==current.previewText||template.requiresParameters!==false)blockers.push("template_binding_mismatch");
  }
  return [...new Set(blockers)];
}
export class SenderReadinessService {
 constructor(private readonly store:SenderObservationStore,private readonly reader:SenderHealthReader){}
 async readiness():Promise<PlatformSenderReadiness>{
  const updatedAt=new Date().toISOString();
  const unknown:PlatformSenderReadiness={binding:null,updatedAt,status:"unknown",templates:[],portfolioLimit:null,portfolioUsed:null,blockers:["sender_unavailable"]};
  const credentials=await this.store.credential().catch(()=>null);if(!credentials)return unknown;
  let result:PlatformSenderReadiness;
  try{
   const observation=await this.reader.read(credentials);
   result={binding:credentials.binding,updatedAt,status:observation.blockers.length?"blocked":"ready",portfolioUsed:null,...observation};
  }catch{result={...unknown,binding:credentials.binding};}
  return await this.store.save(credentials.binding,result)?result:unknown;
 }
 forCampaign(c:Pick<ProspectCampaign,"senderBindingId"|"senderVersion"|"template"|"message">){
  return this.forSelection(c.senderBindingId??"",c.senderVersion??0,c.template,c.message);
 }
 async forSelection(senderId:string,version:number,template:ProspectingTemplate|null,reviewedMessage?:string){
  const health=await this.readiness();return campaignSelectionBlockers(health,senderId,version,template,reviewedMessage);
 }
 async preview(senderId:string,endpointId:string){
  const eligibility=await this.store.permission(senderId,endpointId);
  return {eligibility,blockers:eligibility==="opted_in"?[]:["no_opt_in","provider_policy_blocked"]};
 }
}
