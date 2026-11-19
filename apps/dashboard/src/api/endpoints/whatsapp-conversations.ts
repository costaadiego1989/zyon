import {dashboardJson} from "../http/client.js";
import type {ConversationApi} from "../../pages/whatsapp-seller/conversation-types.js";

/** Only the server-scoped conversation API. No merchant ID, profile, config
 * credential or connection/template request is constructed here. */
export function whatsappConversationEndpoints(base:string,f:typeof fetch):ConversationApi{
  const path="/support/whatsapp/conversations",ticket=(id:string)=>path+"/"+encodeURIComponent(id);
  const query=(value:object|undefined)=>{const fields=new URLSearchParams();for(const[key,item]of Object.entries(value??{}))if(item!==undefined)fields.set(key,String(item));
    return fields.size?"?"+fields.toString():"";};
  return{
    getWhatsAppConversationContext:()=>dashboardJson(base,path+"/context",{method:"GET"},f),
    getWhatsAppConversations:value=>dashboardJson(base,path+query(value),{method:"GET"},f),
    getWhatsAppConversation:(id,value)=>dashboardJson(base,ticket(id)+query(value),{method:"GET"},f),
    claimWhatsAppConversation:(id,body)=>dashboardJson(base,ticket(id)+"/claim",{method:"POST",jsonBody:body},f),
    closeWhatsAppConversation:(id,body)=>dashboardJson(base,ticket(id)+"/close",{method:"POST",jsonBody:body},f),
    sendWhatsAppConversationMessage:(id,body)=>dashboardJson(base,ticket(id)+"/messages",{method:"POST",jsonBody:body},f),
  };
}
