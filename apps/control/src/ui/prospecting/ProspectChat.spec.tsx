import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,expect,test,vi} from "vitest";
import {PlatformApiError} from "../../lib/api.js";
import {ProspectCommandUnresolved} from "../../lib/prospecting-api.js";
import {ProspectChat} from "./ProspectChat.js";
import type {ProspectConversation,ProspectMessage} from "@zyon/shared-types";

let root:Root|undefined;
afterEach(async()=>{await act(async()=>root?.unmount());document.body.replaceChildren();vi.restoreAllMocks();});
const now=new Date().toISOString();
function msg(n:number,content:string,author:ProspectMessage["authorType"]="prospect",state:ProspectMessage["state"]="received"):ProspectMessage{
 return {id:"m"+n,conversationId:"c",sequence:n,authorType:author,authorId:author==="operator"?"operator":null,direction:author==="prospect"?"inbound":"outbound",content,state,attemptId:null,providerId:null,providerOccurredAt:now,createdAt:now};
}
function fixture(){
 let thread:ProspectConversation={id:"c",endpointId:"e",prospectId:"p",ambiguousBindings:[],mode:"human",assignedOperatorId:"operator",controlEpoch:8,lastSequence:2,readSequence:0,revision:1,unreadCount:1,lastInboundAt:now,lastInboundPreview:"Mensagem recente",serviceWindowEndsAt:new Date(Date.now()+60_000).toISOString()};
 const messages=[msg(2,"Mensagem recente")];const notes:{id:string;conversationId:string;operatorId:string;content:string;createdAt:string}[]=[];
 let realtime:()=>void=()=>{};
 const api={
  watch:vi.fn((_id:string,_cursor:()=>number,changed:()=>void)=>{realtime=changed;return ()=>{realtime=()=>{};};}),
  command:vi.fn(async(key:string)=>({clientRequestId:key,state:"completed" as const,result:null,errorCode:null})),
  history:vi.fn(async(_id:string,q:{before?:number;after?:number;limit?:number}={})=>({conversation:{...thread},messages:q.before?[msg(1,"Primeira mensagem")]:q.after!==undefined?messages.filter(m=>m.sequence>q.after!):[...messages],hasMore:!q.before&&q.after===undefined,nextCursor:q.before?null:"2"})),
  changes:vi.fn(async()=>({items:[{id:"r",conversationId:"c",kind:"delivery" as const,sequence:3,cursor:"2",occurredAt:now}],nextCursor:"2",hasMore:false})),
  notes:vi.fn(async()=>({items:[...notes],nextCursor:null})),
  offers:vi.fn(async()=>({items:[],siteUrl:null})),
  ownership:vi.fn(async(_id:string,q:{expectedEpoch:number;action:"assume"|"release"})=>{thread={...thread,mode:q.action==="assume"?"human":"ai",assignedOperatorId:q.action==="assume"?"operator":null,controlEpoch:thread.controlEpoch+1,revision:(thread.revision??0)+1};return {...thread};}),
  send:vi.fn(async(_id:string,q:{clientRequestId:string;expectedEpoch:number;content:string})=>{const m=msg(3,q.content,"operator","prepared");messages.push(m);thread={...thread,lastSequence:3,revision:2};return m;}),
  markRead:vi.fn(async(_id:string,q:{sequence:number})=>{thread={...thread,readSequence:q.sequence,unreadCount:0};return {readSequence:q.sequence};}),
  addNote:vi.fn(async(_id:string,q:{content:string})=>{const n={id:"n",content:q.content,operatorId:"operator",createdAt:now,conversationId:"c"};notes.push(n);return n;})
 };
 const host=document.createElement("div");document.body.append(host);root=createRoot(host);
 const mount=()=>act(async()=>root!.render(<ProspectChat api={api} conversationId="c" operatorId="operator" onSessionExpired={()=>{}}/>));
 const click=async(s:string)=>{const b=Array.from(host.querySelectorAll("button")).find(b=>b.textContent===s);expect(b,s).toBeDefined();await act(async()=>b!.click());};
 const fill=async(label:string,txt:string)=>{const t=host.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)!;t.focus();await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(t,txt);t.dispatchEvent(new Event("input",{bubbles:true}));});};
 return {api,host,mount,click,fill,messages,realtime:()=>realtime(),makeAI:()=>{thread={...thread,mode:"ai",assignedOperatorId:null};}};
}
test("PROS-25 AC2 renders authors, earlier history, separate internal notes and durable read state",async()=>{
 const f=fixture();await f.mount();expect(f.host.querySelector("ol")?.textContent).toContain("Contato");
 await f.click("Carregar mensagens anteriores");expect(Array.from(f.host.querySelectorAll("ol li")).map(x=>x.textContent)).toEqual([expect.stringContaining("Primeira mensagem"),expect.stringContaining("Mensagem recente")]);
 expect(f.api.history.mock.calls.some(([,q])=>q?.before===2)).toBe(true);
 await f.click("Marcar como lida");expect(f.api.markRead.mock.calls[0][1].sequence).toBe(2);
 await f.fill("Nota interna","Ligar amanhã");await f.click("Salvar nota");expect(f.host.querySelector('[aria-label="Notas internas"]')?.textContent).toContain("Ligar amanhã");expect(f.host.querySelector("ol")?.textContent).not.toContain("Ligar amanhã");expect(f.api.send).not.toHaveBeenCalled();
});
test("PROS-27 AC2 submits an ordinary message, recovers an unknown result and refreshes later provider status",async()=>{
 const f=fixture();await f.mount();
 f.api.send.mockImplementationOnce(async(_,cmd)=>{throw new ProspectCommandUnresolved(cmd.clientRequestId,"unconfirmed");});
 await f.fill("Mensagem ao contato","Retorno local");await f.click("Enviar mensagem");expect(f.host.textContent).toContain("confirmação");expect(f.host.querySelector("ol")?.textContent).not.toContain("Retorno local");
 await f.click("Consultar resultado");const [first,second]=f.api.send.mock.calls;expect(first).toEqual(second);expect(first[1]).toEqual({clientRequestId:expect.any(String),expectedEpoch:8,content:"Retorno local"});
 expect(f.host.querySelector("ol")?.textContent).toContain("Preparada");expect(f.host.querySelector("ol")?.textContent).not.toContain("Entregue");
 f.messages[1].state="provider_accepted";await f.click("Atualizar conversa");expect(f.host.querySelector("ol")?.textContent).toContain("Aceita pelo provedor");expect(f.api.changes).toHaveBeenCalled();
 f.messages[1].state="delivered";await act(async()=>f.realtime());expect(f.host.querySelector("ol")?.textContent).toContain("Entregue");
});
test("PROS-27 AC2 reopening a conversation with an interrupted write resolves its stored ID without replaying the message",async()=>{
 const f=fixture();await f.mount();f.api.send.mockImplementationOnce(async(_,cmd)=>{throw new ProspectCommandUnresolved(cmd.clientRequestId,"unconfirmed");});
 await f.fill("Mensagem ao contato","Resposta interrompida");await f.click("Enviar mensagem");
 const key=f.api.send.mock.calls[0][1].clientRequestId;
 await act(async()=>root!.unmount());f.host.remove();
 const reopened=fixture();await reopened.mount();await reopened.click("Consultar resultado");
 expect(reopened.api.command).toHaveBeenCalledWith(key);expect(reopened.api.send).not.toHaveBeenCalled();
 expect(reopened.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensagem ao contato"]')?.disabled).toBe(false);
});
test("PROS-27 AC3 shows authoritative ownership after takeover and release, requires the persisted epoch",async()=>{
 const f=fixture();f.makeAI();await f.mount();expect(f.host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Mensagem ao contato"]')?.disabled).toBe(true);
 await f.click("Assumir atendimento");expect(f.api.ownership.mock.calls[0][1]).toMatchObject({action:"assume",expectedEpoch:8});expect(f.host.textContent).toContain("Sob seu atendimento");
 f.api.ownership.mockRejectedValueOnce(new PlatformApiError(409,undefined,"epoch_conflict"));
 await f.click("Devolver para a IA");expect(f.host.textContent).toContain("controle mudou");expect(f.host.textContent).toContain("Sob seu atendimento");
 await f.click("Devolver para a IA");expect(f.api.ownership.mock.calls[2][1]).toMatchObject({action:"release",expectedEpoch:9});expect(f.host.textContent).toContain("Atendimento pela IA");
});
test("chat handles loading, empty, retry and forbidden without leaving an actionable historical draft",async()=>{
 const f=fixture();let reject!:(reason:Error)=>void;
 f.api.history.mockImplementationOnce(()=>new Promise((_,r)=>{reject=r;}));await f.mount();expect(f.host.textContent).toContain("Carregando");
 await act(async()=>reject(new Error("temporary")));expect(f.host.querySelector('[role="alert"]')).toBeTruthy();
 f.api.history.mockRejectedValueOnce(new PlatformApiError(403));await f.click("Tentar novamente");expect(f.host.textContent).toContain("permissão");expect(f.host.querySelector("textarea")).toBeNull();
 const empty=fixture();empty.messages.splice(0);await empty.mount();expect(empty.host.textContent).toContain("Nenhuma mensagem");
});
