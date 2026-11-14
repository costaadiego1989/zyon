import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { buildMetaUiView, presentMetaUi, withMetaCartNavigation, metaWelcomeMessage } from "../../domain/ui/meta-ui-renderer.js";
import { BUYER_HUB_COMMANDS } from "../../domain/ui/buyer-hub.js";
import { HandleMetaConversationUseCase } from "../../application/use-cases/handle-meta-conversation.use-case.js";

const phone = "5521999990000";
const initial: any = { version: 1, conversationId: "owned-cart", stage: "store", history: [], revision: "old", page: 0, previousViews: [] };
const buyer = { globalUserId: "guest", phone, fullName: "Alias WhatsApp" };
function fixture(recognition: any = { status: "unrecognized" }, checkout?: any) {
  const calls: any[] = [], proofs: any[] = [];
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => checkout } as any,
    { execute: async (input: any) => { calls.push(input); return { message: "Resposta normal", blocks: [], suggested_next: [] }; } } as any,
    { executeForMerchant: async () => ({ name: "Athom Technologies", agentName: "Zyon", agentTone: "consultative", storeCategory: "electronics" }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { recognize: async (input: any) => { proofs.push(input); return recognition; } } as any);
  return { adapter, calls, proofs };
}
const recognized = { status: "recognized", buyer: { merchantId: "merchant", conversationId: "owned-cart", globalUserId: "registered",
  customer: { fullName: "Diego Costa", phone, phone_verified: true, email_verified: false } } };
const asText = (message: any) => message.type === "text" ? message.text.body : message.type === "interactive" ? message.interactive.body.text : "";

for (const message of ["Oi", "oi!", "Olá", "bom dia", "Boa tarde!", "boa noite 👋"]) test(`a returning ${message} keeps the known name, history and all main-menu actions`, async () => {
  const f = fixture(recognized);
  const state = { ...initial, history: [{ role: "user", content: "Mouse até 150 reais" }, { role: "assistant", content: "Selecione um produto" }],
    welcomeAnimationShown: true, selectedProductId: "mouse", cartHasItems: true,
    payment: { intentId: "existing", sessionId: "checkout", status: "pending", amount_cents: 300 } };
  const before = structuredClone(state);
  const response = await f.adapter.respondStore({ merchantId: "merchant", buyer, message, state });
  assert.match(response.agentMessage, /Olá, \*Diego\*!/);
  assert.match(response.agentMessage, /Menu principal/);
  assert.doesNotMatch(response.agentMessage, /\/atalhos|Segue um exemplo/);
  assert.equal(f.calls.length, 0, "hello must not invoke the sales model or any commerce tool");
  assert.deepEqual(response.state.history.slice(0, -2), before.history);
  assert.deepEqual(response.state.payment, before.payment);
  assert.equal(response.state.selectedProductId, "mouse");
  assert.equal(response.state.conversationId, before.conversationId);
  assert.deepEqual(state, before);
  const shown = presentMetaUi(withMetaCartNavigation(buildMetaUiView(response), true), "returning");
  assert.equal(shown.totalPages, 1);
  assert.equal(shown.numericSelections.length, BUYER_HUB_COMMANDS.length);
  assert.equal(shown.messages.filter(m => m.type === "interactive").length, 1);
  const control: any = shown.messages.find(m => m.type === "interactive");
  assert.equal(control.interactive.action.button, "Menu principal");
  assert.ok(control.interactive.action.sections[0].rows.length <= 10);
  assert.ok(shown.messages.some(m => /Diego/.test(asText(m))));
});

test("the first greeting uses the verified account name while preserving the approved example and animation ordering", async t => {
  const previous = process.env.API_PUBLIC_URL;
  t.after(() => { if (previous === undefined) delete process.env.API_PUBLIC_URL; else process.env.API_PUBLIC_URL = previous; });
  process.env.API_PUBLIC_URL = "https://api.example.test";
  const f = fixture(recognized);
  const response = await f.adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi", state: initial });
  assert.match(response.agentMessage, /Olá, \*Diego\*!/);
  assert.match(response.agentMessage, /como você pode interagir comigo/);
  assert.doesNotMatch(response.agentMessage, /Alias|\/atalhos/);
  const shown = presentMetaUi(buildMetaUiView(response), "first");
  assert.equal(shown.messages[0].type, "sticker");
  assert.ok(shown.messages.slice(1).some(m => /Diego/.test(asText(m))));
  assert.equal(shown.totalPages, 1);
});

test("a known phone-only buyer can be greeted by their current WhatsApp name without treating it as registration", async () => {
  const f = fixture({ status: "recognized", buyer: { ...recognized.buyer, customer: { phone, phone_verified: true } } });
  const response = await f.adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi", state: initial });
  assert.match(response.agentMessage, /Olá, \*Alias\*!/);
  assert.equal(f.calls.length, 0);
});

test("a phone-only buyer's recognized display name survives messages without a WhatsApp alias", async () => {
  const f = fixture({ status: "recognized", greetingName: "Diego Costa - Athom Technologies",
    buyer: { ...recognized.buyer, customer: { phone, phone_verified: true } } });
  const response = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone }, message: "Oi",
    state: { ...initial, history: [{ role: "user", content: "antes" }] } });
  assert.match(response.agentMessage, /Olá, \*Diego\*!/);
  assert.equal(f.calls.length, 0);
});

