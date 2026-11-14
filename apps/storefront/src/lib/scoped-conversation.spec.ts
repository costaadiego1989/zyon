import assert from "node:assert/strict";
import test from "node:test";
import { ScopedConversationSession } from "./scoped-conversation.js";

function fixture(hint: string | null = null) {
  const state = { active: true, proof: true, protectedId: null as string | null, readOnly: false,
    creates: 0, saved: [] as string[], retired: "", failCreate: false };
  const factory = new ScopedConversationSession("host", {
    create: async () => {
      state.creates++;
      if (state.failCreate) throw new Error("startup_unavailable");
      return { conversation_id: `conversation-${state.creates}`, merchant_id: "host", experiment: { variant_id: "original", system_prompt: "original prompt" } };
    },
    isCurrent: () => state.active, hasAccess: () => state.proof,
    protectedCart: () => state.protectedId, isReadOnly: () => state.readOnly,
    save: (id) => { state.saved.push(id); }, clear: () => {}, isRetired: (id) => state.retired === id,
  }, hint);
  return { state, factory };
}

test("chat and catalog share a single creation and the original experiment result", async () => {
  const { state, factory } = fixture();
  const [chat, catalog] = await Promise.all([factory.ensure(), factory.ensure()]);
  assert.equal(state.creates, 1); assert.equal(chat, catalog);
  assert.equal((await factory.ensure()).experiment.system_prompt, "original prompt");
  assert.deepEqual(state.saved, ["conversation-1"]);
});

test("saved identity cannot authorize access or silently create a replacement", async () => {
  const { state, factory } = fixture("saved-cart"); state.proof = false;
  await assert.rejects(factory.ensure(), /conversation_access_required/);
  assert.equal(state.creates, 0); assert.equal(factory.id, "saved-cart");
});

test("protected or uncertain cart refuses session replacement and preserves identity", async () => {
  const { state, factory } = fixture("bound-cart");
  state.protectedId = "bound-cart";
  await assert.rejects(factory.restart("bound-cart"), /conversation_recovery_required/);
  state.protectedId = null; state.readOnly = true;
  await assert.rejects(factory.ensure(), /conversation_recovery_required/);
  await assert.rejects(factory.restart("bound-cart"), /conversation_recovery_required/);
  assert.equal(state.creates, 0); assert.equal(factory.id, "bound-cart");
});

test("legacy chat A never displaces protected cart B", async () => {
  const { state, factory } = fixture("cart-b"); state.protectedId = "cart-b";
  assert.equal(factory.adoptHint("chat-a"), false);
  await assert.rejects(factory.ensure("chat-a"), /conversation_cart_mismatch/);
  assert.equal((await factory.ensure()).conversation_id, "cart-b");
  assert.equal(state.creates, 0);
});

test("late creation from an invalidated merchant generation cannot persist or bind", async () => {
  let release!: (value: any) => void;
  let active = true; const saved: string[] = [];
  const factory = new ScopedConversationSession("host", {
    create: () => new Promise((resolve) => { release = resolve; }), isCurrent: () => active,
    hasAccess: () => true, protectedCart: () => null, isReadOnly: () => false,
    save: (id) => { saved.push(id); }, clear: () => {}, isRetired: () => false,
  });
  const pending = factory.ensure(); active = false;
  release({ conversation_id: "old-generation", merchant_id: "host" });
  await assert.rejects(pending, /conversation_context_changed/);
  assert.equal(factory.id, null); assert.deepEqual(saved, []);
});

test("expired empty conversation can restart once and invalidates the old response identity", async () => {
  const { state, factory } = fixture("expired-empty");
  const next = await factory.restart("expired-empty");
  assert.equal(next.conversation_id, "conversation-1"); assert.equal(state.creates, 1);
  assert.equal(factory.current("expired-empty"), false); assert.equal(factory.current(next.conversation_id), true);
  assert.equal(await factory.ensure(), next);
});

test("failed empty-session restart keeps the previous thread addressable", async () => {
  const { state, factory } = fixture("expired-empty"); state.failCreate = true;
  await assert.rejects(factory.restart("expired-empty"), /startup_unavailable/);
  assert.equal(factory.id, "expired-empty"); assert.equal(factory.current("expired-empty"), true);
});

test("retired purchase identity is not re-adopted by old chat history", async () => {
  const { state, factory } = fixture(); state.retired = "completed-cart";
  assert.equal(factory.adoptHint("completed-cart"), false);
  await assert.rejects(factory.ensure("completed-cart"), /conversation_access_required/);
  assert.equal(state.creates, 0);
});
