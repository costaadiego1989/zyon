import test from "node:test";
import assert from "node:assert/strict";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";

function fixture() {
  let engineCalls = 0; const emitted: any[] = [];
  const claim: any = { id: "turn1", merchantId: "m1", leaseToken: "lease" };
  const state: any = { version: 1, conversationId: "conv1", stage: "store", history: [], revision: "", page: 0, previousViews: [] };
  const session: any = { id: "ws1", conversationState: state };
  const route: any = { whatsappSession: session, buyerData: { globalUserId: "buyer1", phone: "5521999990000" } };
  const input: any = { merchantId: "m1", provider: "META_CLOUD", deviceId: "META_CLOUD:c1", fromNumber: "5521999990000", body: "Oi", timestamp: Date.now(), inboxClaim: claim };
  const conversation: any = { respondStore: async (call: any) => { engineCalls++; return { agentMessage: "Olá", quickReplies: ["Ver Produtos", "Suporte"], blocks: [], state: { ...call.state, history: [{ role: "assistant", content: "Olá" }] } }; } };
  const sessions: any = { update: async (_: string, update: any) => { Object.assign(session, update); } };
  const inbox: any = { saveResponse: async (_: any, saved: any) => { claim.responseState = structuredClone(saved); return true; } };
  const sender: any = { sendUi: async (call: any) => { emitted.push(call.uiMessage); return { status: "sent", messageId: "wamid." + emitted.length }; } };
  return { claim, route, input, conversation, sessions, inbox, sender, emitted, calls: () => engineCalls, execute: () => new HandleMetaConversationUseCase(conversation, sessions, inbox, sender).execute(input, route) };
}

test("a partial send retries only the unsent message and never repeats commerce", async () => {
  const f = fixture(); let calls = 0;
  f.sender.sendUi = async (call: any) => { calls++; f.emitted.push(call.uiMessage); return calls === 2 ? { status: "failed", messageId: "" } : { status: "sent", messageId: "wamid." + calls }; };
  await assert.rejects(f.execute(), /whatsapp_send_failed/);
  await f.execute();
  assert.equal(f.calls(), 1); assert.equal(calls, 3);
  assert.equal(f.claim.responseState.phase, "complete");
  assert.equal(f.claim.responseState.sent.length, 2);
});

test("an unknown send result is not blindly sent again", async () => {
  const f = fixture(); let calls = 0;
  f.sender.sendUi = async () => { calls++; return { status: "unknown", messageId: "" }; };
  await assert.rejects(f.execute(), /whatsapp_send_result_unknown/);
  await assert.rejects(f.execute(), /whatsapp_turn_result_unknown/);
  assert.equal(calls, 1); assert.equal(f.calls(), 1);
});

test("a selection from a stale menu cannot authorize a new action", async () => {
  const f = fixture(); await f.execute();
  f.claim.id = "turn2"; f.claim.responseState = undefined; f.input.interactiveId = "zyon:stale";
  await f.execute(); assert.equal(f.calls(), 1);
  assert.ok(f.emitted.some(m => m.type === "text" && m.text.body.includes("Não consegui validar")));
});

test("a numeric answer during data entry remains free text", async () => {
  const f = fixture(); f.route.whatsappSession.conversationState.expectsFreeInput = true;
  f.route.whatsappSession.conversationState.numericSelections = [{ kind: "message", message: "Ação incorreta" }];
  f.input.body = "1"; let actual: any;
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Recebido", quickReplies: [], blocks: [], state: call.state }; };
  await f.execute(); assert.equal(actual.message, "1"); assert.equal(actual.action, undefined);
});

test("definite media rejection keeps the menu reachable and persists the fallback before sending", async () => {
  const f = fixture();
  f.conversation.respondStore = async (call: any) => ({ agentMessage: "Produto disponível", quickReplies: ["Comprar"],
    blocks: [{ type: "product_content", data: { content: [{ type: "image", data: { src: "https://example.com/image.jpg", alt: "Foto" } }] } }], state: call.state });
  // Exercise dispatch using the same persisted presentation used after restart.
  f.claim.responseState = { phase: "prepared", sessionApplied: true, state: f.route.whatsappSession.conversationState, sessionId: "ws1", sent: [],
    presentation: { messages: [{ type: "image", media: { link: "https://example.com/image.jpg", caption: "Foto do produto" } }, { type: "text", text: { body: "Menu de compra" } }], selections: {}, numericSelections: [], page: 0, totalPages: 1 } };
  f.sender.sendUi = async (call: any) => {
    f.emitted.push(call.uiMessage);
    if (call.uiMessage.type === "image") return { status: "failed", messageId: "" };
    if (call.uiMessage.text.body.includes("Não consegui exibir")) assert.equal(f.claim.responseState.presentation.messages[0].type, "text");
    return { status: "sent", messageId: "wamid." + f.emitted.length };
  };
  await f.execute();
  assert.equal(f.calls(), 0); assert.equal(f.emitted.length, 3);
  assert.equal(f.claim.responseState.phase, "complete");
  assert.equal(f.claim.responseState.sent.length, 2);
  assert.equal(f.emitted.at(-1).text.body, "Menu de compra");
});
