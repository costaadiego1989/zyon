import test from "node:test";
import assert from "node:assert/strict";
import { HandleMetaConversationUseCase } from "./handle-meta-conversation.use-case.js";
import { buildMetaUiView, withMetaCartNavigation } from "../../domain/ui/meta-ui-renderer.js";
import { WhatsAppBuyerHubService } from "../services/whatsapp-buyer-hub.service.js";
import { isMetaReadNavigation } from "../../domain/ui/meta-read-navigation.js";

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

test("back restores the welcome without repeating its original animation or a commerce action", async () => {
  const f = fixture(), state = f.route.whatsappSession.conversationState;
  state.history = [{ role: "user", content: "Oi" }, { role: "assistant", content: "Boas-vindas" }];
  state.welcomeAnimationShown = true;
  state.previousViews = [buildMetaUiView({ agentMessage: "👋 Olá! Como posso ajudar?", merchantName: "Athom", state,
    quickReplies: ["Ver Produtos"], blocks: [{ type: "welcome_animation", data: { url: "https://api.example.test/welcome-v2.mp4" } }] })];
  const history = structuredClone(state.history);
  f.input.body = "Voltar";
  await f.execute();
  assert.equal(f.calls(), 0);
  assert.equal(f.emitted.some(message => message.type === "video"), false);
  assert.ok(f.emitted.some(message => message.type === "text" && message.text.body.includes("Como posso ajudar?")));
  assert.ok(f.emitted.some(message => message.type === "interactive"));
  assert.deepEqual(f.route.whatsappSession.conversationState.history, history);
});

for (const mode of ["current-back", "archived-back"]) test(`HUB-02 cached private hub navigation reloads the current hub without replaying private data: ${mode}`, async () => {
  const f = fixture(), state = f.route.whatsappSession.conversationState;
  const previous = { stage: "checkout", title: "Endereços", body: "PRIVATE_OLD_ADDRESS", choices: [], media: [], quickReplies: [],
    blocks: [{ type: "buyer_hub_actions", data: { choices: [] } }] };
  state.checkoutSessionId = "checkout1"; state.payment = { intentId: "original" };
  state.previousViews = [previous]; state.view = { title: "Produtos", body: "Catálogo", choices: [], media: [], quickReplies: [], blocks: [] };
  if (mode === "archived-back") {
    f.input.interactiveId = "old-back"; state.selections = {};
    f.inbox.findPriorSelection = async () => ({ action: { kind: "back" }, previousView: previous });
  } else f.input.body = "Voltar";
  let request: any;
  f.conversation.respondStore = async (call: any) => { request = call; return { agentMessage: "Atalhos atuais", quickReplies: ["/dados"],
    blocks: [{ type: "buyer_hub_actions", data: { choices: [] } }], state: { ...call.state, buyerHub: undefined } }; };
  await f.execute();
  assert.equal(request.message, "/atalhos"); assert.equal(request.verifiedSender.inboxId, "turn1");
  assert.equal(request.merchantId, "m1"); assert.equal(request.state.payment.intentId, "original");
  assert.ok(f.emitted.some(item => item.type === "text" && item.text.body.includes("Atalhos atuais")));
  assert.ok(!JSON.stringify(f.emitted).includes("PRIVATE_OLD_ADDRESS"));
});

