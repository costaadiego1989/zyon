import {describe,it,expect} from "vitest";
import {conversationActions,conversationDeliveryLabel} from "./conversation-actions.js";
import type {ConversationContext,ConversationDetail} from "./conversation-types.js";
const context:ConversationContext={merchant_id:"merchant-a",user_id:"operator-a",role:"STAFF"};
const detail:ConversationDetail={ticket:{id:"ticket-a",status:"in_progress",buyerMessage:"Current request",createdAt:"now",updatedAt:"now"},
  binding:{id:"binding-a",ticketId:"ticket-a",mode:"human",epoch:2,assignedOperatorId:"operator-a",configId:"config-a",whatsappSessionId:"session-a"},
  channel:{id:"config-a",provider:"META_CLOUD",status:"ACTIVE",enabled:true},messages:[],has_more:false,next_cursor:null};
describe("T61 truthful controls and delivery labels",()=>{
  it("a disconnected channel blocks send but retains the authorized canonical close",()=>{
    const actions=conversationActions(context,{...detail,channel:null},true);expect(actions.send).toBe(false);expect(actions.close).toBe(true);
  });
  it("owner cannot override another claimed operator and missing binding never invents AI authority",()=>{
    expect(conversationActions({...context,role:"OWNER",user_id:"other"},detail,true)).toEqual({claim:false,send:false,close:false});
    expect(conversationActions(context,{...detail,binding:null},true)).toEqual({claim:false,send:false,close:false});
  });
  it("current waiting case can be claimed, while old closed cases stay read only",()=>{
    expect(conversationActions(context,{...detail,ticket:{...detail.ticket,status:"open"},binding:{...detail.binding!,mode:"waiting_human",assignedOperatorId:null}},true).claim).toBe(true);
    expect(conversationActions(context,{...detail,ticket:{...detail.ticket,status:"closed"},binding:{...detail.binding!,mode:"ai",assignedOperatorId:null}},true)).toEqual({claim:false,send:false,close:false});
  });
  it("never conflates queued/accepted/unknown with provider delivery or reading",()=>{
    expect(conversationDeliveryLabel("queued")).toBe("Na fila");expect(conversationDeliveryLabel("accepted")).toBe("Aceita pelo canal");
    expect(conversationDeliveryLabel("unknown")).toBe("Envio não confirmado");expect(conversationDeliveryLabel("delivered")).toBe("Entregue");expect(conversationDeliveryLabel("read")).toBe("Lida");
  });
});
