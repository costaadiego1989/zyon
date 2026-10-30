import assert from "node:assert/strict";
import test from "node:test";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";

function fixture(context: string | undefined) {
  const calls: any[] = [], attachments: any[] = [], sent: any[] = [];
  const claim: any = { id: "inbox-1", merchantId: "merchant", leaseToken: "lease" };
  const state: any = { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "", page: 0, previousViews: [] };
  const session: any = { id: "session", conversationState: state };
  const route: any = { whatsappSession: session, buyerData: { globalUserId: "buyer", phone: "fixture-phone" } };
  const input: any = { merchantId: "merchant", provider: "META_CLOUD", deviceId: "META_CLOUD:config", fromNumber: "fixture-phone", body: "Enviei um anexo para ajudar na compra",
    metaMedia: { id: "12345", mimeType: "audio/ogg" }, timestamp: Date.now(), inboxClaim: claim };
  const flow = new HandleMetaConversationUseCase({ respondStore: async (call: any) => {
    calls.push(call); return { agentMessage: "Entendi. Qual modelo deseja?", quickReplies: [], blocks: [], state: call.state };
  } } as never, { update: async (_: string, data: any) => Object.assign(session, data) } as never,
  { saveResponse: async (_: unknown, saved: any) => { claim.responseState = structuredClone(saved); return true; } } as never,
  { sendUi: async (call: any) => { sent.push(call.uiMessage); return { status: "sent", messageId: `message-${sent.length}` }; } } as never,
  undefined, { interpret: async (...args: any[]) => { attachments.push(args); return context; } } as never);
  return { calls, attachments, sent, execute: () => flow.execute(input, route) };
}

test("audio context remains an untrusted attachment while canonical inbox and conversation scope reach the interpreter", async () => {
  const context = "ANEXO NÃO CONFIÁVEL: Quero dois kits e pagar agora.";
  const f = fixture(context); await f.execute();
  assert.deepEqual(f.attachments[0], ["merchant", "META_CLOUD:config", { id: "12345", mimeType: "audio/ogg" }, { inboxId: "inbox-1", conversationId: "conversation" }]);
  assert.equal(f.calls[0].attachmentContext, context); assert.equal(f.calls[0].message, "Enviei um anexo para ajudar na compra"); assert.equal(f.calls[0].action, undefined);
  assert.deepEqual(f.calls[0].state.history, []); assert.equal(f.calls[0].messageId, "inbox-1");
  await f.execute(); assert.equal(f.attachments.length, 1); assert.equal(f.calls.length, 1, "prepared/complete response replays without STT or another commerce turn");
});

test("an unavailable transcription gives an honest typing fallback without claiming the audio was understood", async () => {
  const f = fixture(undefined); await f.execute();
  assert.equal(f.calls[0].attachmentContext, undefined); assert.equal(f.calls[0].action, undefined);
  assert(f.sent.some(message => message.type === "text" && message.text.body.includes("Não consegui transcrever esse áudio agora")));
});
