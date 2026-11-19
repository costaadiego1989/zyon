/** @vitest-environment jsdom */
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {createDashboardApi} from "../../../api-client.js";
import {WhatsAppConversationDrawer} from "./WhatsAppConversationDrawer.js";
import type {ConversationContext,ConversationDetail} from "../conversation-types.js";
import type {useWhatsAppConversations} from "../useWhatsAppConversations.js";

const context:ConversationContext={merchant_id:"merchant-a",user_id:"operator-a",role:"STAFF"};
const detail:ConversationDetail={ticket:{id:"ticket-a",status:"in_progress",buyerMessage:"Current request",createdAt:"now",updatedAt:"now"},
  binding:{id:"binding-a",ticketId:"ticket-a",mode:"human",epoch:2,assignedOperatorId:"operator-a",configId:"config-a",whatsappSessionId:"session-a"},
  channel:null,messages:[{id:"message-a",ticketId:"ticket-a",senderType:"merchant",content:"Canonical reply",createdAt:"2026-11-17T10:00:00Z",delivery:{status:"accepted",revision:1}},
    {id:"message-b",ticketId:"ticket-a",senderType:"system",content:"🤖 Retomada não confirmada",createdAt:"2026-11-17T10:00:01Z",delivery:{status:"unknown",revision:1}}],has_more:false,next_cursor:null};
const mounts:Array<{root:Root;host:HTMLDivElement}>=[];
afterEach(async()=>{for(const value of mounts.splice(0)){await act(async()=>value.root.unmount());value.host.remove();}});
async function fixture(patch:Partial<ReturnType<typeof useWhatsAppConversations>>={}){
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});HTMLElement.prototype.scrollIntoView=vi.fn();
  const requests:string[]=[];const api=createDashboardApi({baseUrl:"https://api.example.test",fetchImpl:async input=>{requests.push(String(input));return new Response('{}',{status:503});}});
  const vm={detail,connected:true,busy:false,detailLoading:false,detailError:null,actionError:null,closeDrawer:vi.fn(),reload:vi.fn(),open:vi.fn(),
    send:vi.fn(async()=>{throw Error("Unknown response");}),claim:vi.fn(async()=>{}),closeCase:vi.fn(async()=>{}),...patch} as unknown as ReturnType<typeof useWhatsAppConversations>;
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);mounts.push({root,host});
  await act(async()=>root.render(<WhatsAppConversationDrawer context={context} api={api} vm={vm}/>));
  return{vm,requests,host};
}
describe("T61 bound drawer reuses support UI without private configuration access",()=>{
  it("renders truthful canonical labels and makes no legacy history/marketplace/config request",async()=>{
    const f=await fixture();expect(f.requests).toEqual([]);expect(document.body.textContent).toContain("Aceita pelo canal");
    expect(document.body.textContent).toContain("Envio não confirmado");expect(document.body.textContent).toContain("Assistente virtual");
    expect(document.body.textContent).not.toContain("Entregue");expect(document.body.textContent).not.toContain("Lida");
  });
  it("retains the authorized close while an unavailable channel disables send",async()=>{
    const f=await fixture();const close=[...document.querySelectorAll('button')].find(value=>value.textContent?.includes("Encerrar e retomar IA"));
    expect(close).toBeTruthy();expect((close as HTMLButtonElement).disabled).toBe(false);
    const send=[...document.querySelectorAll('button')].find(value=>value.textContent?.includes("Enviar resposta"));expect((send as HTMLButtonElement).disabled).toBe(true);
    await act(async()=>{(close as HTMLButtonElement).click();});expect(f.vm.closeCase).toHaveBeenCalledTimes(1);
  });
  it("another claimed operator remains read only in the mounted drawer",async()=>{
    await fixture({detail:{...detail,binding:{...detail.binding!,assignedOperatorId:"another-operator"}}});
    expect([...document.querySelectorAll('button')].some(value=>value.textContent?.includes("Encerrar e retomar IA"))).toBe(false);
    const send=[...document.querySelectorAll('button')].find(value=>value.textContent?.includes("Enviar resposta"));expect((send as HTMLButtonElement).disabled).toBe(true);
  });
  it("uncertain send keeps the draft instead of showing a fake successful message",async()=>{
    const f=await fixture({detail:{...detail,channel:{id:"config-a",provider:"META_CLOUD",status:"ACTIVE",enabled:true}}});
    const input=document.querySelector('textarea')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Rascunho preservado");input.dispatchEvent(new Event("input",{bubbles:true}));});
    const send=[...document.querySelectorAll('button')].find(value=>value.textContent?.includes("Enviar resposta"))!;
    await act(async()=>{send.click();});expect(f.vm.send).toHaveBeenCalledWith("Rascunho preservado");expect(input.value).toBe("Rascunho preservado");
    expect(document.querySelectorAll('.support-msg')).toHaveLength(2);
  });
  it("Escape with an unsent draft uses the existing confirmation rather than silently discarding",async()=>{
    const f=await fixture(),input=document.querySelector('textarea')!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(input,"Ainda não enviada");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{input.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true}));});
    expect(f.vm.closeDrawer).not.toHaveBeenCalled();expect(document.body.textContent).toContain("Continuar editando");expect(input.value).toBe("Ainda não enviada");
  });
});
