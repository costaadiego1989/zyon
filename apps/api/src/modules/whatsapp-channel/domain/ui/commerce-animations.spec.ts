import test from "node:test";
import assert from "node:assert/strict";
import { presentationAssetUrl, withCartAnimations } from "./commerce-animations.js";
import { buildMetaUiView, presentMetaUi } from "./meta-ui-renderer.js";
import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";

const response = (blocks: any[], state: Record<string, unknown> = {}): WhatsAppStructuredResponse => ({
  agentMessage: "Confira o carrinho.", quickReplies: ["Ver Produtos"], blocks,
  state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [], ...state },
});
const origin = "https://api.example.test/v1?ignored=true";

test("each confirmed addition presents confirmation before decoration and the recommendation controls without changing the canonical result", () => {
  const original = response([{ type: "cart_add_result", data: { cartId: "cart", variantId: "variant", status: "succeeded" } }, { type: "cross_sell", data: { products: [{ id: "socks", name: "Meia", price: 2000, image: "https://cdn.example.test/socks.jpg" }] } }]);
  const before = structuredClone(original);
  const decorated = withCartAnimations(original, origin);
  assert.deepEqual(original, before);
  assert.equal(decorated.blocks[0].type, "commerce_animation");
  assert.equal((decorated.blocks[0].data as any).kind, "cart_added");
  assert.deepEqual(decorated.blocks.slice(1), before.blocks);
  const shown = presentMetaUi(buildMetaUiView(decorated), "addition");
  const video = shown.messages.findIndex(message => message.type === "sticker" && message.media.link.endsWith("cart-added-v1.webp"));
  assert(video > 0);
  assert(shown.messages.slice(0, video).some(message => message.type === "text" && message.text.body.includes("Item adicionado ao carrinho")));
  assert(shown.messages.slice(video + 1).some(message => message.type === "interactive"));
  assert(shown.numericSelections.some(action => action.kind === "tool" && action.tool === "get_product_details" && action.args.productId === "socks"));
  assert.equal(withCartAnimations({ ...original, state: decorated.state }, origin).blocks[0].type, "commerce_animation", "a later successful addition gets its own confirmation");
});

for (const status of ["unknown", "rejected"]) test(`a ${status} add does not show a success animation`, () => {
  const decorated = withCartAnimations(response([{ type: "cart_add_result", data: { status } }]), origin);
  assert.equal(decorated.blocks.some(block => block.type === "commerce_animation"), false);
});

test("empty cart feedback appears once per empty period and re-arms after a real addition", () => {
  const empty = response([{ type: "cart_summary", data: { items: [], total: 0 } }]);
  const first = withCartAnimations(empty, origin);
  assert.equal((first.blocks[0].data as any).kind, "cart_empty");
  assert.equal(first.state.cartEmptyAnimationShown, true);
  const repeated = withCartAnimations({ ...empty, state: first.state }, origin);
  assert.equal(repeated.blocks.some(block => block.type === "commerce_animation"), false);
  const added = withCartAnimations(response([{ type: "cart_add_result", data: { status: "succeeded" } }], first.state), origin);
  assert.equal(added.state.cartEmptyAnimationShown, false);
  assert.equal(withCartAnimations({ ...empty, state: added.state }, origin).blocks[0].type, "commerce_animation");
});

test("an absent or malformed cart is not reported as empty", () => {
  for (const blocks of [[], [{ type: "cart_summary", data: {} }], [{ type: "cart_summary", data: { items: [{ id: "p" }] } }]])
    assert.equal(withCartAnimations(response(blocks), origin).blocks.some(block => block.type === "commerce_animation"), false);
});

test("invalid public media origin keeps truthful text and leaves the empty animation available for retry", () => {
  for (const configured of ["", "http://api.example.test", "https://user:secret@example.test", "file:///private"]) {
    assert.equal(presentationAssetUrl("cart-empty-v1.mp4", configured), undefined);
    const original = response([{ type: "cart_summary", data: { items: [] } }]);
    const decorated = withCartAnimations(original, configured);
    assert.deepEqual(decorated.blocks, original.blocks);
    assert.equal(decorated.state.cartEmptyAnimationShown, undefined);
  }
  assert.equal(presentationAssetUrl("cart-empty-v1.mp4", origin), "https://api.example.test/whatsapp/presentation/cart-empty-v1.mp4");
});

test("menu pagination and navigation do not replay confirmation media", () => {
  const view = buildMetaUiView(withCartAnimations(response([{ type: "cart_add_result", data: { status: "succeeded" } }]), origin));
  for (const options of [{ navigationOnly: true }, { includeMedia: false }])
    assert.equal(presentMetaUi(view, "navigation", 0, options).messages.some(message => message.type === "video" || message.type === "sticker"), false);
});
