import test from "node:test";
import assert from "node:assert/strict";
import { buildMetaUiView } from "./meta-ui-renderer.js";
import { commercialNotice } from "../../../storefront/domain/services/commercial-notice.js";
import type { WhatsAppStructuredResponse } from "./meta-ui.types.js";
const response = (commercialNotices?: unknown): WhatsAppStructuredResponse => ({ agentMessage: "Carrinho atualizado.", merchantName: "Loja", quickReplies: [],
  state: { version: 1, conversationId: "conversation", stage: "store", history: [], revision: "turn", page: 0, previousViews: [] },
  blocks: [{ type: "cart_summary", data: { items: [], subtotal: 0, total: 0, commercialNotices } }] as never });
test("WhatsApp includes validated deterministic commercial notices in cart summary", () => {
  const notice = commercialNotice("discount_limit_reached");
  assert.ok(buildMetaUiView(response([notice])).body.includes(notice.message));
});
test("WhatsApp ignores entire malformed or unknown-version notice group and keeps legacy cart", () => {
  const notice = commercialNotice("discount_limit_reached");
  for (const invalid of [[{ ...notice, version: 2 }], [{ ...notice, code: "invented" }], [{ ...notice, privateCost: 999 }], [notice, { ...notice, message: "" }]]) {
    const view = buildMetaUiView(response(invalid));
    assert.ok(view.body.includes("Seu carrinho")); assert.equal(view.body.includes(notice.message), false);
  }
});

