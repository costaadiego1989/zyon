import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppPostCartOfferService } from "./whatsapp-post-cart-offer.service.js";
import { buildMetaUiView, presentMetaUi } from "../../domain/ui/meta-ui-renderer.js";
import type { WhatsAppStructuredResponse } from "../../domain/ui/meta-ui.types.js";
import { crossSellStorefrontQuoteSchema } from "../../../cross-sell/domain/contracts/cross-sell-storefront-quote.schemas.js";
import { CheckoutWhatsAppConversationAdapter } from "../../infrastructure/adapters/checkout-whatsapp-conversation.adapter.js";

const quote = () => crossSellStorefrontQuoteSchema.parse({ version: 1, merchantId: "merchant", cartId: "cart", variantId: "bruma", productId: "product-bruma", sku: "BRUMA", promotionId: "rule",
  promotionUpdatedAt: "2026-10-30T00:00:00.000Z", quantity: 1, originalUnitPriceCents: 5990, maximumUnitPriceCents: 5990,
  cartBasis: { items: [{ variantId: "serum-large", productId: "product-serum", sku: "SERUM-LARGE", name: "Sérum", quantity: 1, unitPriceCents: 18990 }], total: 18990, discount: 0, couponCode: null, freeShipping: false },
  quote: { currency: "BRL", originalSubtotalCents: 24980, promotionDiscountCents: 0, subtotalCents: 24980, merchandiseTotalCents: 24980,
    items: [{ variantId: "serum-large", productId: "product-serum", quantity: 1, baseUnitPriceCents: 18990, unitPriceCents: 18990 },
      { variantId: "bruma", productId: "product-bruma", quantity: 1, baseUnitPriceCents: 5990, unitPriceCents: 5990 }] } });
const base = (): WhatsAppStructuredResponse => ({ agentMessage: "Confira o resultado da inclusão no carrinho", quickReplies: [],
  state: { version: 1, conversationId: "cart", stage: "store", history: [{ role: "assistant", content: "Confira o resultado" }], revision: "r", page: 0, previousViews: [] },
  blocks: [{ type: "cart_add_result", data: { cartId: "cart", variantId: "serum-large", status: "succeeded" } },
    { type: "cart_summary", data: { cartId: "cart", items: [{ variantId: "serum-large", productName: "Sérum de Barreira", quantity: 1, price: 189.90, subtotal: 189.90 }], total: 189.90 } },
    { type: "cross_sell", data: { products: [{ id: "bruma", productId: "product-bruma", name: "Bruma de Hidratação", price: 59.90, priceFormatted: "R$ 59,90", inStock: true, recommendationRuleId: "rule" }] } }] as any });
function fixture() {
  const calls = { quote: 0, accept: 0, project: 0, details: 0 }; let failQuote = false, failAccept = false, failProject = false;
  const carts = {
    quoteRecommendation: async (scope: any, args: any) => { calls.quote++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "cart" }); assert.deepEqual(args, { variantId: "bruma", promotionId: "rule", quantity: 1 }); if (failQuote) throw Error("rule inactive or stock"); return quote(); },
    acceptRecommendation: async (_scope: any, args: any) => { calls.accept++; assert.deepEqual(args, { expectedQuote: quote() }); if (failAccept) throw Error("stock changed"); return { version: 1, status: "accepted", merchantId: "merchant", cartId: "cart" }; },
    project: async () => { calls.project++; if (failProject) throw Error("read unknown"); return { sessionId: "cart", items: [{ ...quote().cartBasis.items[0] }, { variantId: "bruma", name: "Bruma de Hidratação", quantity: 1, unitPriceCents: 5990 }], total: 24980, discount: 0, freeShipping: false }; },
  };
  const service = new WhatsAppPostCartOfferService(carts as any);
  const details = async (productId: string) => { calls.details++; assert.equal(productId, "product-bruma"); return { blocks: [{ type: "product_card", data: { id: productId, description: "Descrição publicada da Bruma." } }] as any }; };
  const offer = async () => { const result = await service.decorate("merchant", base()); result.state.view = buildMetaUiView(result); return result; };
  return { calls, carts, service, details, offer, failQuote: () => { failQuote = true; }, failAccept: () => { failAccept = true; }, failProject: () => { failProject = true; } };
}

