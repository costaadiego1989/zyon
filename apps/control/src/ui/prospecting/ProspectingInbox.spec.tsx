import {expect,test,vi} from "vitest";
import {act,useState} from "react";
import {ProspectingInbox} from "./ProspectingInbox.js";
import {screenProps,show} from "./screen-test.js";
import type {ProspectRoute} from "./ProspectingShell.js";
const thread={id:"c",endpointId:"ep",unreadCount:2,lastInboundPreview:"Posso usar a integração?",lastInboundAt:"2026-11-01T13:00:00Z",mode:"ai",controlEpoch:1,lastSequence:1,revision:4,ambiguousBindings:[]};
const campaigns=async()=>({items:[{id:"c1",name:"Outubro"}],nextCursor:null});
test("PROS-27 AC1 filtros de responsável, campanha, busca e não lidas mostram a resposta real",async()=>{
 const conversations=vi.fn(async(q)=>({items:q.unread?[{...thread,lastInboundPreview:"Última resposta filtrada"}]:[thread],nextCursor:null}));
 const props=screenProps({conversations,campaigns});function Flow(){const [route,navigate]=useState<ProspectRoute>({area:"conversations"});return <ProspectingInbox {...props} route={route} navigate={navigate}/>;}
 const ui=await show(<Flow/>);await ui.fill("Buscar resposta ou CNPJ","integração");await ui.fill("Responsável","operator-test");await ui.fill("Campanha","c1");await ui.check("Não lidas");await ui.click("Aplicar filtros");
 expect(conversations.mock.lastCall?.[0]).toMatchObject({unread:true,assignedOperatorId:"operator-test",campaignId:"c1",search:"integração"});expect(ui.text()).toContain("Última resposta filtrada");expect(ui.text()).not.toContain(thread.lastInboundPreview);
});
test("PROS-27 AC4 reconexão alcança mudanças de posse sem nova mensagem nem duplicação",async()=>{
 let online=false;const observed=()=>online?{...thread,mode:"human",assignedOperatorId:"Ana",revision:5}:thread;
 const message={id:"m",sequence:1,content:"Texto recebido",authorType:"prospect",state:"received",createdAt:thread.lastInboundAt};
 const changes=vi.fn(async()=>({items:[{kind:"ownership",sequence:null}],nextCursor:"5",hasMore:false}));
 const props=screenProps({campaigns,conversations:async()=>({items:[observed()],nextCursor:null}),watch:()=>()=>{},history:async()=>({conversation:observed(),messages:[message],hasMore:false,nextCursor:null}),offers:async()=>({items:[]}),notes:async()=>({items:[],nextCursor:null}),changes});
 function Flow(){const [route,navigate]=useState<ProspectRoute>({area:"conversations"});return <ProspectingInbox {...props} route={route} navigate={navigate}/>;}
 const ui=await show(<Flow/>);await ui.click("Abrir conversa");expect(ui.text()).toContain("Texto recebido");online=true;await act(async()=>window.dispatchEvent(new Event("online")));
 expect(changes.mock.calls[0]).toEqual(expect.arrayContaining(["c",4]));expect(ui.text()).toContain("Ana");expect(ui.host.querySelectorAll(".prospecting-transcript li")).toHaveLength(1);
});
