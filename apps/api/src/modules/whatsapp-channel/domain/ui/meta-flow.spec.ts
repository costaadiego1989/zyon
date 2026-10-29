import test from "node:test";
import assert from "node:assert/strict";
import { metaFieldFlowJson, resolveMetaFieldFlow } from "./meta-flow.js";
import type { WhatsAppConversationState } from "./meta-ui.types.js";

test("an old CPF form cannot collect a full personal identifier through WhatsApp", () => {
  assert.equal(resolveMetaFieldFlow({ ...state, pendingFlow: { ...state.pendingFlow!, field: "cpf" } }, { flow_token: "bound-to-this-buyer", value: "52998224725" }, 1000), undefined);
});

const state: WhatsAppConversationState = { version: 1, stage: "checkout", conversationId: "conversation", checkoutSessionId: "checkout", history: [], revision: "turn", previousViews: [], page: 0,
  pendingFlow: { token: "bound-to-this-buyer", checkoutSessionId: "checkout", field: "email", expiresAt: 2000 } };
test("native forms are bound to buyer session, purpose and expiry and cannot assert verification", () => {
  const reply = { flow_token: "bound-to-this-buyer", value: "buyer@example.com", email_verified: true, merchant_id: "forged" };
  assert.equal(resolveMetaFieldFlow(state, reply, 1000), "buyer@example.com");
  assert.equal(resolveMetaFieldFlow(state, { ...reply, flow_token: "another-buyer" }, 1000), undefined);
  assert.equal(resolveMetaFieldFlow(state, reply, 3000), undefined);
  assert.equal(resolveMetaFieldFlow({ ...state, checkoutSessionId: "another-checkout" }, reply, 1000), undefined);
  assert.equal(resolveMetaFieldFlow({ ...state, stage: "store" }, reply, 1000), undefined);
  assert.equal(resolveMetaFieldFlow(state, { ...reply, value: "invalid" }, 1000), undefined);
});
test("published forms collect a single ordinary checkout field without payment or identity flags", () => {
  const json = JSON.stringify(metaFieldFlowJson(true));
  assert.match(json, /\$\{form.value\}/); assert.match(json, /DETAILS/);
  assert.equal(/email_verified|phone_verified|credit_card|amount_cents/.test(json), false);
});