test("captured 8b27890b generic cross-sell has only product navigation; decoration creates narration and three scoped choices", async () => {
  const generic = buildMetaUiView(base());
  assert.equal(generic.choices.some(c => c.action.kind === "tool" && c.action.tool === "accept_cross_sell_offer"), false);
  const f = fixture(), result = await f.offer(), view = buildMetaUiView(result);
  assert.match(result.agentMessage, /🤖 ✅ \*Sérum de Barreira adicionado/);
  assert.match(result.agentMessage, /✨/); assert.match(result.agentMessage, /Bruma de Hidratação/); assert.match(result.agentMessage, /59,90/);
  assert.equal(result.agentMessage.includes("desconto"), false);
  const choices = view.choices.filter(c => c.action.kind === "tool" && c.action.tool.includes("cross_sell_offer"));
  assert.deepEqual(choices.map(c => c.label), ["Adicionar complemento", "Seguir sem extra", "Ver detalhes"]);
  assert(choices.every(c => c.action.kind === "tool" && Object.keys(c.action.args).join() === "offerId"));
  const native = presentMetaUi(view, "turn").messages.filter(m => m.type === "interactive");
  assert(native.length > 0); assert.equal(f.calls.accept, 0); assert.equal(f.calls.quote, 1);
});
for (const message of ["sim", "sim, pode adicionar", "Quero esse complemento", "pode adicionar!"]) test(`explicit scoped natural acceptance: ${message}`, async () => {
  const f = fixture(), shown = await f.offer();
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message, verifiedOwner: true, details: f.details });
  assert.equal(f.calls.accept, 1); assert.equal(result?.state.postCartOffer?.status, "accepted"); assert.match(result!.agentMessage, /Bruma de Hidratação adicionado/);
  assert.equal(result?.blocks.some(b => b.type === "cart_add_result"), true);
  await f.service.handle({ merchantId: "merchant", state: result!.state, message, action: { kind: "tool", tool: "accept_cross_sell_offer", args: { offerId: shown.state.postCartOffer!.id } }, verifiedOwner: true, details: f.details });
  assert.equal(f.calls.accept, 1);
});
for (const message of ["Sim, pode incluir a bruma", "Adicione essa bruma ao carrinho por favor", "Inclua 1 unidade de bruma", "Adicione essa bruma por favor"])
  test(`published target reference accepts the scoped quote instead of a normal base-price add: ${message}`, async () => {
    const f = fixture(), shown = await f.offer();
    const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message, verifiedOwner: true, details: f.details });
    assert.equal(f.calls.accept, 1); assert.equal(result?.state.postCartOffer?.status, "accepted");
  });
test("unresolved normal-add commands and alternate quantities cannot escape a pending quote; questions remain conversational", async () => {
  const f = fixture(), shown = await f.offer();
  for (const message of ["Adicione duas unidades de bruma ao carrinho", "quero duas", "Adicione outro creme ao carrinho"]) {
    const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message, verifiedOwner: true, details: f.details });
    assert.match(result!.agentMessage, /cotação/); assert.equal(result?.state.postCartOffer?.status, "pending");
  }
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "Quais outros produtos vocês têm para pele seca?", verifiedOwner: true, details: f.details }), undefined);
  assert.equal(f.calls.accept, 0);
});
test("native add of the same target uses the quote, while another product remains an ordinary explicit action", async () => {
  const f = fixture(), shown = await f.offer();
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "Adicionar outro produto", action: { kind: "tool", tool: "add_item_to_cart", args: { variantId: "other", quantity: 1 } }, verifiedOwner: true, details: f.details }), undefined);
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "Adicionar", action: { kind: "tool", tool: "add_item_to_cart", args: { variantId: "bruma", quantity: 1 } }, verifiedOwner: true, details: f.details });
  assert.equal(f.calls.accept, 1); assert.equal(result?.state.postCartOffer?.status, "accepted");
});
for (const args of [{ variantId: "bruma", quantity: 2 }, { variantId: "bruma", quantity: 1, optionItemIds: ["other-option"] }])
  test(`native target cannot escape quote quantity/options: ${JSON.stringify(args)}`, async () => {
    const f = fixture(), shown = await f.offer();
    const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "Adicionar", action: { kind: "tool", tool: "add_item_to_cart", args }, verifiedOwner: true, details: f.details });
    assert.match(result!.agentMessage, /cotação/); assert.equal(f.calls.accept, 0);
  });
