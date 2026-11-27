import test from "node:test";
import assert from "node:assert/strict";
import { HandleMetaConversationUseCase } from "../../whatsapp-channel/application/use-cases/handle-meta-conversation.use-case.js";

for (const surface of ["opening", "opt-out", "ui"] as const) {
  for (const expiresAt of surface === "ui" ? ["send-wrapper"] as const : ["inbound", "send-wrapper"] as const) {
    test(`release native ${surface} never dispatches after lease loss during ${expiresAt}`, async () => {
      let owned = true;
      let providerCalls = 0;
      const state = { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "", page: 0, previousViews: [] };
      const claim = { id: "inbox", eventId: "event", merchantId: "store", leaseToken: "lease",
        ...(surface === "ui" ? {responseState:{phase:"prepared",state,sessionId:"session",sessionApplied:true,marketingConversationId:"crm",
          presentation:{messages:[{type:"text",text:{body:"Resposta da loja"}}]},sent:[]}} : {}) };
      const beforeProvider = async (deliver: () => Promise<unknown>) => {
        if (expiresAt === "send-wrapper") owned = false;
        await deliver();
        return true;
      };
      const marketing = {
        enabled: async () => true,
        inbound: async () => {
          if (expiresAt === "inbound") owned = false;
          return {conversationId:"crm",contactId:"contact",human:false,openingRequired:surface === "opening",
            optedOut:surface === "opt-out",originalQuestion:"Vocês vendem meias?",responseKey:"event"};
        },
        opening: async (_merchant:string,_conversation:string,deliver:()=>Promise<unknown>) => beforeProvider(deliver),
        aiReply: async (_merchant:string,_conversation:string,_key:string,_text:string,deliver:()=>Promise<unknown>) => beforeProvider(deliver),
      };
      const provider = async () => {providerCalls++;return {status:"accepted",messageId:"provider-id"};};
      const flow = new HandleMetaConversationUseCase({respondStore:async()=>assert.fail("no generation is due")} as never,
        {update:async()=>{}} as never,{saveResponse:async()=>owned} as never,
        {sendUi:async()=>{providerCalls++;return {status:"sent",messageId:"provider-id"};}} as never,
        undefined,undefined,undefined,undefined,marketing as never,{sendOpening:provider,sendFreeform:provider} as never);
      await assert.rejects(flow.execute({merchantId:"store",provider:"META_CLOUD",deviceId:"META_CLOUD:config",fromNumber:"5511000000001",
        body:"Vocês vendem meias?",timestamp:Date.now(),inboxClaim:claim} as never,
        {whatsappSession:{id:"session",conversationState:state},buyerData:{}} as never),/lease_lost/);
      assert.equal(providerCalls,0,"a stale inbox owner must never invoke any native provider transport");
    });
  }
}
