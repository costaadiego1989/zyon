import {describe,it,expect} from "vitest";
import {mergeConversationMessages} from "./conversation-reconciliation.js";
import type {ConversationMessage} from "./conversation-types.js";
const row=(patch:Partial<ConversationMessage>={}):ConversationMessage=>({id:"message-a",ticketId:"ticket-a",senderType:"merchant",content:"Actual reply",
  createdAt:"2026-11-17T10:00:00.000Z",clientMessageId:"client-original-123",delivery:{status:"queued",revision:0},...patch});
describe("T60 canonical message reconciliation",()=>{
  it("deduplicates HTTP/socket replay and keeps the greater canonical revision",()=>{
    const accepted=row({delivery:{status:"accepted",revision:1}});
    const current=mergeConversationMessages([row()],[accepted,accepted],"ticket-a");expect(current).toEqual([accepted]);
    expect(mergeConversationMessages(current,[row()],"ticket-a")).toEqual(current);
  });
  it("accepted remains accepted, and unknown is never converted into delivered or read",()=>{
    for(const status of ["accepted","unknown"] as const){const value=row({delivery:{status,revision:1}});
      expect(mergeConversationMessages([value],[value],"ticket-a")[0].delivery?.status).toBe(status);}
  });
  it("deduplicates only a matching client intent in the same bound ticket",()=>{
    const pending=row({id:"pending-client-original-123"}),persisted=row();
    expect(mergeConversationMessages([pending],[persisted],"ticket-a")).toEqual([persisted]);
    expect(()=>mergeConversationMessages([persisted],[row({ticketId:"foreign-ticket"})],"ticket-a")).toThrow("conversation_scope_mismatch");
  });
  it("same-revision contradiction or changed original text is rejected for reload",()=>{
    expect(()=>mergeConversationMessages([row()],[row({delivery:{status:"read",revision:0}})],"ticket-a")).toThrow("conversation_projection_changed");
    expect(()=>mergeConversationMessages([row()],[row({content:"Changed after intent"})],"ticket-a")).toThrow("conversation_message_changed");
  });
});
