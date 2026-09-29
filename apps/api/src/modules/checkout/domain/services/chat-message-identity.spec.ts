import test from "node:test";
import assert from "node:assert/strict";
import { BadRequestException } from "@nestjs/common";
import { chatMessageIdentity, chatMessageReference, chatRequestsEnabled } from "./chat-message-identity.js";

const input = { merchant_id: "store", session_id: "session", conversation_id: "conversation",
  user_message: "Minha mensagem", message_id: "message_00000001" };

test("recovery reference rejects malformed identities without consuming text or agent selectors", () => {
  const reference = chatMessageReference({ ...input, user_message: null, agent_id: {} } as any);
  assert.deepEqual(reference, { merchant_id: input.merchant_id, session_id: input.session_id,
    conversation_id: input.conversation_id, message_id: input.message_id });
  assert.ok(Object.isFrozen(reference));
  for (const key of ["merchant_id", "session_id", "conversation_id", "message_id"] as const) {
    for (const value of [undefined, null, {}, "", " ", "x".repeat(201)]) {
      assert.throws(() => chatMessageReference({ ...input, [key]: value } as any), BadRequestException);
    }
  }
});

test("message identity binds tenant, session, conversation, exact text and agent selection", () => {
  const base = chatMessageIdentity(input);
  assert.equal(chatMessageIdentity({ ...input }).requestHash, base.requestHash);
  for (const patch of [{ merchant_id: "other" }, { session_id: "other" }, { conversation_id: "other" },
    { user_message: "Minha mensagem " }, { agent_id: "other" }, { agent_user_id: "other" }]) {
    assert.notEqual(chatMessageIdentity({ ...input, ...patch }).requestHash, base.requestHash);
  }
  assert.ok(Object.isFrozen(base.request));
});
test("malformed message identity is rejected before durable admission", () => {
  for (const message_id of [undefined, null, {}, "short", "x".repeat(129), "invalid key with spaces", "a".repeat(16) + "\n"]) {
    assert.throws(() => chatMessageIdentity({ ...input, message_id } as any), error => {
      assert.ok(error instanceof BadRequestException);
      assert.equal((error.getResponse() as { code: string }).code, "CHAT_MESSAGE_ID_REQUIRED");
      return true;
    });
  }
  for (const patch of [{ user_message: " " }, { user_message: "x".repeat(20_001) }, { conversation_id: "" },
    { agent_id: null }, { agent_user_id: {} }]) assert.throws(() => chatMessageIdentity({ ...input, ...patch } as any));
});
test("message rollout requires both flag and an explicit store allowlist", () => {
  const env = { ...process.env };
  try {
    process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "true";
    process.env.CHECKOUT_CHAT_REQUEST_MERCHANT_IDS = "*, store ,other";
    assert.equal(chatRequestsEnabled("store"), true);
    assert.equal(chatRequestsEnabled("foreign"), false);
    assert.equal(chatRequestsEnabled("*"), false);
    process.env.CHECKOUT_CHAT_REQUESTS_ENABLED = "false";
    assert.equal(chatRequestsEnabled("store"), false);
  } finally { process.env = env; }
});
