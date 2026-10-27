import test from "node:test";
import assert from "node:assert/strict";
import { commercialNotice } from "../../domain/services/commercial-notice.js";
import { storefrontToolOutputSchemas, validateStorefrontToolOutput } from "../../domain/contracts/storefront-tool-output.schemas.js";
import { conversationBlockSchema } from "../../domain/contracts/conversation-block.schemas.js";
import { buildConversationBlocks } from "./conversation-block.builder.js";
const notice = () => commercialNotice("discount_limit_reached");
const cart = () => ({ cartId: "cart", items: [{ variantId: "variant", name: "Produto", quantity: 1, unitPrice: 100, lineTotal: 100 }], total: 100, itemCount: 1 });
test("cart tools and rejected coupon retain strict optional notices while legacy payloads remain valid", () => {
  for (const tool of ["get_cart","add_item_to_cart","update_cart_item","remove_cart_item","clear_cart"] as const) {
    assert.deepEqual(storefrontToolOutputSchemas[tool].parse({ ...cart(), commercialNotices: [notice()] }).commercialNotices, [notice()]);
    assert.equal(storefrontToolOutputSchemas[tool].safeParse(cart()).success, true);
    assert.equal(storefrontToolOutputSchemas[tool].safeParse({ ...cart(), commercialNotices: [{ ...notice(), privateCost: 1 }] }).success, false);
  }
  assert.deepEqual(storefrontToolOutputSchemas.apply_coupon.parse({ applied: false, reason: "limit", commercialNotices: [notice()] }),
    { applied: false, reason: "limit", commercialNotices: [notice()] });
});
test("builder retains validated notices on cart and deterministic coupon rejection overrides generated copy", () => {
  const out = buildConversationBlocks({ merchantId: "merchant", userMessage: "Cupom", finalContent: "Cupom aplicado pelo modelo!",
    toolResults: { get_cart: cart(), apply_coupon: { applied: false, reason: "limit", commercialNotices: [notice()] } } });
  const block = out.blocks.find(value => value.type === "cart_summary");
  assert.ok(block && block.type === "cart_summary");
  assert.deepEqual(block.data.commercialNotices, [notice()]); assert.equal(conversationBlockSchema.safeParse(block).success, true);
  assert.equal(out.finalContent, notice().message);
});
test("cart block rejects unrecognized notice versions instead of interpreting their message", () => {
  const block = { type: "cart_summary", data: { cartId: "cart", items: [], itemCount: 0, subtotal: 0, total: 0,
    commercialNotices: [{ ...notice(), version: 2 }] } };
  assert.equal(conversationBlockSchema.safeParse(block).success, false);
});

test("negative cart outcomes preserve strict notices without converting rejection into success", () => {
  const payload = { error: "cross_sell_quote_review_required", detail: "Uma nova cotação é necessária.",
    commercialNotices: [commercialNotice("benefit_conditions_not_met")] };
  const parsed = validateStorefrontToolOutput("add_item_to_cart", payload);
  assert.deepEqual(parsed, { ok: true, data: payload });
  for (const commercialNotices of [[{ ...notice(), version: 2 }], [{ ...notice(), privateCost: 1 }]]) {
    const invalid = validateStorefrontToolOutput("add_item_to_cart", { ...payload, commercialNotices });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.code, "invalid_tool_output");
  }
});

