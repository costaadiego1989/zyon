import {ProspectingChannelPage} from "../src/ui/prospecting/ProspectingChannelPage.js";
import {SalesKnowledgePage} from "../src/ui/prospecting/SalesKnowledgePage.js";
import {ProspectingInbox} from "../src/ui/prospecting/ProspectingInbox.js";
import {CampaignDetailPage} from "../src/ui/prospecting/CampaignDetailPage.js";
import {CampaignComposer} from "../src/ui/prospecting/CampaignComposer.js";
import {ProspectDetailPage} from "../src/ui/prospecting/ProspectDetailPage.js";
import {createRoot} from "react-dom/client";
import {PlatformApi,resolvePlatformApiBaseUrl} from "../src/lib/api.js";
import {readPlatformSession} from "../src/lib/session.js";
import {ProspectingShell} from "../src/ui/prospecting/ProspectingShell.js";
import {CompanySearchPage} from "../src/ui/prospecting/CompanySearchPage.js";

const session=readPlatformSession(),host=document.getElementById("pages")!;
if(!session){const link=document.createElement("a");link.href="/";link.textContent="Entrar no Control";host.append(link);}
else{
 const api=new PlatformApi(resolvePlatformApiBaseUrl(import.meta.env)).prospectingClient(session.token);
 const controlledSdk={prepare:async()=>{},open:async()=>({code:"local-sdk-authorization",businessId:"100003",phoneNumberId:"100004",messagingAccountIds:["100005"],isOnBizApp:false as const})};
 const common={api,operatorId:session.operator.operator_id,onSessionExpired:()=>{location.href="/";}};
 if(!location.hash)location.hash="prospecting/companies";
 createRoot(host).render(<ProspectingShell loadConfig={s=>api.config(s)} onSessionExpired={common.onSessionExpired} renderArea={(route,navigate,config)=>{
  const props={...common,navigate};
  if(route.area==="companies")return <CompanySearchPage {...props}/>;
  if(route.area==="leads")return <ProspectDetailPage {...props} route={route}/>;
  if(route.area==="campaigns"&&route.filters?.view==="edit")return <CampaignComposer {...props} id={route.id}/>;
  if(route.area==="campaigns")return <CampaignDetailPage {...props} id={route.id}/>;
  if(route.area==="conversations")return <ProspectingInbox {...props} route={route}/>;
  if(route.area==="knowledge")return <SalesKnowledgePage {...props} modelMode={config.modelMode}/>;
  if(route.area==="channel")return <ProspectingChannelPage {...props} mode={config.dispatchMode} controlledSdk={controlledSdk}/>;
  return null;
 }}/>);
}