for (const mode of ['native', 'numeric', 'typed', 'legacy-native', 'archived-legacy', 'main-native', 'archived-main']) test(`catalog navigation opens the current main menu without checkout or greeting: ${mode}`, async () => {
  const f = fixture(), state = f.route.whatsappSession.conversationState;
  state.history = [{ role: 'user', content: 'Protetor diario' }];
  state.cartHasItems = true; state.payment = { intentId: 'pending-payment' };
  const catalog = withMetaCartNavigation(buildMetaUiView({ agentMessage: 'Resultado da busca', merchantName: 'Athom', state,
    quickReplies: ['Categorias'], blocks: [{ type: 'product_carousel', data: {
      products: [{ id: 'protetor', name: 'Protetor', price: 9990, image: 'https://example.com/protetor.jpg' }],
    } }] }), true);
  state.view = catalog;
  const main = { kind: 'message', message: '/atalhos' };
  state.selections = { options: mode === 'main-native' ? main : { kind: mode === 'legacy-native' ? 'menu' : 'catalog_options' } };
  state.numericSelections = [{ kind: 'catalog_options' }];
  f.input.body = mode === 'typed' ? 'Outras opções' : mode === 'numeric' ? '1' : 'Menu principal';
  if (['native', 'legacy-native', 'archived-legacy', 'main-native', 'archived-main'].includes(mode)) f.input.interactiveId = 'options';
  if (mode.startsWith('archived-')) {
    state.view = { title: 'Atual', body: 'Current public view', choices: [], media: [], blocks: [], quickReplies: [] };
    state.selections = {};
    f.inbox.findPriorSelection = async () => ({ action: mode === 'archived-main' ? main : { kind: 'menu' }, view: catalog });
  }
  const requests: any[] = [];
  const hub = new WhatsAppBuyerHubService({ recognize: async () => { throw Error('root must not access private identity'); } } as never, {} as never, {} as never);
  f.conversation.respondStore = async (call: any) => {
    requests.push(call);
    const response = await hub.handle(call, 'Athom');
    assert.equal(response?.kind, 'reply');
    return response!.kind === 'reply' ? response!.response : assert.fail();
  };
  await f.execute();
  assert.equal(requests.length, 1); assert.equal(requests[0].message, '/atalhos');
  assert.equal(requests[0].action, undefined); assert.equal(requests[0].verifiedSender.inboxId, 'turn1');
  const next = f.route.whatsappSession.conversationState;
  assert.equal(next.conversationId, 'conv1'); assert.equal(next.payment.intentId, 'pending-payment');
  assert.deepEqual(next.history.slice(0, 1), state.history);
  assert.equal(next.numericSelections.length, 9); assert.equal(next.page, 0);
  assert.ok(!next.numericSelections.some((a: any) => ['back', 'catalog_options', 'page'].includes(a.kind)));
  assert.ok(f.emitted.every(m => m.type !== 'image'));
  assert.ok(f.emitted.some(m => m.type === 'text' && /Menu principal/.test(m.text.body)));
  assert.ok(!f.emitted.some(m => m.type === 'text' && /Olá|Sou Assistente/.test(m.text.body)));
});

test('archived read admission permits only the explicit root command among messages', () => {
  assert.equal(isMetaReadNavigation({ kind: 'message', message: '/atalhos' }), true);
  for (const message of ['Finalizar compra', 'Adicionar ao carrinho', '/enderecos', '/atalhos excluir'])
    assert.equal(isMetaReadNavigation({ kind: 'message', message }), false);
});

test("a partial send retries only the unsent message and never repeats commerce", async () => {
  const f = fixture(); let calls = 0;
  f.sender.sendUi = async (call: any) => { calls++; f.emitted.push(call.uiMessage); return calls === 2 ? { status: "failed", messageId: "" } : { status: "sent", messageId: "wamid." + calls }; };
  await assert.rejects(f.execute(), /whatsapp_send_failed/);
  await f.execute();
  assert.equal(f.calls(), 1); assert.equal(calls, 3);
  assert.equal(f.claim.responseState.phase, "complete");
  assert.equal(f.claim.responseState.sent.length, 2);
});

test("cart actions persist on local content and pagination views", async () => {
  const f = fixture();
  f.route.whatsappSession.conversationState.cartHasItems = true;
  await f.execute();
  assert.deepEqual(f.claim.responseState.state.numericSelections.slice(2, 4).map((a: any) => a.tool), ["get_cart", "checkout"]);
  const next = f.claim.responseState.state;
  next.selections["read-content"] = { kind: "tool", tool: "show_content", args: { text: "Detalhes do produto" } };
  f.route.whatsappSession.conversationState = next;
  f.input.interactiveId = "read-content";
  f.input.inboxClaim = f.claim = { id: "content-turn", merchantId: "m1", leaseToken: "lease" } as any;
  f.inbox.saveResponse = async (claim: any, saved: any) => { claim.responseState = structuredClone(saved); return true; };
  await f.execute();
  assert.deepEqual(f.input.inboxClaim.responseState.state.numericSelections.slice(2, 4).map((a: any) => a.tool), ["get_cart", "checkout"]);
  assert.equal(f.calls(), 1, "reading local product details must not invoke checkout or the agent again");
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
  assert.ok(f.emitted.some(m => m.type === "text" && m.text.body.includes("Esse menu foi atualizado")));
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
  assert.ok(f.emitted.some(message => message.type === "text" && /\*Produto\*[\s\S]*Quantidade: 3/.test(message.text.body)));
});

test("back from the store menu resumes the current checkout instead of replaying its old payment controls", async () => {
  const f = fixture(); let actual: any;
  const state = f.route.whatsappSession.conversationState;
  state.checkoutSessionId = "checkout1";
  state.previousViews = [{ title: "Pagamento", body: "Escolha como pagar", blocks: [{ type: "payment_methods", data: {} }], media: [], quickReplies: [], choices: [] }];
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Pagamento atualizado", quickReplies: [], blocks: [], state: call.state }; };
  f.input.body = "Voltar";
  await f.execute();
  assert.equal(actual?.action.tool, "show_checkout");
  assert.equal(actual.state.stage, "checkout");
  assert.equal(actual.state.checkoutSessionId, "checkout1");
});