test("catalog batch containing the quoted target cannot bypass the offer or partially add unrelated lines", async () => {
  const f = fixture(), shown = await f.offer();
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "Catálogo", action: { kind: "tool", tool: "add_catalog_items", args: { lines: [{ variantId: "other", quantity: 1 }, { variantId: "bruma", quantity: 1 }] } }, verifiedOwner: true, details: f.details });
  assert.match(result!.agentMessage, /cotação/); assert.equal(f.calls.accept, 0);
});
test("native acceptance is scoped to current UUID and has no generic add writer", async () => {
  const f = fixture(), shown = await f.offer();
  await f.service.handle({ merchantId: "merchant", state: shown.state, message: "selected", action: { kind: "tool", tool: "accept_cross_sell_offer", args: { offerId: shown.state.postCartOffer!.id } }, verifiedOwner: true, details: f.details });
  assert.equal(f.calls.accept, 1);
});
test("decline archives actions and suppresses that rule/variant on subsequent adds without any cart write", async () => {
  const f = fixture(), shown = await f.offer(); shown.state.previousViews = [shown.state.view!];
  const declined = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "não, obrigado", verifiedOwner: true, details: f.details });
  assert.equal(declined?.state.postCartOffer?.status, "declined"); assert.equal(f.calls.accept, 0);
  assert.equal(declined!.state.previousViews[0].choices.some(c => c.action.kind === "tool" && c.action.tool.includes("cross_sell_offer")), false);
  const again = await f.service.decorate("merchant", { ...base(), state: declined!.state });
  assert.equal(again.blocks.some(b => b.type === "post_cart_offer"), false); assert.equal(f.calls.quote, 1);
  assert.equal(again.agentMessage.includes("Bruma"), false);
});
for (const mode of ["stale", "foreign-tenant", "foreign-cart", "foreign-offer", "extra-args", "unverified", "outstock-or-rule-off"] as const)
  test(`selection fails closed for ${mode}`, async () => {
    const f = fixture(), shown = await f.offer(); let merchantId = "merchant"; const args: any = { offerId: shown.state.postCartOffer!.id };
    if (mode === "stale") shown.state.postCartOffer!.expiresAt = 0;
    if (mode === "foreign-tenant") merchantId = "other";
    if (mode === "foreign-cart") shown.state.conversationId = "other";
    if (mode === "foreign-offer") args.offerId = "00000000-0000-4000-8000-000000000000";
    if (mode === "extra-args") args.variantId = "other";
    if (mode === "outstock-or-rule-off") f.failAccept();
    const result = await f.service.handle({ merchantId, state: shown.state, message: "sim", action: { kind: "tool", tool: "accept_cross_sell_offer", args }, verifiedOwner: mode !== "unverified", details: f.details });
    assert.equal(result?.blocks.some(b => b.type === "cart_add_result"), false);
    assert.equal(f.calls.accept, mode === "outstock-or-rule-off" ? 1 : 0);
  });
