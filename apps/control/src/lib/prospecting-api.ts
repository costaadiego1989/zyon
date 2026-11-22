import type * as T from "@zyon/shared-types";
import {PlatformApiError} from "./api.js";

type Transport=<R>(path:string,options?:RequestInit & {headers?:Record<string,string>})=>Promise<R>;
type Runtime={moduleEnabled:boolean;workersRunning:boolean;dispatchMode:"disabled"|"controlled"|"live";modelMode:"disabled"|"controlled"|"live";ingestionEnabled:boolean;reservationDayTimezone:"UTC"};
type Observation<V>={status:"current"|"stale"|"unavailable";observedAt:string|null;value:V|null};
type Readiness={runtime:Runtime;updatedAt:string;source:Observation<{snapshotId:string|null;competence:string|null;state:string}>;
 knowledge:Observation<{activePublications:number}>;channel:Observation<{status:T.PlatformSenderReadiness["status"];blockers:T.ProspectingBlocker[];bindingId:string|null;bindingVersion:number|null;updatedAt:string}>};
const root="/platform/prospecting/";
export class ProspectCommandUnresolved extends Error {
 constructor(readonly clientRequestId:string,readonly state:string){super("Resultado do comando pendente de confirmação.");}
}
export class ProspectCommandRecorded extends Error {
 constructor(readonly clientRequestId:string,readonly receipt:unknown){super("Comando registrado. Atualize o recurso para consultar o resultado.");}
}
export class ProspectingApi {
 private readonly uncertain=new Map<string,string>();
 private readonly active=new Set<string>();
 constructor(private readonly request:Transport){}
 private read<R>(path:string,query:object,signal?:AbortSignal){
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(query))if(value!==undefined)params.set(key,typeof value==="object"?JSON.stringify(value):String(value));
  return this.request<R>(root+path+(params.size?"?"+params.toString():""),{signal});
 }
 command<R=unknown>(key:string,signal?:AbortSignal){return this.read<T.ProspectingCommandResult<R>>("commands/"+encodeURIComponent(key),{},signal);}
 private async recover<R>(key:string,path:string){
  let result:T.ProspectingCommandResult<R>;
  try{result=await this.command<R>(key);}catch(e){
   if(e instanceof PlatformApiError && [401,403].includes(e.status))throw e;
   throw new ProspectCommandUnresolved(key,e instanceof PlatformApiError&&e.status===404?"unconfirmed":"unavailable");
  }
  if(result.clientRequestId!==key || result.state==="outcome_unknown" || result.state==="pending")throw new ProspectCommandUnresolved(key,result.state);
  this.uncertain.delete(key);
  if(result.state==="failed")throw new PlatformApiError(409,result.errorCode??undefined,result.errorCode??undefined);
  // These endpoints transform or redact a durable receipt before returning the live HTTP DTO.
  if(/^(?:segments|imports|sender)\b|\/billing-proposal$/.test(path))throw new ProspectCommandRecorded(key,result.result);
  return result.result as R;
 }
 private async write<R>(path:string,body:T.ProspectingCommand,method:string,signal?:AbortSignal){
  const key=body.clientRequestId,scope=method+" "+path;
  if(this.active.has(key))throw new ProspectCommandUnresolved(key,"pending");
  const prior=this.uncertain.get(key);
  if(prior && prior!==scope)throw new PlatformApiError(409,"command_conflict","command_conflict");
  this.active.add(key);
  try{
   if(prior)return await this.recover<R>(key,path);
   try{return await this.request<R>(root+path,{method,body:JSON.stringify(body),headers:{"Idempotency-Key":key},signal});}
   catch(e){
    if(e instanceof PlatformApiError && e.status<500)throw e;
    this.uncertain.set(key,scope);
    return await this.recover<R>(key,path);
   }
  }finally{this.active.delete(key);}
 }
 companies(query:T.CompanySearchQuery,signal?:AbortSignal){return this.read<T.CompanySearchResult>("companies",query,signal);}
 domains(query:T.CompanyDomainQuery,signal?:AbortSignal){return this.read<T.CompanyDomainResult>("companies/domains",query,signal);}
 company(id:string,snapshotId?:string,signal?:AbortSignal){return this.read<T.CompanyRecord>(`companies/${encodeURIComponent(id)}`,{snapshotId},signal);}
 prospects(query:T.ProspectListQuery={},signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectRecord>>("prospects",query,signal);}
 prospect(id:string,signal?:AbortSignal){return this.read<T.ProspectDetail>(`prospects/${encodeURIComponent(id)}`,{},signal);}
 conversions(id:string,query:{cursor?:string;limit?:number}={},signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectConversionHistoryItem>>(`prospects/${encodeURIComponent(id)}/conversions`,query,signal);}
 segments(cursor?:string,signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectSegmentSummary>>("segments",{cursor},signal);}
 segment(id:string,signal?:AbortSignal){return this.read<T.ProspectSegmentSummary>(`segments/${encodeURIComponent(id)}`,{},signal);}
 campaigns(cursor?:string,signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectCampaign>>("campaigns",{cursor},signal);}
 campaign(id:string,signal?:AbortSignal){return this.read<T.ProspectCampaign>(`campaigns/${encodeURIComponent(id)}`,{},signal);}
 recipients(id:string,cursor?:string,signal?:AbortSignal){return this.read<T.ProspectingPage<T.CampaignRecipientRecord>>(`campaigns/${encodeURIComponent(id)}/recipients`,{cursor},signal);}
 selection(id:string,selection:string,signal?:AbortSignal){return this.read<T.ProspectAudienceJob>(`campaigns/${encodeURIComponent(id)}/selections/${encodeURIComponent(selection)}`,{},signal);}
 conversations(query:T.ProspectConversationQuery={},signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectConversation>>("conversations",query,signal);}
 history(id:string,query:{before?:number;after?:number;limit?:number}={},signal?:AbortSignal){return this.read<T.ProspectConversationHistory>(`conversations/${encodeURIComponent(id)}`,query,signal);}
 changes(id:string,after:number,limit?:number,signal?:AbortSignal){return this.read<{items:T.ProspectRealtimeEvent[];nextCursor:string;hasMore:boolean}>(`conversations/${encodeURIComponent(id)}/changes`,{after,limit},signal);}
 notes(id:string,cursor?:string,signal?:AbortSignal){return this.read<T.ProspectingPage<T.ProspectNote>>(`conversations/${encodeURIComponent(id)}/notes`,{cursor},signal);}
 knowledge(signal?:AbortSignal){return this.read<{items:T.SalesKnowledgeSource[]}>("knowledge",{},signal);}
 source(id:string,signal?:AbortSignal){return this.read<T.SalesKnowledgeSource>(`knowledge/${encodeURIComponent(id)}`,{},signal);}
 sender(signal?:AbortSignal){return this.read<T.PlatformSenderReadiness>("sender",{},signal);}
 metrics(query:T.ProspectMetricsQuery,signal?:AbortSignal){return this.read<T.ProspectMetrics>("metrics",query,signal);}
 readiness(signal?:AbortSignal){return this.read<Readiness>("readiness",{},signal);}
 config(signal?:AbortSignal){return this.read<Runtime>("config",{},signal);}
 offers(signal?:AbortSignal){return this.read<{items:T.ProspectOffer[];siteUrl:string|null}>("offers",{},signal);}
 privacy(signal?:AbortSignal){return this.read<T.ProspectPrivacyPolicy>("privacy",{},signal);}
 competences(signal?:AbortSignal){return this.read<string[]>("imports/competences",{},signal);}
 manifest(id:string,signal?:AbortSignal){return this.read<T.CompanyManifest>(`imports/manifests/${encodeURIComponent(id)}`,{},signal);}
 importStatus(id:string,signal?:AbortSignal){return this.read<T.CompanyImportStatus>(`imports/${encodeURIComponent(id)}`,{},signal);}
 queryKnowledge(body:T.SalesKnowledgeQuery,signal?:AbortSignal){return this.request<T.SalesKnowledgeAnswer>(root+"knowledge/query",{method:"POST",body:JSON.stringify(body),signal});}
 send(id:string,body:T.SendProspectMessage,signal?:AbortSignal){return this.write<T.ProspectMessage>(`conversations/${encodeURIComponent(id)}/messages`,body,"POST",signal);}
 ownership(id:string,body:T.ChangeProspectOwnership,signal?:AbortSignal){return this.write<T.ProspectConversation>(`conversations/${encodeURIComponent(id)}/ownership`,body,"POST",signal);}
 markRead(id:string,body:T.ProspectingCommand & {sequence:number},signal?:AbortSignal){return this.write<{readSequence:number}>(`conversations/${encodeURIComponent(id)}/read`,body,"POST",signal);}
 addNote(id:string,body:T.ProspectingCommand & {content:string},signal?:AbortSignal){return this.write<T.ProspectNote>(`conversations/${encodeURIComponent(id)}/notes`,body,"POST",signal);}
 addProspects(body:T.AddProspectsCommand,signal?:AbortSignal){return this.write<T.AddProspectsResult>("prospects",body,"POST",signal);}
 updateProspect(id:string,body:T.UpdateProspectCommand,signal?:AbortSignal){return this.write<T.ProspectRecord>(`prospects/${encodeURIComponent(id)}`,body,"PATCH",signal);}
 bindContact(id:string,body:T.BindProspectContactCommand,signal?:AbortSignal){return this.write<T.ProspectRecord>(`prospects/${encodeURIComponent(id)}/contact-binding`,body,"POST",signal);}
 createSegment(body:T.SaveProspectSegment,signal?:AbortSignal){return this.write<T.ProspectSegmentSummary>("segments",body,"POST",signal);}
 editSegment(id:string,body:T.SaveProspectSegment,signal?:AbortSignal){return this.write<T.ProspectSegmentSummary>(`segments/${encodeURIComponent(id)}`,body,"PATCH",signal);}
 removeSegment(id:string,body:T.ProspectingVersionedCommand,signal?:AbortSignal){return this.write<void>(`segments/${encodeURIComponent(id)}`,body,"DELETE",signal);}
 createCampaign(body:T.SaveProspectCampaign,signal?:AbortSignal){return this.write<T.ProspectCampaign>("campaigns",body,"POST",signal);}
 reviseCampaign(id:string,body:T.SaveProspectCampaign,signal?:AbortSignal){return this.write<T.ProspectCampaign>(`campaigns/${encodeURIComponent(id)}`,body,"PATCH",signal);}
 freeze(id:string,body:T.FreezeCampaignAudience,signal?:AbortSignal){return this.write<T.ProspectAudienceJob>(`campaigns/${encodeURIComponent(id)}/freeze`,body,"POST",signal);}
 approve(id:string,body:T.ApproveProspectCampaign,signal?:AbortSignal){return this.write<T.ProspectCampaign>(`campaigns/${encodeURIComponent(id)}/approve`,body,"POST",signal);}
 start(id:string,body:T.ProspectingCommand & {expectedRevision:number},signal?:AbortSignal){return this.write<T.ProspectCampaign>(`campaigns/${encodeURIComponent(id)}/start`,body,"POST",signal);}
 pauseOrResume(id:string,body:T.ProspectCampaignAction & {action:"pause"|"resume"},signal?:AbortSignal){return this.write<T.ProspectCampaign>(`campaigns/${encodeURIComponent(id)}/pause-or-resume`,body,"POST",signal);}
 saveKnowledge(body:T.SaveSalesKnowledge & {sourceId:string},signal?:AbortSignal){return this.write<T.SalesKnowledgeSource>("knowledge",body,"POST",signal);}
 publishOrWithdraw(id:string,body:T.PublishSalesKnowledge,signal?:AbortSignal){return this.write<T.SalesKnowledgeSource>(`knowledge/${encodeURIComponent(id)}/publish-or-withdraw`,body,"POST",signal);}
 signupState(body:T.ProspectingCommand,signal?:AbortSignal){return this.write<T.PlatformSenderSignupState>("sender/signup-state",body,"POST",signal);}
 connect(body:T.ConnectPlatformSender,signal?:AbortSignal){return this.write<T.PlatformSenderBinding>("sender/meta/connect",body,"POST",signal);}
 startImport(body:T.ImportCompanySnapshot,signal?:AbortSignal){return this.write<T.CompanyImportAccepted>("imports",body,"POST",signal);}
 resumeImport(id:string,body:T.ProspectingCommand,signal?:AbortSignal){return this.write<T.CompanyImportAccepted>(`imports/${encodeURIComponent(id)}/resume`,body,"POST",signal);}
 suppress(id:string,body:T.SuppressProspectCommand,signal?:AbortSignal){return this.write<T.ProspectSuppressionResult>(`prospects/${encodeURIComponent(id)}/suppress`,body,"POST",signal);}
 proposal(id:string,body:T.ProspectingCommand & {planKey:string},signal?:AbortSignal){return this.write<{id:string;url:string;expiresAt:string;offerVersion:string}>(`prospects/${encodeURIComponent(id)}/billing-proposal`,body,"POST",signal);}
}
