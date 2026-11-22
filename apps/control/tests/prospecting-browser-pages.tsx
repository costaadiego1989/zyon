import {createRoot} from "react-dom/client";
import {PlatformApi,resolvePlatformApiBaseUrl} from "../src/lib/api.js";
import {readPlatformSession} from "../src/lib/session.js";
import {ProspectingShell} from "../src/ui/prospecting/ProspectingShell.js";
import {CompanySearchPage} from "../src/ui/prospecting/CompanySearchPage.js";

const session=readPlatformSession(),host=document.getElementById("pages")!;
if(!session){const link=document.createElement("a");link.href="/";link.textContent="Entrar no Control";host.append(link);}
else{
 const api=new PlatformApi(resolvePlatformApiBaseUrl(import.meta.env)).prospectingClient(session.token);
 const common={api,operatorId:session.operator.operator_id,onSessionExpired:()=>{location.href="/";}};
 if(!location.hash)location.hash="prospecting/companies";
 createRoot(host).render(<ProspectingShell loadConfig={s=>api.config(s)} onSessionExpired={common.onSessionExpired} renderArea={(route,navigate)=>{
  const props={...common,navigate};
  if(route.area==="companies")return <CompanySearchPage {...props}/>;
  return null;
 }}/>);
}