test("quote failure preserves the already successful add and cannot invent an offer", async () => {
  const f = fixture(); f.failQuote(); const input = base(); input.agentMessage = "Aproveite Bruma com desconto por R$9,99";
  input.state.history[0].content = input.agentMessage;
  const result = await f.service.decorate("merchant", input);
  assert.equal(result.blocks.some(b => b.type === "post_cart_offer"), false); assert.equal(result.blocks.some(b => b.type === "cart_add_result"), true); assert.equal(f.calls.accept, 0);
  assert.equal(result.blocks.some(b => b.type === "cross_sell"), false); assert.match(result.agentMessage, /Não consegui confirmar esse complemento/);
  assert.equal(result.agentMessage.includes("9,99"), false); assert.equal(result.agentMessage.includes("desconto"), false);
  assert.equal(result.state.history.at(-1)?.content.includes("9,99"), false);
});
test("cart reads, back and paging do not manufacture or revive offers", async () => {
  const f = fixture(), input = base(); input.blocks = input.blocks.filter(b => b.type !== "cart_add_result");
  assert.equal(await f.service.decorate("merchant", input), input); assert.equal(f.calls.quote, 0);
});
test("missing canonical added line cannot leave an unconfirmed generic offer or price in the copy", async () => {
  const f = fixture(), input = base(); input.blocks = input.blocks.filter(b => b.type !== "cart_summary");
  input.agentMessage = "Bruma com desconto por R$9,99";
  const result = await f.service.decorate("merchant", input);
  assert.equal(f.calls.quote, 0); assert.equal(result.blocks.some(b => b.type === "cross_sell" || b.type === "post_cart_offer"), false);
  assert.equal(result.agentMessage.includes("9,99"), false); assert.match(result.agentMessage, /Item adicionado/);
});
test("details fetches the canonical product without adding and keeps offer-specific choices", async () => {
  const f = fixture(), shown = await f.offer();
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "ver detalhes", verifiedOwner: true, details: f.details });
  assert.match(result!.agentMessage, /Descrição publicada/); assert.equal(f.calls.details, 1); assert.equal(f.calls.accept, 0);
  assert.equal(buildMetaUiView(result!).choices.filter(c => c.action.kind === "tool" && c.action.tool.includes("cross_sell_offer")).length, 3);
});
for (const message of ["Quero ver os detalhes desse complemento antes de decidir.", "Pode me mostrar os detalhes desse complemento?", "Me mostre os detalhes do complemento, por favor."])
  for (const visible of [true, false]) test(`scoped read-only details recover the pending offer without granting acceptance: ${visible} ${message}`, async () => {
    const f = fixture(), shown = await f.offer();
    if (!visible) shown.state.view = undefined;
    const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message, verifiedOwner: true, details: f.details });
    assert.equal(f.calls.details, 1); assert.equal(f.calls.accept, 0); assert.equal(f.calls.project, 0);
    assert.equal(result?.state.postCartOffer?.id, shown.state.postCartOffer?.id);
    assert.equal(result?.state.postCartOffer?.status, "pending");
    assert.match(result!.agentMessage, /59,90/);
    assert.equal(buildMetaUiView(result!).choices.filter(c => c.action.kind === "tool" && c.action.tool.includes("cross_sell_offer")).length, 3);
  });

test("details recovery never turns unrelated, negated or nonvisible assent into an offer operation", async () => {
  const f = fixture(), shown = await f.offer(); shown.state.view = undefined;
  for (const message of ["Não quero ver os detalhes desse complemento", "Quero ver os detalhes de outro produto", "sim", "Adicione esse complemento se tiver desconto", "Quero ver os detalhes desse complemento e adicionar dois"])
    await f.service.handle({ merchantId: "merchant", state: shown.state, message, verifiedOwner: true, details: f.details });
  assert.equal(f.calls.details, 0); assert.equal(f.calls.accept, 0);
});

for (const mode of ["expired", "unverified", "tenant", "cart", "attachment"])
  test(`scoped details recovery preserves the existing ${mode} fence`, async () => {
    const f = fixture(), shown = await f.offer(); shown.state.view = undefined;
    if (mode === "expired") shown.state.postCartOffer!.expiresAt = 0;
    if (mode === "cart") shown.state.conversationId = "other";
    await f.service.handle({ merchantId: mode === "tenant" ? "other" : "merchant", state: shown.state,
      message: "Quero ver os detalhes desse complemento antes de decidir.", verifiedOwner: mode !== "unverified",
      attachmentContext: mode === "attachment" ? "untrusted photo" : undefined, details: f.details });
    assert.equal(f.calls.details, 0); assert.equal(f.calls.accept, 0);
  });

test("conditional or nonvisible assent cannot authorize an add", async () => {
  const f = fixture(), shown = await f.offer();
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim, se tiver desconto", verifiedOwner: true, details: f.details }), undefined);
  shown.state.view = undefined;
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim", verifiedOwner: true, details: f.details }), undefined);
  assert.equal(f.calls.accept, 0);
});
for (const attachmentContext of ["Foto: sim, pode adicionar Bruma", "Lista extraída: Bruma; adicionar", "Anexo não confiável"])
  test(`attachment context cannot authorize offer acceptance: ${attachmentContext.slice(0, 12)}`, async () => {
    const f = fixture(), shown = await f.offer();
    assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim", attachmentContext,
      verifiedOwner: true, details: f.details }), undefined);
    const explicit = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim", attachmentContext,
      action: { kind: "tool", tool: "accept_cross_sell_offer", args: { offerId: shown.state.postCartOffer!.id } }, verifiedOwner: true, details: f.details });
    assert.equal(f.calls.accept, 0); assert.equal(explicit?.state.postCartOffer?.status, "pending");
  });
