import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { buildMetaUiView } from "../../domain/ui/meta-ui-renderer.js";
import { buildConversationBlocks } from "../../../storefront/infrastructure/agents/conversation-block.builder.js";
import { conversationBlockSchema } from "../../../storefront/domain/contracts/conversation-block.schemas.js";
import { sendStoreMessageOutputSchema } from "../../../storefront/domain/contracts/storefront-conversation.schemas.js";

const oldProductId = "cmvts3gts0008qwrhn6h8f85t";
const reviewedProductId = "cmure4y1u4yqfla01l9llgy9c";
const pending = { id: "pending-review", productId: reviewedProductId, author: "PRIVATE_PENDING_AUTHOR",
  rating: 3, text: "PRIVATE_PENDING_BODY", date: "2026-10-29", status: "pending_moderation" };
const build = (result: unknown) => buildConversationBlocks({ merchantId: "merchant", userMessage: "Nota 3, comentário enviado.",
  finalContent: "Avaliação recebida e aguardando moderação.", toolResults: { create_review: result } });

test("a persisted review produces only a validated pending receipt, without publishing its content", () => {
  const result = build(pending);
  assert.deepEqual(result.blocks, [{ type: "review_submission", data: {
    reviewId: "pending-review", productId: reviewedProductId, status: "pending_moderation" } }]);
  assert.equal(conversationBlockSchema.safeParse(result.blocks[0]).success, true);
  assert.equal(result.blocks.some(block => block.type === "reviews"), false);
  assert.equal(JSON.stringify(result.blocks).includes("PRIVATE_PENDING_"), false);
  assert.equal(conversationBlockSchema.safeParse({ ...result.blocks[0], data: {
    ...result.blocks[0]!.data, text: "PRIVATE_PENDING_BODY" } }).success, false);
});

for (const [name, result] of [
  ["missing persisted ID", { ...pending, id: "" }],
  ["missing product", { ...pending, productId: undefined }],
  ["unexpected published status", { ...pending, status: "published" }],
  ["business rejection", { error: "review_service_unavailable" }],
] as const) {
  test(`${name} cannot create a pending receipt or an invented product reference`, () => {
    assert.equal(build(result).blocks.some(block => block.type === "review_submission"), false);
  });
}

test("review filters follow the submitted product and preserve the buyer, cart, checkout and payment", async () => {
  const prior: any = { version: 1, conversationId: "conversation", stage: "store", history: [
    { role: "user", content: "Quero ver o Kit Essencial." }, { role: "assistant", content: "Confira o kit." }],
    revision: "prior-turn", page: 0, previousViews: [], cartHasItems: true, checkoutSessionId: "same-checkout",
    payment: { intentId: "same-payment", sessionId: "same-checkout", amount_cents: 1415, status: "requires_action" },
    selectedProductId: oldProductId, selectedVariantId: "essential-variant", selectedOptionItemIds: ["essential-option"],
    selectedOptionGroupId: "essential-group", selectedServiceSlotId: "essential-slot" };
  const calls: any[] = [];
  const response = sendStoreMessageOutputSchema.parse({
    message: "Recebemos a avaliação. Sua consulta anterior era sobre o Kit Essencial.", blocks: build(pending).blocks,
    cart_id: "conversation", conversation_id: "conversation", suggested_next: ["Positivas", "Negativas", "Ordenar por Recentes"] });
  const adapter = new CheckoutWhatsAppConversationAdapter({} as never,
    { getSession: async () => undefined } as never,
    { execute: async (input: unknown) => { calls.push(input); return response; } } as never,
    { executeForMerchant: async () => ({ name: "Athom" }) } as never);
  const buyer = { globalUserId: "same-buyer", phone: "5521999990000", fullName: "Comprador" };
  const result = await adapter.respondStore({ merchantId: "merchant", buyer,
    message: "Nota 3, comentário enviado.", state: prior });

  assert.equal(result.state.selectedProductId, reviewedProductId);
  assert.equal(result.state.selectedVariantId, undefined);
  assert.deepEqual(result.state.selectedOptionItemIds, []);
  assert.equal(result.state.selectedOptionGroupId, undefined);
  assert.equal(result.state.selectedServiceSlotId, undefined);
  assert.equal(result.state.conversationId, prior.conversationId);
  assert.equal(result.state.checkoutSessionId, prior.checkoutSessionId);
  assert.deepEqual(result.state.payment, prior.payment);
  assert.equal(result.state.cartHasItems, true);
  assert.equal(result.state.history.length, prior.history.length + 2);
  assert.equal(calls.length, 1, "no extra tool/write or buyer turn is needed to repair the context");
  assert.equal(calls[0].global_user_id, buyer.globalUserId);
  assert.equal(calls[0].cart_id, prior.conversationId);
  assert.equal(prior.selectedProductId, oldProductId);
  const view = buildMetaUiView(result);
  for (const [label, filter] of [["Positivas", "positive"], ["Negativas", "negative"], ["Ordenar por Recentes", "recent"]]) {
    const choices = view.choices.filter(choice => choice.label === label);
    assert.equal(choices.length, 1);
    assert.deepEqual(choices[0]?.action, { kind: "tool", tool: "get_reviews", args: { productId: reviewedProductId, filter } });
  }
  assert.match(view.body, /aguarda a moderação/);
  assert.equal(view.body.includes("PRIVATE_PENDING_"), false);
});
