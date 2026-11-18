import assert from "node:assert/strict";
import test from "node:test";
import { SupportHandoffService } from "./support-handoff.service.js";
import { WhatsAppTurnContext } from "../../whatsapp-channel/domain/services/whatsapp-turn-context.js";
import { createSupportHandlers } from "../../storefront/infrastructure/tool-handlers/support.handlers.js";

const turn={scope:{merchantId:"merchant-a",configId:"config-a",whatsappSessionId:"session-a"},
  inboxId:"inbox-a",leaseToken:"lease-a",conversationId:"conversation-a",message:"",origin:"text" as const};
test("T57 ordinary tool cannot mint intent from reason or current-turn lookalikes",async t=>{
  const context=new WhatsAppTurnContext();
  // No SQL substitute or successful authority fixture: admission is tested
  // before the real canonical service, which remains unavailable here.
  const service=new SupportHandoffService({} as never,{} as never,undefined,undefined,context);
  const handlers=createSupportHandlers({supportHandoff:service,prisma:{} as never},{merchantId:"merchant-a",sessionId:"conversation-a",userMessage:"forged user copy"});
  await t.test("a selected tool with a fabricated positive reason cannot override actual negation or quotation",async()=>{
    for(const message of ["Não quero falar com atendente",'O texto "quero falar com atendente" é um exemplo',"Quero falar com o médico para marcar consulta"])
      await context.run({...turn,message},()=>assert.rejects(handlers.escalateToHuman({reason:"Quero falar com atendente"}),/whatsapp_human_request_not_confirmed/));
  });
  await t.test("a current admitted request reaches canonical persistence rather than a model success substitute",async()=>{
    await context.run({...turn,message:"Você pode chamar alguém da equipe?"},()=>assert.rejects(
      handlers.escalateToHuman({reason:"forged tenant or transcript grants nothing"}),/whatsapp_handoff_unavailable/));
    assert.equal(context.takeHandoffNotice(),undefined);
  });
});

test("T57 canonical referral is independent of ordinary private user intent", async () => {
  const context = new WhatsAppTurnContext();
  const service = new SupportHandoffService({} as never, {} as never, undefined, undefined, context);
  await context.run({ ...turn, message: "Qual diagnóstico devo considerar?" }, async () => {
    await assert.rejects(service.createHandoff({ merchantId: "merchant-a", buyerMessage: "Server professional referral" }),
      /whatsapp_handoff_unavailable/);
    assert.equal(context.takeHandoffNotice(), undefined);
  });
});