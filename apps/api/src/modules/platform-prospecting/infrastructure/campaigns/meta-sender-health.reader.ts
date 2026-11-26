import {createHash} from "node:crypto";
import type {ProspectingBlocker,ProspectingTemplate} from "@zyon/shared-types";
import type {HealthObservation,PlatformSenderCredential,SenderHealthReader} from "../../application/campaigns/sender-readiness.service.js";
import {stableDirectoryJson} from "../../domain/company-directory/directory-values.js";
import {platformGraph,PlatformMetaAuthorization} from "./platform-meta-authorization.js";
import {observedMaxPrice,optimizationSpec,verifyMaxPriceEnrollment} from "./meta-max-price.js";
type Entity={entity_type:string;id:string;can_send_message:string;can_receive_call_sip?:string;additional_info?:string[];errors?:{error_code:number}[]};
type Phone={id:string;status:string;platform_type:string;quality_rating:string;whatsapp_business_manager_messaging_limit:string;health_status?:{can_send_message:string;entities:Entity[]}};
type Template=Omit<ProspectingTemplate,"wabaId"|"revision">&{components:unknown[];optimization_spec?:unknown};
const tiers:Record<string,number>={TIER_250:250,TIER_2K:2000,TIER_10K:10000,TIER_100K:100000};
function staticTemplate(components:unknown[]){
 const rows=components.filter((v):v is Record<string,unknown>=>v!==null && typeof v==="object" && !Array.isArray(v));
 const bodies=rows.filter(r=>r.type==="BODY");
 const previewText=bodies.length===1 && typeof bodies[0].text==="string"?bodies[0].text:null;
 const fixed=(value:unknown)=>typeof value==="string" && !!value && !value.includes("{{");
 const parameterFree=rows.length===components.length && fixed(previewText) && rows.every(r=>{
  if(r.type==="BODY" || r.type==="FOOTER")return fixed(r.text);
  if(r.type==="HEADER")return r.format==="TEXT" && fixed(r.text);
  if(r.type!=="BUTTONS" || !Array.isArray(r.buttons))return false;
  return r.buttons.every(button=>button && fixed(button.text) && (button.type==="QUICK_REPLY" || button.type==="URL" && fixed(button.url) || button.type==="PHONE_NUMBER" && fixed(button.phone_number)));
 });
 return {previewText,requiresParameters:!parameterFree};
}
export class MetaSenderHealthReader implements SenderHealthReader {
 constructor(private readonly app:{appId:string;appSecret:string},private readonly fetcher:typeof fetch=fetch){}
 private async get<T>(path:string,token:string,query:Record<string,string>):Promise<T>{
  const url=new URL(path,platformGraph);for(const [key,value] of Object.entries(query))url.searchParams.set(key,value);
  const response=await this.fetcher(url,{headers:{Authorization:"Bearer "+token},redirect:"error",signal:AbortSignal.timeout(5000)});
  if(!response.ok)throw new Error("sender_unavailable");return await response.json() as T;
 }
 async read(credential:PlatformSenderCredential):Promise<HealthObservation>{
  const {binding:b,businessId,accessToken}=credential;
  const blockers=new Set<ProspectingBlocker>();
  if(b.appId!==this.app.appId||!this.app.appSecret)throw new Error("sender_identity_mismatch");
  if(credential.authorizationMethod==="system_user"){
   await new PlatformMetaAuthorization({...this.app,businessId,phoneNumberId:b.phoneNumberId,wabaId:b.wabaId,systemUserId:credential.systemUserId,systemUserAccessToken:accessToken},this.fetcher).authorizeSystemUser();
   let messaging=false;
   const query:Record<string,string>={business:businessId,fields:"id,tasks",limit:"100"};
   for(let page=0;page<20;page++){
    const users=await this.get<{data:{id:string;tasks?:string[]|null}[];paging?:{next?:string;cursors?:{after?:string}}}>(b.wabaId+"/assigned_users",accessToken,query);
    if(!Array.isArray(users.data))throw Error("permission_unavailable");
    const own=users.data.find(user=>user.id===credential.systemUserId);
    if(own){messaging=Array.isArray(own.tasks)&&own.tasks.some(task=>task==="MESSAGING"||task==="MANAGE");break;}
    if(!users.paging?.next)break;
    const after=users.paging.cursors?.after;if(!after||after===query.after)break;query.after=after;
   }
   if(!messaging)blockers.add("permission_unavailable");
  }else{
   const debug=await this.get<{data:{is_valid:boolean;app_id:string;granular_scopes?:{scope:string;target_ids?:string[]}[]}}>("debug_token",this.app.appId+"|"+this.app.appSecret,{input_token:accessToken});
   if(debug.data?.app_id!==b.appId)blockers.add("sender_identity_mismatch");
   if(debug.data?.is_valid!==true||!["whatsapp_business_management","whatsapp_business_messaging"].every(s=>debug.data?.granular_scopes?.some(g=>g.scope===s&&g.target_ids?.includes(b.wabaId))))blockers.add("permission_unavailable");
  }
  const phone=await this.get<Phone>(b.phoneNumberId,accessToken,{fields:"id,status,platform_type,quality_rating,health_status,whatsapp_business_manager_messaging_limit"});
  const observed=phone.health_status?.entities??[];
  const expected:Record<string,string>={PHONE_NUMBER:b.phoneNumberId,WABA:b.wabaId,BUSINESS:businessId,APP:b.appId};
  if(phone.id!==b.phoneNumberId||Object.entries(expected).some(([type,id])=>!observed.some(e=>e.entity_type===type&&e.id===id)))blockers.add("sender_identity_mismatch");
  if(phone.status!=="CONNECTED"||phone.platform_type!=="CLOUD_API")blockers.add("sender_unavailable");
  const tier=phone.whatsapp_business_manager_messaging_limit;
  // Meta documents pending display-name approval as a finite messaging limit, not a messaging block.
  const pendingNameOnly=phone.health_status?.can_send_message==="LIMITED"&&Object.hasOwn(tiers,tier)&&observed.length===Object.keys(expected).length&&observed.every(e=>expected[e.entity_type]===e.id)&&observed.every(e=>{
   if(e.entity_type==="PHONE_NUMBER")return e.can_send_message==="LIMITED"&&e.additional_info?.length===1&&e.additional_info[0]==="Your display name has not been approved yet. Your message limit will increase after the display name is approved."&&(e.errors??[]).every(err=>err.error_code===138024&&e.can_receive_call_sip==="BLOCKED");
   return e.can_send_message==="AVAILABLE"&&(e.errors??[]).every(err=>e.entity_type==="APP"&&err.error_code===138025&&e.can_receive_call_sip==="BLOCKED");
  });
  if(!pendingNameOnly&&(phone.health_status?.can_send_message!=="AVAILABLE"||observed.some(e=>e.can_send_message!=="AVAILABLE"))||!["GREEN","YELLOW"].includes(phone.quality_rating))blockers.add("quality_restricted");
  const entities=observed.filter(e=>expected[e.entity_type]===e.id).map(e=>({type:e.entity_type,id:e.id,status:["AVAILABLE","LIMITED","BLOCKED"].includes(e.can_send_message)?e.can_send_message:"UNKNOWN",errorCodes:(e.errors??[]).map(err=>err.error_code).filter(Number.isSafeInteger).slice(0,10)}));
  const known=Object.hasOwn(tiers,tier)||tier==="TIER_UNLIMITED";
  if(!known)blockers.add("portfolio_limit");
  const templates:ProspectingTemplate[]=[];const query:Record<string,string>={fields:"id,name,status,language,category,components,optimization_spec",limit:"100"};
  for(let page=0;page<20;page++){
   const result=await this.get<{data:Template[];paging?:{next:string;cursors?:{after:string}}}>(b.wabaId+"/message_templates",accessToken,query);
   if(!Array.isArray(result.data))throw new Error("template_unavailable");
   for(const t of result.data){
    if(![t.id,t.name,t.language,t.status].every(v=>typeof v==="string"&&v.length>0&&v.length<=512)||!["MARKETING","UTILITY","AUTHENTICATION"].includes(t.category)||!Array.isArray(t.components)||!t.components.length)continue;
    let maxPrice;try{maxPrice=observedMaxPrice(t.optimization_spec);}catch{continue;}
    const {id,name,language,category,status}=t;const revision=createHash("sha256").update(stableDirectoryJson({id,name,language,category,wabaId:b.wabaId,components:t.components,...(maxPrice?{optimization_spec:optimizationSpec(maxPrice)}:{})})).digest("hex");
    templates.push({id,name,language,category,status,revision,wabaId:b.wabaId,...staticTemplate(t.components),...(maxPrice?{maxPrice}:{})});
   }
   if(!result.paging?.next)break;
   const after=result.paging.cursors?.after;if(!after||after===query.after||page===19){blockers.add("template_unavailable");break;}query.after=after;
  }
  if(templates.some(t=>t.maxPrice))try{await verifyMaxPriceEnrollment(credential,this.fetcher);}catch{for(let i=templates.length-1;i>=0;i--)if(templates[i].maxPrice)templates.splice(i,1);}
  if(!templates.some(t=>t.status==="APPROVED"&&t.category==="MARKETING"&&t.requiresParameters===false))blockers.add("template_unavailable");
  return {entities,templates,portfolioLimit:tiers[tier]??null,portfolioTier:known?tier:null,blockers:[...blockers]};
 }
}
