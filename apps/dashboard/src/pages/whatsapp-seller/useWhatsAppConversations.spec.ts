/** @vitest-environment jsdom */
import React,{act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,describe,expect,it,vi} from "vitest";
import {useWhatsAppConversations} from "./useWhatsAppConversations.js";
import type {ConversationApi,ConversationContext,ConversationDetail,ConversationMessage} from "./conversation-types.js";

const context:ConversationContext={merchant_id:"merchant-a",user_id:"operator-a",role:"STAFF"};
const detail:ConversationDetail={ticket:{id:"ticket-a",status:"in_progress",buyerMessage:"Request",createdAt:"2026-11-17T10:00:00.000Z",updatedAt:"2026-11-17T10:00:00.000Z"},
  binding:{id:"binding-a",ticketId:"ticket-a",mode:"human",epoch:2,assignedOperatorId:"operator-a",configId:"config-a",whatsappSessionId:"session-a"},
  channel:{id:"config-a",enabled:true,status:"ACTIVE",provider:"META_CLOUD"},messages:[],has_more:false,next_cursor:null};
const mounts:Array<{root:Root;host:HTMLDivElement}>=[];
afterEach(async()=>{for(const value of mounts.splice(0)){await act(async()=>value.root.unmount());value.host.remove();}});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
async function fixture(options:{api?:Partial<ConversationApi>;context?:ConversationContext|null}={}){
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  let vm!:ReturnType<typeof useWhatsAppConversations>;
  let current:ConversationContext|null=options.context??context;
  let listener:(raw:unknown)=>void=()=>{};
  const socket={connected:true,joinTicket:vi.fn(),leaveTicket:vi.fn(),onNewMessage:(handler:(raw:unknown)=>void)=>{listener=handler;return()=>{listener=()=>{};};}};
  const api:ConversationApi={getWhatsAppConversationContext:async()=>context,
    getWhatsAppConversations:async()=>({data:[],has_more:false,next_cursor:null}),getWhatsAppConversation:async()=>structuredClone(detail),
    claimWhatsAppConversation:vi.fn(async()=>({})),closeWhatsAppConversation:vi.fn(async()=>({})),
    sendWhatsAppConversationMessage:vi.fn(async()=>{throw Error("uncertain transport response");}),...options.api};
  function Probe(){vm=useWhatsAppConversations({context:current,api,socket});return null;}
  const host=document.createElement("div");document.body.append(host);const root=createRoot(host);mounts.push({root,host});
  await act(async()=>root.render(React.createElement(Probe)));
  return{api,socket,get vm(){return vm;},async scope(value:ConversationContext|null){current=value;await act(async()=>root.render(React.createElement(Probe)));},
    async event(value:unknown){await act(async()=>listener(value));},async reconnect(){socket.connected=false;await act(async()=>root.render(React.createElement(Probe)));socket.connected=true;await act(async()=>root.render(React.createElement(Probe)));}};
}
describe("T60 current-scope queue and explicit command gestures",()=>{
  it("late prior-tenant queue data is discarded rather than rendered after scope change",async()=>{
    const held=deferred<Awaited<ReturnType<ConversationApi["getWhatsAppConversations"]>>>();let reads=0;
    const f=await fixture({api:{getWhatsAppConversations:async()=>++reads===1?held.promise:{data:[],has_more:false,next_cursor:null}}});
    await f.scope({...context,merchant_id:"merchant-b",user_id:"operator-b"});
    await act(async()=>held.resolve({data:[{...detail.ticket,binding:detail.binding}],has_more:false,next_cursor:null}));
    expect(f.vm.queue).toEqual([]);expect(f.vm.detail).toBeNull();
  });
  it("HTTP/socket duplication keeps one canonical message and the actual revision",async()=>{
    const initial:ConversationMessage={id:"message-a",ticketId:"ticket-a",senderType:"merchant",content:"Reply",createdAt:detail.ticket.createdAt,
      clientMessageId:"client-original-123",delivery:{status:"queued",revision:0}};
    const f=await fixture({api:{getWhatsAppConversation:async()=>({...structuredClone(detail),messages:[initial]})}});
    await act(async()=>f.vm.open("ticket-a"));
    const event={...initial,metadata:{kind:"whatsapp_outgoing",schemaVersion:1,clientMessageId:"client-original-123",delivery:{status:"accepted",revision:1},authority:"private-canary"}};
    await f.event(event);await f.event(event);expect(f.vm.detail?.messages).toEqual([{...initial,delivery:{status:"accepted",revision:1}}]);
    await f.event({...event,ticketId:"foreign-ticket"});expect(f.vm.detail?.messages).toHaveLength(1);
    expect(JSON.stringify(f.vm.detail)).not.toContain("private-canary");
  });
  it("an uncertain response and reconnect cause no automatic send; explicit retry retains original client intent",async()=>{
    const send=vi.fn(async()=>{throw Error("response unknown");});const f=await fixture({api:{sendWhatsAppConversationMessage:send}});
    await act(async()=>f.vm.open("ticket-a"));await act(async()=>{await expect(f.vm.send("Reply")).rejects.toThrow("response unknown");});
    const original=send.mock.calls[0];await f.reconnect();expect(send).toHaveBeenCalledTimes(1);
    await act(async()=>{await expect(f.vm.send("Reply")).rejects.toThrow("response unknown");});
    expect(send.mock.calls[1]).toEqual(original);
  });
});