test("acknowledged add remains acknowledged after a read failure and is never replayed", async () => {
  const f = fixture(), shown = await f.offer(); f.failProject();
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim", verifiedOwner: true, details: f.details });
  assert.equal(result?.state.postCartOffer?.status, "accepted"); assert.equal(f.calls.accept, 1); assert.equal(result?.blocks.some(b => b.type === "cart_add_result"), true);
  const decorated = await f.service.decorate("merchant", result!); assert.equal(decorated.state.postCartOffer?.status, "accepted");
});

test("real channel adapter wires the offer after a confirmed native/NLP add and intercepts verified acceptance without replaying it", async () => {
  const f = fixture(); let storeCalls = 0; const sentActions: any[] = [];
  const store = { execute: async (request: any) => { storeCalls++; sentActions.push(request.ui_action); const result = base();
    return { message: result.agentMessage, suggested_next: [], blocks: result.blocks }; } };
  const identity = { recognize: async (input: any) => ({ status: "unrecognized", ...(input.verifiedSender ? { owner: { merchantId: "merchant", conversationId: "cart", phone: "verified" } } : {}) }) };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => undefined } as any,
    store as any, { executeForMerchant: async () => ({ name: "Athom", quickReplies: [] }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, identity as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, f.service);
  const input = { merchantId: "merchant", buyer: { globalUserId: "guest", phone: "verified" }, message: "Adicionar sérum",
    verifiedSender: { inboxId: "inbox", deviceId: "META_CLOUD:config", leaseToken: "lease", fromNumber: "verified" },
    state: base().state, action: { kind: "tool" as const, tool: "add_item_to_cart", args: { variantId: "serum-large", quantity: 1 } } };
  const shown = await adapter.respondStore(input); shown.state.view = buildMetaUiView(shown);
  assert.equal(shown.blocks.some(b => b.type === "post_cart_offer"), true); assert.equal(storeCalls, 1);
  const accepted = await adapter.respondStore({ ...input, message: "sim", action: undefined, state: shown.state });
  assert.equal(accepted.state.postCartOffer?.status, "accepted"); assert.equal(f.calls.accept, 1); assert.equal(storeCalls, 1);
  await adapter.respondStore({ ...input, message: "Selecionado", state: accepted.state,
    action: { kind: "tool", tool: "accept_cross_sell_offer", args: { offerId: shown.state.postCartOffer!.id } } });
  assert.equal(f.calls.accept, 1); assert.equal(storeCalls, 1);
  assert.deepEqual(sentActions, [{ tool: "add_item_to_cart", args: { variantId: "serum-large", quantity: 1 } }]);
});

test("positive offer preserves the real quoted base/price and uses the existing discount acceptance authority", async () => {
  const input = base(); delete (input.blocks[2].data as any).products[0].recommendationRuleId;
  (input.blocks[2].data as any).products[0].promoId = "rule";
  const positive = quote(); positive.maximumUnitPriceCents = 5391;
  positive.quote.items[1].unitPriceCents = 5391; positive.quote.promotionDiscountCents = 599;
  positive.quote.subtotalCents = positive.quote.merchandiseTotalCents = 24381;
  assert(crossSellStorefrontQuoteSchema.safeParse(positive).success);
  let quoteCalls = 0, acceptCalls = 0;
  const service = new WhatsAppPostCartOfferService({ quote: async () => { quoteCalls++; return positive; }, accept: async (_scope: any, args: any) => {
    acceptCalls++; assert.deepEqual(args.expectedQuote, positive); return { version: 1, status: "accepted", merchantId: "merchant", cartId: "cart" };
  }, quoteRecommendation: async () => { throw Error("wrong zero authority"); }, acceptRecommendation: async () => { throw Error("wrong zero writer"); },
    project: async () => { throw Error("read unavailable"); } } as any);
  const shown = await service.decorate("merchant", input); shown.state.view = buildMetaUiView(shown);
  assert.equal(shown.state.postCartOffer?.kind, "discount"); assert.match(shown.agentMessage, /De R\$.*59,90 por \*R\$.*53,91/);
  assert.equal(quoteCalls, 1); assert.equal(acceptCalls, 0);
  const accepted = await service.handle({ merchantId: "merchant", state: shown.state, message: "sim", verifiedOwner: true, details: async () => ({ blocks: [] }) });
  assert.equal(acceptCalls, 1); assert.equal(accepted?.state.postCartOffer?.status, "accepted"); assert.match(accepted!.agentMessage, /53,91/);
});