for (const mismatch of ["none", "merchant", "phone", "cart", "unverified"]) test(`checkout-name salutation respects the current phone/cart binding: ${mismatch}`, async () => {
  const checkout = { merchantId: mismatch === "merchant" ? "other" : "merchant", cart: { cart_ref: mismatch === "cart" ? "another-cart" : initial.conversationId },
    customer: { fullName: "Juliana Cavalcanti", phone: mismatch === "phone" ? "551188887777" : phone, phone_verified: mismatch !== "unverified", email_verified: false } };
  const f = fixture(undefined, checkout);
  const response = await f.adapter.respondStore({ merchantId: "merchant", buyer: { globalUserId: "guest", phone }, message: "Oi", state: { ...initial, checkoutSessionId: "checkout" } });
  if (mismatch === "none") assert.match(response.agentMessage, /Olá, \*Juliana\*!/);
  else assert.doesNotMatch(response.agentMessage, /Juliana/);
});

for (const name of [undefined, "Cliente WhatsApp", "Usuário", "5521999990000", "name@example.com", "*Desconto*\n0999", "<b>Diego</b>"]) test(`unknown or unsafe name never becomes a salutation: ${name}`, () => {
  const text = metaWelcomeMessage("", "Athom", "Zyon", "consultative", "electronics", { fullName: name, returning: true });
  assert.match(text, /Olá!/);
  assert.doesNotMatch(text, /Olá,/);
});

test("an ordinary model response always retains exactly one executable main-menu entry", () => {
  const response: any = { agentMessage: "Posso ajudar com produtos e entrega.", merchantName: "Athom", quickReplies: [], blocks: [], state: initial };
  const first = withMetaCartNavigation(buildMetaUiView(response), false);
  const second = withMetaCartNavigation(first, false);
  assert.equal(second.choices.filter(c => c.label === "Menu principal").length, 1);
  for (const native of [true, false]) {
    const shown = presentMetaUi(second, "fallback", 0, { native });
    assert.ok(shown.numericSelections.some(a => a.kind === "message" && a.message === "/atalhos"));
    assert.equal(Object.values(shown.selections).filter(a => a.kind === "message" && a.message === "/atalhos").length, 1);
  }
  assert.deepEqual(withMetaCartNavigation({ ...first, stage: "checkout", choices: [] }, true).choices, [], "checkout entry must remain quiet");
});

test("the persisted incoming pipeline greets by name and opens the main menu from its native reply button", async () => {
  const f = fixture(recognized), emitted: any[] = [];
  const state = { ...initial, history: [{ role: "user", content: "antes" }], welcomeAnimationShown: true };
  const route: any = { buyerData: buyer, whatsappSession: { id: "wa", conversationState: state } };
  const claim: any = { id: "hello", merchantId: "merchant", leaseToken: "lease" };
  const input: any = { merchantId: "merchant", provider: "META_CLOUD", deviceId: "META_CLOUD:config", fromNumber: phone,
    body: "Oi", timestamp: Date.now(), inboxClaim: claim };
  const pipeline = new HandleMetaConversationUseCase(f.adapter,
    { update: async (_: string, update: any) => Object.assign(route.whatsappSession, update) } as any,
    { saveResponse: async (_: any, saved: any) => { claim.responseState = structuredClone(saved); return true; } } as any,
    { sendUi: async (request: any) => { emitted.push(request.uiMessage); return { status: "sent", messageId: "sent-" + emitted.length }; } } as any);
  await pipeline.execute(input, route);
  assert.ok(emitted.some(m => /Diego/.test(asText(m))));
  assert.equal(route.whatsappSession.conversationState.numericSelections.length, 9);
  assert.equal(claim.responseState.phase, "complete");
  input.body = "Quero conhecer a loja"; input.inboxClaim = { ...claim, id: "question", responseState: undefined }; claim.responseState = undefined;
  await pipeline.execute(input, route);
  const menuId = Object.entries(route.whatsappSession.conversationState.selections).find(([, a]: any) => a.kind === "message" && a.message === "/atalhos")?.[0];
  assert.ok(menuId);
  input.body = "Menu principal"; input.interactiveId = menuId;
  input.inboxClaim = { ...claim, id: "open-menu", responseState: undefined }; claim.responseState = undefined;
  await pipeline.execute(input, route);
  assert.equal(route.whatsappSession.conversationState.numericSelections.length, 9);
  assert.equal(f.calls.length, 1, "only the store question invokes the model; hello and menu are deterministic");
  assert.equal(route.whatsappSession.conversationState.conversationId, initial.conversationId);
  assert.ok(emitted.some(m => m.type === "interactive" && m.interactive.type === "list" && m.interactive.action.button === "Menu principal"));
});

test("a greeting prefix in a shopping request, an explicit action or pending field is not intercepted", async () => {
  for (const overrides of [{ message: "Oi, quero um mouse" }, { message: "Oi", action: { kind: "tool", tool: "search_products", args: { query: "*" } } },
    { message: "Oi", state: { ...initial, expectsFreeInput: true } }, { message: "Oi", attachmentContext: "image:mouse" }]) {
    const f = fixture();
    const response = await f.adapter.respondStore({ merchantId: "merchant", buyer, message: "Oi", state: { ...initial, history: [{ role: "user", content: "antes" }] }, ...overrides } as any);
    assert.equal(f.calls.length, 1);
    assert.ok(!response.blocks.some(b => b.type === "buyer_hub_actions"));
  }
});
