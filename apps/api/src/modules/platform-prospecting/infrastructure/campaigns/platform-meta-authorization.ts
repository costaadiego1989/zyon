import type { WhatsAppSignupAuthorization, MetaCloudAuthorizedAssets } from "../../../whatsapp-channel/domain/ports/whatsapp-signup-authorization.port.js";
import { whatsappE164 } from "../../../whatsapp-channel/domain/services/whatsapp-phone.js";
import type { PlatformSignupConfig } from "../../application/campaigns/platform-sender-onboarding.service.js";

export const platformGraph = "https://graph.facebook.com/v27.0/";
type Asset = Pick<MetaCloudAuthorizedAssets,"accessToken"|"wabaId"|"phoneNumberId">;
interface GraphData {
  id?:string; access_token?:string; expires_in?:number; owner_business_info?:{id:string}; status?:string; platform_type?:string; success?:boolean;
  paging?:{next?:string;cursors?:{after?:string}};
}
interface Phone {id:string;status?:string;platform_type?:string;display_phone_number?:string;whatsapp_business_api_data?:{id:string}}
export class PlatformMetaAuthorization implements WhatsAppSignupAuthorization {
  constructor(private readonly config: PlatformSignupConfig, private readonly fetcher:typeof fetch=fetch) {}
  private async request<T>(path:string, token?:string, query:Record<string,string>={}, post?:Record<string,string>):Promise<T> {
    const url=new URL(path,platformGraph);
    for(const [name,value] of Object.entries(query)) url.searchParams.set(name,value);
    try {
      const res=await this.fetcher(url,{redirect:"error",signal:AbortSignal.timeout(5000),method:post?"POST":"GET",headers:{...(token?{Authorization:"Bearer "+token}:{}),...(post?{"Content-Type":"application/json"}:{})},body:post?JSON.stringify(post):undefined});
      if(!res.ok) throw new Error();
      return await res.json() as T;
    } catch {throw new Error("sender_authorization_unavailable");}
  }
  private async find(path:string,token:string,fields:string|undefined,match:(row:Phone)=>boolean) {
    const query:Record<string,string>={limit:"100"}; if(fields) query.fields=fields;
    for(let page=0;page<20;page++){
      const res=await this.request<GraphData & {data:Phone[]}>(path,token,query);
      if(!Array.isArray(res.data)) throw new Error("sender_authorization_unavailable");
      const row=res.data.find(match); if(row)return row;
      if(!res.paging?.next)return null;
      const after=res.paging.cursors?.after; if(!after || query.after===after)break;
      query.after=after;
    }
    throw new Error("sender_authorization_unavailable");
  }
  async authorize(input:{code:string;wabaId:string;phoneNumberId:string}):Promise<MetaCloudAuthorizedAssets>{
    const {appId,appSecret,businessId,phoneNumberId}=this.config;
    if(!/^\d+$/.test(input.wabaId)||input.phoneNumberId!==phoneNumberId)throw new Error("sender_identity_mismatch");
    const grant=await this.request<GraphData>("oauth/access_token",undefined,{client_id:appId,client_secret:appSecret,code:input.code});
    const token=grant.access_token; if(!token)throw new Error("sender_authorization_unavailable");
    const {data}=await this.request<{data:{is_valid:boolean;app_id:string;granular_scopes?:{scope:string;target_ids?:string[]}[]}}>("debug_token",appId+"|"+appSecret,{input_token:token});
    if(!data?.is_valid||data.app_id!==appId||!["whatsapp_business_management","whatsapp_business_messaging"].every(s=>data.granular_scopes?.some(g=>g.scope===s&&g.target_ids?.includes(input.wabaId)))) throw new Error("sender_identity_mismatch");
    const account=await this.request<GraphData>(input.wabaId,token,{fields:"id,owner_business_info"});
    if(account.id!==input.wabaId||account.owner_business_info?.id!==businessId) throw new Error("sender_identity_mismatch");
    const phone=await this.find(input.wabaId+"/phone_numbers",token,"id,status,display_phone_number,platform_type",r=>r.id===phoneNumberId);
    const display=phone?.display_phone_number && whatsappE164(phone.display_phone_number);
    if(!display)throw new Error("sender_identity_mismatch");
    return {wabaId:input.wabaId,phoneNumberId,whatsappNumber:display,accessToken:token,phoneRegistered:phone?.status==="CONNECTED"&&phone.platform_type==="CLOUD_API",tokenExpiresAt:grant.expires_in && grant.expires_in>0?new Date(Date.now()+1000*grant.expires_in):undefined};
  }
  async isSubscribed(asset:Pick<Asset,"accessToken"|"wabaId">){return !!await this.find(asset.wabaId+"/subscribed_apps",asset.accessToken,undefined,r=>r.whatsapp_business_api_data?.id===this.config.appId);}
  async subscribe(asset:Pick<Asset,"accessToken"|"wabaId">){if(!(await this.request<GraphData>(asset.wabaId+"/subscribed_apps",asset.accessToken,{},{})).success)throw new Error("sender_subscription_unknown");}
  async isPhoneRegistered(asset:Pick<Asset,"accessToken"|"phoneNumberId">){const r=await this.request<GraphData>(asset.phoneNumberId,asset.accessToken,{fields:"status,platform_type"});return r.status==="CONNECTED"&&r.platform_type==="CLOUD_API";}
  async registerPhone(asset:Pick<Asset,"accessToken"|"phoneNumberId">,pin:string){if(!/^\d{6}$/.test(pin)||!(await this.request<GraphData>(asset.phoneNumberId+"/register",asset.accessToken,{},{messaging_product:"whatsapp",pin})).success)throw new Error("sender_registration_required");}
}