test("accepting a recommendation re-evaluates applicable post-cart rules for that newly added item without a second writer", async () => {
  const f = fixture(); let hookCalls = 0, storeCalls = 0;
  const follow = quote(); follow.cartBasis.items.push({ variantId: "bruma", productId: "product-bruma", sku: "BRUMA", name: "Bruma de Hidratação", quantity: 1, unitPriceCents: 5990 });
  follow.cartBasis.total = 24980; follow.variantId = "creme"; follow.productId = "product-creme"; follow.sku = "CREME";
  follow.originalUnitPriceCents = follow.maximumUnitPriceCents = 1000;
  follow.quote.items.push({ variantId: "creme", productId: "product-creme", quantity: 1, baseUnitPriceCents: 1000, unitPriceCents: 1000 });
  follow.quote.originalSubtotalCents = follow.quote.subtotalCents = follow.quote.merchandiseTotalCents = 25980;
  assert(crossSellStorefrontQuoteSchema.safeParse(follow).success);
  const initialReader = f.carts.quoteRecommendation;
  f.carts.quoteRecommendation = async (scope: any, request: any) => request.variantId === "creme" ? follow : initialReader(scope, request);
  const conversation = { postCartSuggestions: async (scope: any) => { hookCalls++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "cart", addedVariantId: "bruma" });
    return { type: "cross_sell", data: { products: [{ id: "creme", productId: "product-creme", name: "Creme complementar", inStock: true, recommendationRuleId: "rule" }] } }; } };
  const adapter = new CheckoutWhatsAppConversationAdapter({} as any, { getSession: async () => undefined } as any,
    { execute: async () => { storeCalls++; const response = base(); return { message: response.agentMessage, suggested_next: [], blocks: response.blocks }; } } as any,
    { executeForMerchant: async () => ({ name: "Athom", quickReplies: [] }) } as any,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    { recognize: async () => ({ status: "unrecognized", owner: { merchantId: "merchant", conversationId: "cart", phone: "verified" } }) } as any,
    undefined, undefined, undefined, undefined, undefined, conversation as any, undefined, f.service);
  const input = { merchantId: "merchant", buyer: { globalUserId: "guest", phone: "verified" }, message: "Adicionar sérum", state: base().state,
    verifiedSender: { inboxId: "inbox", deviceId: "META_CLOUD:config", leaseToken: "lease", fromNumber: "verified" } };
  const shown = await adapter.respondStore(input); shown.state.view = buildMetaUiView(shown);
  const accepted = await adapter.respondStore({ ...input, message: "sim", state: shown.state });
  assert.equal(f.calls.accept, 1); assert.equal(storeCalls, 1); assert.equal(hookCalls, 1);
  assert.equal(accepted.state.postCartOffer?.variantId, "creme"); assert.equal(accepted.state.postCartOffer?.status, "pending");
  assert.notEqual(accepted.state.postCartOffer?.id, shown.state.postCartOffer?.id);
  assert.equal(accepted.blocks.some(b => b.type === "post_cart_offer" && (b.data as any).offerId === accepted.state.postCartOffer?.id), true);
  assert.equal(accepted.blocks.some(b => b.type === "cross_sell"), false);
  assert.match(accepted.agentMessage, /Bruma de Hidratação adicionado/); assert.match(accepted.agentMessage, /Creme complementar/);
  accepted.state.view = buildMetaUiView(accepted);
  await adapter.respondStore({ ...input, message: "seguir sem extra", state: accepted.state });
  assert.equal(f.calls.accept, 1); assert.equal(hookCalls, 1); assert.equal(storeCalls, 1);
});
