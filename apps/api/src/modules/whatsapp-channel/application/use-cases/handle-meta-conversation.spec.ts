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

test("the buyer's rich-product route adds the selected variant by both native and typed controls", async () => {
  const f = fixture(); const cart: any[] = []; const engineActions: any[] = [];
  const product = { type: "product_card", data: { id: "serum", name: "Serum", inStock: true, variants: [
    { id: "small", value: "30 ml", stock: 4 }, { id: "large", value: "50 ml", stock: 24 },
  ] } };
  f.conversation.respondStore = async (call: any) => {
    engineActions.push(call.action);
    if (call.action?.tool === "add_item_to_cart") {
      cart.push({ variantId: call.action.args.variantId, quantity: call.action.args.quantity });
      return { agentMessage: "Item adicionado", quickReplies: ["Ver Carrinho"], blocks: [], state: call.state };
    }
    return { agentMessage: "Confira", quickReplies: ["Adicionar ao Carrinho", "Mais Informações"], blocks: [product,
      { type: "product_content", data: { productId: "serum", blocks: [{ type: "button", linkType: "add_to_cart", label: "Adicionar ao carrinho" }] } },
    ], state: { ...call.state, selectedProductId: "serum" } };
  };
  let turnNumber = 0;
  const turn = async (body: string, predicate?: (action: any) => boolean) => {
    f.input.body = body;
    f.input.interactiveId = predicate ? Object.entries(f.route.whatsappSession.conversationState.selections).find(([, action]) => predicate(action))?.[0] : undefined;
    if (predicate) assert.ok(f.input.interactiveId, "the native choice must be reachable");
    f.claim.id = `turn${++turnNumber}`; f.claim.responseState = undefined;
    await f.execute();
  };
  await turn("Detalhes");
  await turn("Adicionar ao carrinho");
  assert.equal(cart.length, 0, "typed add before variant selection cannot mutate the cart");
  await turn("50 ml", action => action.kind === "variant" && action.variantId === "large");
  const adds = f.route.whatsappSession.conversationState.view.choices.filter((choice: any) => /^adicionar.*carrinho$/i.test(choice.label));
  assert.equal(adds.length, 1);
  await turn("Mais Informações");
  assert.equal(engineActions.at(-1).tool, "get_product_details");
  await turn("Adicionar ao carrinho", action => action.kind === "tool" && action.tool === "add_item_to_cart");
  assert.deepEqual(cart, [{ variantId: "large", quantity: 1 }]);
  await turn("Mais Informações");
  await turn("Adicionar ao carrinho");
  assert.deepEqual(cart, [{ variantId: "large", quantity: 1 }, { variantId: "large", quantity: 1 }]);
});

test("back from a quantity editor reloads the actual cart instead of replaying old quantities", async () => {
  const f = fixture(); let action: any;
  f.route.whatsappSession.conversationState.previousViews = [{ title: "Editar quantidade", body: "Quantidade atual: 1", blocks: [], media: [], quickReplies: [],
    choices: [{ label: "Adicionar uma unidade", action: { kind: "tool", tool: "update_cart_item", args: { variantId: "v1", quantity: 2 } } }] }];
  f.conversation.respondStore = async (call: any) => { action = call.action; return { agentMessage: "Carrinho atualizado", quickReplies: [],
    blocks: [{ type: "cart_summary", data: { items: [{ variantId: "v1", productName: "Produto", quantity: 3, subtotal: 30 }], total: 30 } }], state: call.state }; };
  f.input.body = "0";
  await f.execute();
  assert.equal(action.tool, "get_cart");
  assert.ok(f.emitted.some(message => message.type === "text" && message.text.body.includes("3× Produto")));
});