test("menu dismisses unfinished checkout input while preserving the cart and pending payment", async () => {
  const f = fixture(); let actual: any;
  const state = f.route.whatsappSession.conversationState;
  Object.assign(state, { stage: "checkout", checkoutSessionId: "checkout1", expectsFreeInput: true,
    pendingCoupon: { sessionId: "checkout1", fingerprint: "current" },
    pendingCheckoutEdit: { section: "payment", fingerprint: "current", intentId: "pix1" },
    pendingFlow: { token: "field-token", field: "zip", checkoutSessionId: "checkout1", expiresAt: Date.now() + 60000 },
    payment: { intentId: "pix1", sessionId: "checkout1", method: "pix", status: "requires_action", amount_cents: 10000 } });
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Menu da loja", quickReplies: ["Ver produtos"], blocks: [], state: { ...call.state, stage: "store" } }; };
  f.input.body = "Menu"; await f.execute();
  assert.equal(actual.message, "Menu"); assert.equal(actual.action, undefined);
  assert.equal(actual.state.pendingCoupon, undefined); assert.equal(actual.state.pendingCheckoutEdit, undefined);
  assert.equal(actual.state.pendingFlow, undefined); assert.equal(actual.state.expectsFreeInput, false);
  assert.equal(actual.state.payment.intentId, "pix1"); assert.equal(actual.state.conversationId, "conv1");
  assert.equal(f.route.whatsappSession.conversationState.stage, "store");
});

test("back resumes a checkout data-entry view through its saved stage even without payment blocks", async () => {
  const f = fixture(); let actual: any;
  const state = f.route.whatsappSession.conversationState;
  state.checkoutSessionId = "checkout1";
  state.previousViews = [{ stage: "checkout", title: "Cadastro", body: "Qual é seu email?", blocks: [], media: [], quickReplies: [], choices: [] }];
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Qual é seu email?", quickReplies: [], blocks: [], state: { ...call.state, expectsFreeInput: true } }; };
  f.input.body = "0"; await f.execute();
  assert.equal(actual.action.tool, "show_checkout"); assert.equal(actual.state.stage, "checkout");
  assert.equal(f.route.whatsappSession.conversationState.expectsFreeInput, true);
});

test("back from checkout restores the store menu stage and its authoritative typed shortcuts", async () => {
  const f = fixture(); const state = f.route.whatsappSession.conversationState;
  state.stage = "checkout"; state.checkoutSessionId = "checkout1";
  state.previousViews = [{ stage: "store", title: "Loja", body: "Como posso ajudar?", blocks: [], media: [], quickReplies: ["Ver produtos"],
    choices: [{ label: "Ver produtos", action: { kind: "tool", tool: "search_products", args: { query: "*" } } }] }];
  f.input.body = "0"; await f.execute();
  assert.equal(f.route.whatsappSession.conversationState.stage, "store"); assert.equal(f.calls(), 0);
  f.claim.id = "return-to-store"; f.claim.responseState = undefined; f.input.body = "Ver produtos"; let actual: any;
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Produtos", quickReplies: [], blocks: [], state: call.state }; };
  await f.execute(); assert.equal(actual.action.tool, "search_products"); assert.equal(actual.state.stage, "store");
});

for (const overlay of ["coupon_entry", "checkout_edit_confirmation"]) test(`back dismisses ${overlay} without applying a coupon or canceling a payment`, async () => {
  const f = fixture(); let actual: any;
  const state = f.route.whatsappSession.conversationState;
  Object.assign(state, { stage: "checkout", checkoutSessionId: "checkout1", expectsFreeInput: overlay === "coupon_entry",
    pendingCoupon: overlay === "coupon_entry" ? { sessionId: "checkout1", fingerprint: "current" } : undefined,
    pendingCheckoutEdit: overlay === "checkout_edit_confirmation" ? { section: "payment", fingerprint: "current", intentId: "pix1" } : undefined,
    payment: { intentId: "pix1", sessionId: "checkout1", method: "pix", status: "requires_action", amount_cents: 10000 },
    selections: { back: { kind: "back" } },
    previousViews: [{ title: "Pagamento", body: "Pagamento atual", blocks: [{ type: "payment_intent", data: {} }], media: [], quickReplies: [], choices: [] }],
  });
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Pedido mantido", quickReplies: [], blocks: [], state: call.state }; };
  f.input.interactiveId = "back";
  await f.execute();
  assert.equal(actual.action.tool, "show_checkout");
  assert.equal(actual.state.pendingCoupon, undefined);
  assert.equal(actual.state.pendingCheckoutEdit, undefined);
  assert.equal(actual.state.expectsFreeInput, false);
  assert.equal(actual.state.payment.intentId, "pix1");
});

