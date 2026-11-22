import {useEffect,useId,useState,type ReactNode} from "react";
import {PlatformApiError} from "../../lib/api.js";
import type {ProspectingApi} from "../../lib/prospecting-api.js";
import "./prospecting.css";

export const prospectAreas={overview:"Visão geral",companies:"Buscar empresas",leads:"Leads",campaigns:"Campanhas",
 conversations:"Conversas",knowledge:"Conhecimento",channel:"Canal",privacy:"Privacidade"} as const;
export type ProspectArea=keyof typeof prospectAreas;
export type ProspectRoute={area:ProspectArea;id?:string;filters?:Record<string,string>};
type Config=Awaited<ReturnType<ProspectingApi["config"]>>;
function href(route:ProspectRoute){
 const query=new URLSearchParams(route.filters);
 return "#prospecting/"+route.area+(route.id?"/"+encodeURIComponent(route.id):"")+(query.size?"?"+query:"");
}
function current():ProspectRoute{
 const [raw,query]=location.hash.split("?"),[prefix,area,id]=raw.split("/");
 if(prefix!=="#prospecting"||!Object.hasOwn(prospectAreas,area))return {area:"overview"};
 try{return {area:area as ProspectArea,id:id?decodeURIComponent(id):undefined,filters:Object.fromEntries(new URLSearchParams(query))};}
 catch{return {area:"overview"};}
}
type State="loading"|"empty"|"error"|"forbidden";
const messages:Record<State,string>={loading:"Carregando informações…",empty:"Nenhum registro encontrado.",error:"Não foi possível carregar os dados.",forbidden:"Seu perfil não tem permissão para acessar esta área."};
export function ProspectingState({state,message,retry}:{state:State;message?:string;retry?:()=>void}){
 return <div className="prospecting-state" aria-busy={state==="loading"}><p role={state==="error"||state==="forbidden"?"alert":"status"}>{message??messages[state]}</p>
  {retry&&<button type="button" className="button" onClick={retry}>Tentar novamente</button>}</div>;
}
export function ProspectingShell({loadConfig,onSessionExpired,renderArea}:{
 loadConfig:(signal:AbortSignal)=>Promise<Config>;onSessionExpired:()=>void;
 renderArea:(route:ProspectRoute,navigate:(route:ProspectRoute)=>void,config:Config)=>ReactNode;
}){
 const [route,setRoute]=useState(current),[config,setConfig]=useState<Config|null>(null),[state,setState]=useState<State>("loading"),[attempt,setAttempt]=useState(0);
 const navId=useId();
 useEffect(()=>{
  const sync=()=>setRoute(current());
  window.addEventListener("popstate",sync);window.addEventListener("hashchange",sync);
  return ()=>{window.removeEventListener("popstate",sync);window.removeEventListener("hashchange",sync);};
 },[]);
 useEffect(()=>{
  const abort=new AbortController();setConfig(null);setState("loading");
  void loadConfig(abort.signal).then(value=>{if(!abort.signal.aborted)setConfig(value);}).catch(e=>{
   if(abort.signal.aborted)return;
   if(e instanceof PlatformApiError && e.status===401){onSessionExpired();setState("forbidden");}
   else setState(e instanceof PlatformApiError&&e.status===403?"forbidden":"error");
  });
  return ()=>abort.abort();
 },[loadConfig,onSessionExpired,attempt]);
 function navigate(next:ProspectRoute){const hash=href(next);if(location.hash!==hash)history.pushState(null,"",hash);setRoute(next);}
 if(!config)return <ProspectingState state={state} retry={state==="error"?()=>setAttempt(x=>x+1):undefined}/>;
 if(!config.moduleEnabled)return <ProspectingState state="empty" message="A prospecção está desativada neste ambiente."/>;
 return <section className="prospecting-shell" aria-label="Prospecção de empresas">
  <nav aria-label="Áreas da prospecção" className="prospecting-nav">
   {Object.entries(prospectAreas).map(([key,label])=>{const area=key as ProspectArea;return <a key={area} href={href({area})} aria-current={route.area===area?"page":undefined}
    onClick={e=>{if(!e.ctrlKey&&!e.metaKey&&!e.shiftKey&&!e.altKey){e.preventDefault();navigate({area});}}}>{label}</a>;})}
  </nav>
  <div className="prospecting-mobile-nav"><label htmlFor={navId}>Área da prospecção</label><select id={navId} value={route.area} onChange={e=>navigate({area:e.target.value as ProspectArea})}>
   {Object.entries(prospectAreas).map(([area,label])=><option key={area} value={area}>{label}</option>)}</select></div>
  <article aria-label={prospectAreas[route.area]} key={route.area}>{renderArea(route,navigate,config)}</article>
 </section>;
}
