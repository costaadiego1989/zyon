import {act} from "react";
import {createRoot} from "react-dom/client";
import {expect,test,vi} from "vitest";
import {PlatformApiError} from "../../lib/api.js";
import {ProspectingShell,ProspectingState} from "./ProspectingShell.js";

test("prospecting shell recovers loading and errors, navigates all eight areas and preserves details on browser history",async()=>{
 const host=document.createElement("div");document.body.append(host);const root=createRoot(host);
 const config={moduleEnabled:true,workersRunning:true,ingestionEnabled:false,dispatchMode:"controlled" as const,modelMode:"controlled" as const,reservationDayTimezone:"UTC" as const};
 let finish!:(v:typeof config)=>void;
 const load=vi.fn().mockRejectedValueOnce(new Error("unavailable")).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 const expired=vi.fn();
 try{
  await act(async()=>root.render(<ProspectingShell loadConfig={load} onSessionExpired={expired} renderArea={(route,navigate)=>
   route.area==="leads"?<button onClick={()=>navigate({area:"leads",id:"empresa/01"})}>{route.id??"Abrir empresa"}</button>:
   <ProspectingState state="empty" message="Nenhum registro no período."/>}/>));
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("carregar");
  await act(async()=>host.querySelector("button")!.click());expect(host.querySelector('[role="status"]')?.textContent).toContain("Carregando");
  await act(async()=>finish(config));expect(host.querySelectorAll("nav a")).toHaveLength(8);expect(host.textContent).toContain("Nenhum registro no período.");
  const leads=Array.from(host.querySelectorAll("nav a")).find(a=>a.textContent==="Leads") as HTMLAnchorElement;
  leads.focus();expect(document.activeElement).toBe(leads);await act(async()=>leads.click());
  await act(async()=>host.querySelector<HTMLButtonElement>("section article button")!.click());
  expect(host.textContent).toContain("empresa/01");expect(location.hash).toContain("empresa%2F01");
  const select=host.querySelector("select")!;await act(async()=>{select.value="privacy";select.dispatchEvent(new Event("change",{bubbles:true}));});
  expect(host.querySelector('a[aria-current="page"]')?.textContent).toBe("Privacidade");
  await act(async()=>{history.replaceState({},"","#prospecting/leads/empresa%2F01");window.dispatchEvent(new PopStateEvent("popstate"));});
  expect(host.textContent).toContain("empresa/01");
 }finally{await act(async()=>root.unmount());host.remove();history.replaceState({},"","/");}
});
test("prospecting shell withholds actions on forbidden and expires the canonical session on 401",async()=>{
 const host=document.createElement("div"),root=createRoot(host),expired=vi.fn();
 try{
  for(const status of [403,401]){
   const load=async()=>{throw new PlatformApiError(status);};
   await act(async()=>root.render(<ProspectingShell loadConfig={load} onSessionExpired={expired} renderArea={()=> <button>Alterar</button>}/>));
   expect(host.querySelector("nav")).toBeNull();expect(host.textContent).not.toContain("Alterar");
   if(status===403)expect(host.querySelector('[role="alert"]')?.textContent).toContain("permissão");
  }
  expect(expired).toHaveBeenCalledOnce();
 }finally{await act(async()=>root.unmount());}
});