test("product menu pagination sends only new controls and does not invoke commerce again", async () => {
  const f = fixture();
  let calls = 0;
  f.conversation.respondStore = async (call: any) => { calls++; return { agentMessage: "Detalhes", merchantName: "Loja", state: call.state,
    quickReplies: Array.from({ length: 8 }, (_, i) => `Pergunta ${i}`), blocks: [{ type: "product_card", data: { id: "p", name: "Protetor", price: 9990,
      image: "https://example.com/protetor.jpg", description: "Descrição publicada", variants: [{ id: "v", stock: 2 }] } }] }; };
  await f.execute();
  const next = Object.entries(f.claim.responseState.state.selections).find(([, a]: any) => a.kind === "page" && a.page === 1);
  assert.ok(next);
  f.input.interactiveId = next[0];
  f.claim.id = "page-turn"; f.claim.responseState = undefined;
  f.emitted.length = 0;
  await f.execute();
  assert.deepEqual(f.emitted.map(m => m.type), ["interactive"]);
  assert.equal(f.claim.responseState.state.page, 1);
  assert.equal(calls, 1);
  assert.ok(f.claim.responseState.state.view.body.includes("Descrição publicada"));
});

test("native pagination persists each configured question and numeric selection invokes the original question", async () => {
  const f = fixture(); const labels = Array.from({ length: 31 }, (_, index) => `Pergunta completa ${index + 1}`); const calls: any[] = [];
  f.conversation.respondStore = async (call: any) => { calls.push(call); return { agentMessage: "Escolha", quickReplies: labels, blocks: [], state: call.state }; };
  const turn = async (body: string, interactiveId?: string) => {
    f.claim.id = `page-turn-${f.emitted.length}`; f.claim.responseState = undefined;
    f.input.body = body; f.input.interactiveId = interactiveId;
    await f.execute();
  };
  await turn("Oi");
  const seen: string[] = [];
  for (let page = 0; page < 20; page++) {
    const state = f.route.whatsappSession.conversationState;
    assert.equal(state.page, page);
    seen.push(...Object.values(state.selections).filter((action: any) => action.kind === "message" && labels.includes(action.message)).map((action: any) => action.message));
    const next = Object.entries(state.selections).find(([, action]: any) => action.kind === "page" && action.page === page + 1);
    if (!next) break;
    await turn("Próxima página", next[0]);
  }
  assert.deepEqual(seen, labels); assert.equal(calls.length, 1);
  const last = f.route.whatsappSession.conversationState;
  const index = last.numericSelections.findIndex((action: any) => action.kind === "message" && labels.includes(action.message));
  assert.ok(index >= 0);
  const original = last.numericSelections[index].message;
  await turn(String(index + 1));
  assert.equal(calls.length, 2); assert.equal(calls[1].message, original);
});

test("an already published shopping button uses the shared read action when leaving checkout data entry", async () => {
  const f = fixture(); let actual: any;
  Object.assign(f.route.whatsappSession.conversationState, { stage: "checkout", expectsFreeInput: true,
    selections: { shopping: { kind: "message", message: "Continuar Comprando" } } });
  f.conversation.respondStore = async (call: any) => { actual = call; return { agentMessage: "Produtos", quickReplies: [], blocks: [], state: { ...call.state, stage: "store" } }; };
  f.input.interactiveId = "shopping"; await f.execute();
  assert.equal(actual.action.tool, "search_products"); assert.deepEqual(actual.action.args, { query: "*" });
});

