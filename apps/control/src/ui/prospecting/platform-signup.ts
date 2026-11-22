import type {PlatformSenderSignupState} from "@zyon/shared-types";
export type SignupAssets={code:string;businessId:string;phoneNumberId:string;messagingAccountIds:string[];isOnBizApp:false};
export type SignupSdk={prepare:(state:PlatformSenderSignupState)=>Promise<void>;open:(state:PlatformSenderSignupState,signal:AbortSignal)=>Promise<SignupAssets>};
type Facebook={init:(options:object)=>void;login:(callback:(response:{authResponse?:{code?:string}})=>void,options:object)=>void};
const fb=()=>(window as Window&{FB?:Facebook}).FB;
let loading:Promise<void>|undefined;
export const platformSignup:SignupSdk={
 async prepare(state){
  if(!fb()){loading??=new Promise<void>((resolve,reject)=>{const script=document.createElement("script");
   const fail=()=>{clearTimeout(timer);script.remove();loading=undefined;reject(Error("sdk_unavailable"));};
   const timer=window.setTimeout(fail,20000);script.src="https://connect.facebook.net/pt_BR/sdk.js";script.async=true;script.crossOrigin="anonymous";
   script.onerror=fail;script.onload=()=>{if(!fb()){fail();return;}clearTimeout(timer);resolve();};document.head.append(script);
  });await loading;}
  fb()!.init({appId:state.appId,version:"v27.0",cookie:true,xfbml:false});
 },
 open(state,signal){return new Promise((resolve,reject)=>{
  const deadline=Date.parse(state.expiresAt)-Date.now();
  if(signal.aborted||deadline<=0||!fb()){reject(Error("signup_unavailable"));return;}
  let code:string|undefined,assets:Omit<SignupAssets,"code">|undefined;
  function cleanup(){clearTimeout(timer);window.removeEventListener("message",receive);signal.removeEventListener("abort",fail);}
  function fail(){cleanup();reject(Error("signup_incomplete"));}
  function finish(){if(code&&assets){cleanup();resolve({code,...assets});}}
  function receive(event:MessageEvent){
   if(!["https://www.facebook.com","https://web.facebook.com","https://business.facebook.com"].includes(event.origin))return;
   let payload;try{payload=typeof event.data==="string"?JSON.parse(event.data):event.data;}catch{return;}
   if(payload?.type!=="WA_EMBEDDED_SIGNUP")return;
   if(payload.event==="CANCEL"||payload.event==="ERROR"){fail();return;}if(payload.event!=="FINISH")return;
   const data=payload.data,validId=(v:unknown)=>typeof v==="string"&&/^\d{1,40}$/.test(v);
   if(!data||data.is_on_biz_app!==false||!validId(data.business_id)||!validId(data.phone_number_id)||!Array.isArray(data.messaging_account_ids)||!data.messaging_account_ids.length||!data.messaging_account_ids.every(validId)){fail();return;}
   assets={businessId:data.business_id,phoneNumberId:data.phone_number_id,messagingAccountIds:[...new Set<string>(data.messaging_account_ids)],isOnBizApp:false};finish();
  }
  const timer=window.setTimeout(fail,Math.min(deadline,600000));signal.addEventListener("abort",fail,{once:true});window.addEventListener("message",receive);
  try{fb()!.login(r=>{if(!r.authResponse?.code){fail();return;}code=r.authResponse.code;finish();},{config_id:state.configId,response_type:"code",override_default_response_type:true,extras:{...state.extras,setup:{}}});}catch{fail();}
 });}
};
