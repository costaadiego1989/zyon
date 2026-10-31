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
  const service = new WhatsAppPostCartOfferService({
    quoteRecommendation: async (scope: any, args: any) => { calls.quote++; assert.deepEqual(scope, { merchantId: "merchant", cartId: "cart" }); assert.deepEqual(args, { variantId: "bruma", promotionId: "rule", quantity: 1 }); if (failQuote) throw Error("rule inactive or stock"); return quote(); },
    acceptRecommendation: async (_scope: any, args: any) => { calls.accept++; assert.deepEqual(args, { expectedQuote: quote() }); if (failAccept) throw Error("stock changed"); return { version: 1, status: "accepted", merchantId: "merchant", cartId: "cart" }; },
    project: async () => { calls.project++; if (failProject) throw Error("read unknown"); return { sessionId: "cart", items: [{ ...quote().cartBasis.items[0] }, { variantId: "bruma", name: "Bruma de Hidratação", quantity: 1, unitPriceCents: 5990 }], total: 24980, discount: 0, freeShipping: false }; },
  } as any);
  const details = async (productId: string) => { calls.details++; assert.equal(productId, "product-bruma"); return { blocks: [{ type: "product_card", data: { id: productId, description: "Descrição publicada da Bruma." } }] as any }; };
  const offer = async () => { const result = await service.decorate("merchant", base()); result.state.view = buildMetaUiView(result); return result; };
  return { calls, service, details, offer, failQuote: () => { failQuote = true; }, failAccept: () => { failAccept = true; }, failProject: () => { failProject = true; } };
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
  const f = fixture(); f.failQuote(); const result = await f.service.decorate("merchant", base());
  assert.equal(result.blocks.some(b => b.type === "post_cart_offer"), false); assert.equal(result.blocks.some(b => b.type === "cart_add_result"), true); assert.equal(f.calls.accept, 0);
});
test("cart reads, back and paging do not manufacture or revive offers", async () => {
  const f = fixture(), input = base(); input.blocks = input.blocks.filter(b => b.type !== "cart_add_result");
  assert.equal(await f.service.decorate("merchant", input), input); assert.equal(f.calls.quote, 0);
});
test("details fetches the canonical product without adding and keeps offer-specific choices", async () => {
  const f = fixture(), shown = await f.offer();
  const result = await f.service.handle({ merchantId: "merchant", state: shown.state, message: "ver detalhes", verifiedOwner: true, details: f.details });
  assert.match(result!.agentMessage, /Descrição publicada/); assert.equal(f.calls.details, 1); assert.equal(f.calls.accept, 0);
  assert.equal(buildMetaUiView(result!).choices.filter(c => c.action.kind === "tool" && c.action.tool.includes("cross_sell_offer")).length, 3);
});
test("conditional or nonvisible assent cannot authorize an add", async () => {
  const f = fixture(), shown = await f.offer();
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim, se tiver desconto", verifiedOwner: true, details: f.details }), undefined);
  shown.state.view = undefined;
  assert.equal(await f.service.handle({ merchantId: "merchant", state: shown.state, message: "sim", verifiedOwner: true, details: f.details }), undefined);
  assert.equal(f.calls.accept, 0);
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