test('a product in an older owned native menu reloads current details instead of rejecting or replaying the catalog', async () => {
  const f=fixture();await f.execute();
  f.claim.id='turn2';f.claim.responseState=undefined;f.input.interactiveId='zyon:'+ 'a'.repeat(32);
  let action:any;
  f.inbox.findPriorSelection=async(claim:any,sessionId:string,id:string)=>{assert.equal(claim.merchantId,'m1');assert.equal(sessionId,'ws1');assert.equal(id,f.input.interactiveId);return {action:{kind:'tool',tool:'get_product_details',args:{productId:'serum'}}};};
  f.conversation.respondStore=async(call:any)=>{action=call.action;return {agentMessage:'Descrição atual',quickReplies:[],blocks:[{type:'product_card',data:{id:'serum',name:'Sérum',description:'Descrição atual',image:'https://example.com/serum.jpg',price:500,variants:[{id:'v',stock:2}]}}],state:call.state};};
  f.emitted.length=0;await f.execute();
  assert.deepEqual(action,{kind:'tool',tool:'get_product_details',args:{productId:'serum'}});
  assert.ok(!f.emitted.some(m=>m.type==='text'&&m.text.body.includes('Esse menu foi atualizado')));
  assert.equal(f.emitted[0].type,'image');assert.equal(f.emitted[0].media.link,'https://example.com/serum.jpg');
});

test('an old known cart mutation stays rejected and its error never repeats product images', async () => {
  const f=fixture();await f.execute();f.claim.id='turn2';f.claim.responseState=undefined;f.input.interactiveId='zyon:'+'b'.repeat(32);
  f.inbox.findPriorSelection=async()=>({action:{kind:'tool',tool:'add_item_to_cart',args:{variantId:'old',quantity:1}}});
  const state=f.route.whatsappSession.conversationState;
  state.view={title:'Loja',body:'Catálogo',blocks:[{type:'product_carousel',data:{products:[]}}],quickReplies:[],media:[],choices:[{label:'Produto',image:{link:'https://example.com/product.jpg',caption:'Produto'},action:{kind:'tool',tool:'get_product_details',args:{productId:'p'}}}]};
  f.emitted.length=0;await f.execute();assert.equal(f.calls(),1);assert.equal(f.emitted.filter(m=>m.type==='image').length,0);
  assert.ok(f.emitted.some(m=>m.type==='text'&&m.text.body.includes('Esse menu foi atualizado')));
});

test('an earlier catalog page refreshes its original query instead of paging the current product or payment view',async()=>{
  const f=fixture();await f.execute();f.claim.id='turn2';f.claim.responseState=undefined;f.input.interactiveId='zyon:'+'c'.repeat(32);
  f.route.whatsappSession.conversationState.payment={intentId:'current-payment'};
  f.inbox.findPriorSelection=async()=>({action:{kind:'page',page:1},view:{title:'Loja',body:'Busca anterior',choices:[],media:[],quickReplies:[],blocks:[{type:'product_carousel',data:{query:'pele',products:[]}}]}});
  let received:any;
  f.conversation.respondStore=async(call:any)=>{received=call;return {agentMessage:'Resultados atuais',quickReplies:[],blocks:[{type:'product_carousel',data:{query:'pele',products:Array.from({length:6},(_,i)=>({id:'p'+i,name:'Produto '+i,price:500,image:'https://example.com/'+i+'.jpg'}))}}],state:call.state};};
  f.emitted.length=0;await f.execute();assert.equal(received.action.tool,'search_products');assert.equal(received.action.args.query,'pele');
  assert.equal(received.state.payment.intentId,'current-payment');
  assert.equal(f.claim.responseState.state.page,1);
  assert.deepEqual(f.emitted.filter(m=>m.type==='image').map(m=>m.media.link),[3,4,5].map(i=>'https://example.com/'+i+'.jpg'));
});

test("a page from an older product menu displays refreshed product information before its controls", async () => {
  const f = fixture(); await f.execute();
  f.claim.id = "archived-page"; f.claim.responseState = undefined; f.input.interactiveId = "zyon:" + "d".repeat(32);
  f.inbox.findPriorSelection = async () => ({ action: { kind: "page", page: 1 }, view: { title: "Loja", body: "Antigo", choices: [], media: [], quickReplies: [],
    blocks: [{ type: "product_card", data: { id: "p" } }] } });
  let action: any;
  f.conversation.respondStore = async (call: any) => { action = call.action; return { agentMessage: "Informações atuais", state: call.state,
    quickReplies: Array.from({ length: 8 }, (_, i) => `Pergunta ${i}`), blocks: [{ type: "product_card", data: { id: "p", name: "Protetor", price: 9990,
      description: "Descrição atual", image: "https://example.com/current.jpg", variants: [{ id: "v", stock: 2 }] } }] }; };
  f.emitted.length = 0; await f.execute();
  assert.deepEqual(action, { kind: "tool", tool: "get_product_details", args: { productId: "p" } });
  assert.deepEqual(f.emitted.map(m => m.type), ["image", "text", "interactive"]);
  assert.ok(f.emitted[1].text.body.includes("Descrição atual"));
  assert.equal(f.claim.responseState.state.page, 1);
});
