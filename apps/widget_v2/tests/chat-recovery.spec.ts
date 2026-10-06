import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutSession } from "../src/api/checkout-session.js";
import { CheckoutApiError } from "../src/api/checkout-api-error.js";
import { ChatRecoveryRequired, parseChatState } from "../src/api/chat-protocol.js";

const config = { embedToken: "fixture-token", merchantId: "store", apiBaseUrl: "https://fixture.invalid" };
const initial = { session_id: "session", conversation_id: "conversation", chat_protocol: "durable_v2", experience: { items: [], totals: { subtotal: 0, total: 0 } } };
const empty = { protocol: "durable_v2", session_id: "session", conversation_id: "conversation", turns: [] };

for (const [status, code] of [[429, "ai_interaction_rate_limited"], [503, "ai_rate_limit_unavailable"]] as const) {
  test(`AI admission ${status} permits a later send without chat recovery or automatic replay`, async () => fixture(async f => {
    let attempts = 0;
    f.route((url, body) => {
      if (url.endsWith("/start")) return Response.json(initial);
      if (url.includes("/chat/state")) return Response.json(empty);
      assert.ok(url.endsWith("/embed/chat"));
      if (++attempts === 1) return Response.json({ code, retry_after_seconds: 23 }, { status });
      return Response.json({ message: "Confirmed", chat_request: { message_id: body.message_id, status: "completed" } });
    });
    await f.api.start();
    await assert.rejects(f.api.chat("First"), (error: unknown) => error instanceof CheckoutApiError
      && error.status === status && error.code === code && error.retryAfterSeconds === 23);
    assert.equal(f.api.requiresChatRecovery, false);
    assert.equal(f.storage.size, 0);
    assert.equal(attempts, 1);
    assert.equal((await f.api.chat("After waiting")).message, "Confirmed");
    const sent = f.calls.filter(call => call.url.endsWith("/embed/chat"));
    assert.equal(sent.length, 2);
    assert.notEqual(sent[0].body.message_id, sent[1].body.message_id);
    assert.equal(f.calls.some(call => call.url.endsWith("/reconcile")), false);
  }));
}

test("withheld response is an explicit terminal outcome and never an agent reply", () => {
  const parse = (status: string, outcome = "withheld") => parseChatState({ ...empty,
    request: { message_id: "message_00000001", status, response_outcome: outcome } }, "session", "conversation");
  assert.equal(parse("reconciled").request?.response_outcome, "withheld");
  assert.equal(parse("reconciled").turns.length, 0);
  for (const status of ["processing", "unknown", "completed", "rejected"]) assert.equal(parse(status).request?.response_outcome, undefined);
  assert.equal(parse("reconciled", "unrecognized").request?.response_outcome, undefined);
});

test("recovery retains only current navigation and strips financial or stale controls", () => {
  const turn = { id: "saved:agent", role: "agent", text: "Confira o checkout.", occurred_at: "2026-09-28T01:00:00Z",
    display_ref: { turn_id: "turn-navigation", text_hash: "a".repeat(64) }, checkout_stage: "payment",
    blocks: [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix", private: "discard" }] } }] };
  const parse = (patch = {}) => parseChatState({ ...empty, turns: [turn], ...patch }, "session", "conversation");
  assert.deepEqual(parse().turns[0].blocks, [{ type: "payment_methods", data: { methods: [{ key: "pix", label: "Pix" }] } }]);
  assert.equal(parse().turns[0].checkout_stage, "payment");
  assert.equal(parse({ active_request: { message_id: "message_00000001", status: "unknown" } }).turns[0].blocks, undefined);
  assert.equal(parse({ payment_intent_id: "pay_fixture" }).turns[0].blocks, undefined);
  assert.equal(parse({ turns: [turn, { ...turn, id: "later", blocks: undefined }] }).turns[0].blocks, undefined);
  for (const blocks of [[{ type: "pix_payment", data: { qrCode: "forged" } }], [{ type: "form_field", data: { field: "card" } }],
    [{ type: "shipping_options", data: { options: [{}] } }]]) {
    assert.equal(parse({ turns: [{ ...turn, blocks }] }).turns[0].blocks, undefined);
  }
});

test("persisted payment uses a financial GET and never falls back to creating another payment", async () => fixture(async f => {
  const state = { ...empty, payment_intent_id: "pay_fixture" };
  f.route(url => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(state);
    if (url.includes("/chat/payment?")) return Response.json({ id: "pay_fixture", method: "pix", status: "requires_action",
      amountCents: 10000, buyerFacing: { qrCodeCopyPaste: "private-fixture-pix" } });
    throw new Error("unexpected financial mutation");
  });
  await f.api.start(); assert.equal(f.api.requiresChatRecovery, true);
  await assert.rejects(f.api.createPaymentIntent("pix"), ChatRecoveryRequired);
  const restored = await f.api.recoverChat();
  const payment = await f.api.readChatPayment(restored);
  assert.equal(payment?.pix_code, "private-fixture-pix"); assert.equal(payment?.amount_cents, 10000);
  assert.equal(f.api.requiresChatRecovery, false);
  await assert.rejects(f.api.createPaymentIntent("boleto"), ChatRecoveryRequired);
  assert.equal(f.calls.filter(c => c.url.includes("/chat/payment?")).length, 1);
  assert.equal(f.storage.size, 0);
}));

test("failed financial reads keep automatic recovery pending and never expose a different intent", async () => fixture(async f => {
  f.route(url => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json({ ...empty, payment_intent_id: "pay_fixture" });
    return Response.json({ id: "pay_foreign", status: "approved", method: "pix", amountCents: 10000 });
  });
  await f.api.start(); const state = await f.api.recoverChat();
  await assert.rejects(f.api.readChatPayment(state), ChatRecoveryRequired);
  assert.equal(f.api.requiresChatRecovery, true);
  await assert.rejects(f.api.chat("Continuar"), ChatRecoveryRequired);
  await assert.rejects(f.api.createRealtimeVoiceSession(), ChatRecoveryRequired);
  assert.equal(f.calls.some(call => call.url.includes("/payment/intents")), false);
  assert.throws(() => parseChatState({ ...empty, payment_intent_id: "pay_fixture", active_request: {
    message_id: "message_00000001", status: "unknown" } }, "session", "conversation"));
}));

async function fixture(run: (f: { api: CheckoutSession; calls: Array<{ url: string; body: any }>;
  storage: Map<string, string>; route: (fn: (url: string, body: any) => Response | Promise<Response>) => void }) => Promise<void>) {
  const original = globalThis.fetch, storageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "sessionStorage");
  const storage = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key),
  } });
  const calls: Array<{ url: string; body: any }> = [];
  let route = (_url: string, _body: any): Response | Promise<Response> => { throw new Error("UNEXPECTED_FETCH"); };
  globalThis.fetch = async (url, init) => {
    assert.equal(new Headers(init?.headers).get("Authorization"), "Bearer fixture-token");
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url: String(url), body });
    return route(String(url), body);
  };
  try { await run({ api: new CheckoutSession(config), calls, storage, route: fn => { route = fn; } }); }
  finally { globalThis.fetch = original; if (storageDescriptor) Object.defineProperty(globalThis, "sessionStorage", storageDescriptor); else Reflect.deleteProperty(globalThis, "sessionStorage"); }
}

test("lost response preserves only the message reference and recovery never resends chat", async () => fixture(async f => {
  let messageId = "", resolved = false;
  f.route((url, body) => {
    if (url.endsWith("/embed/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(messageId ? { ...empty,
      turns: [{ id: "stored:agent", role: "agent", text: "Resposta confirmada", occurred_at: new Date().toISOString() }],
      request: { message_id: messageId, status: resolved ? "reconciled" : "unknown" },
      ...(!resolved ? { active_request: { message_id: messageId, status: "unknown" } } : {}) } : empty);
    if (url.endsWith("/chat/reconcile")) { assert.equal(body.message_id, messageId); assert.equal(body.user_message, undefined); resolved = true;
      return Response.json({ chat_request: { message_id: messageId, status: "reconciled" } }); }
    messageId = body.message_id; assert.equal(body.conversation_id, "conversation"); throw new Error("CONNECTION_LOST");
  });
  await f.api.start();
  await assert.rejects(f.api.chat("Texto privado do comprador"), ChatRecoveryRequired);
  assert.match(messageId, /^[a-zA-Z0-9_-]{16,128}$/);
  assert.deepEqual([...f.storage.values()], [messageId]);
  await assert.rejects(f.api.chat("Outra mensagem"), ChatRecoveryRequired);
  await assert.rejects(f.api.createRealtimeVoiceSession(), ChatRecoveryRequired);
  const state = await f.api.recoverChat();
  assert.equal(state.turns[0].text, "Resposta confirmada"); assert.equal(f.api.requiresChatRecovery, false);
  assert.equal(f.calls.filter(c => c.url.endsWith("/embed/chat")).length, 1); assert.equal(f.storage.size, 0);
}));

test("a lost refresh after reconciliation retains the reference until confirmed history is read", async () => fixture(async f => {
  let messageId = "", resolved = false, failRefresh = true;
  f.route((url, body) => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) {
      if (resolved && failRefresh) { failRefresh = false; throw new Error("lost refresh"); }
      return Response.json(messageId ? { ...empty, request: { message_id: messageId, status: resolved ? "reconciled" : "unknown" },
        ...(!resolved ? { active_request: { message_id: messageId, status: "unknown" } } : {}) } : empty);
    }
    if (url.endsWith("/reconcile")) { resolved = true; return Response.json({ chat_request: { message_id: messageId, status: "reconciled" } }); }
    messageId = body.message_id; throw new Error("lost chat");
  });
  await f.api.start(); await assert.rejects(f.api.chat("Oi"));
  await assert.rejects(f.api.recoverChat()); assert.equal(f.api.requiresChatRecovery, true);
  await f.api.recoverChat(); assert.equal(f.api.requiresChatRecovery, false);
  assert.equal(f.calls.filter(c => c.url.endsWith("/reconcile")).length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith("/embed/chat")).length, 1);
}));

test("reload restores pending identity and completion is read without reconciliation or replay", async () => fixture(async f => {
  let messageId = "", done = false;
  f.route((url, body) => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(messageId ? { ...empty, request: { message_id: messageId, status: done ? "completed" : "processing" },
      ...(!done ? { active_request: { message_id: messageId, status: "processing" } } : {}) } : empty);
    messageId = body.message_id; throw new Error("lost");
  });
  await f.api.start(); await assert.rejects(f.api.chat("Oi"));
  const restored = new CheckoutSession(config); await restored.start(); assert.equal(restored.requiresChatRecovery, true);
  done = true; await restored.recoverChat(); assert.equal(restored.requiresChatRecovery, false);
  assert.equal(f.calls.filter(c => c.url.endsWith("/embed/chat")).length, 1);
  assert.equal(f.calls.filter(c => c.url.endsWith("/reconcile")).length, 0);
}));

test("unresolved and missing receipts keep new messages blocked", async () => fixture(async f => {
  f.route((url) => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(empty);
    if (url.endsWith("/reconcile")) return Response.json({ code: "chat_message_not_found" }, { status: 404 });
    throw new Error("lost before receipt");
  });
  await f.api.start(); await assert.rejects(f.api.chat("Oi")); await assert.rejects(f.api.recoverChat());
  await assert.rejects(f.api.chat("Outra")); assert.equal(f.api.requiresChatRecovery, true);
  assert.equal(f.calls.filter(c => c.url.endsWith("/embed/chat")).length, 1);
}));

test("concurrent sends are blocked; each confirmed new message receives a distinct key", async () => fixture(async f => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  f.route(async (url, body) => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(empty);
    await gate; return Response.json({ message: "Confirmado", chat_request: { message_id: body.message_id, status: "completed" } });
  });
  await f.api.start(); const first = f.api.chat("Primeira"); await assert.rejects(f.api.chat("Concorrente")); release(); await first;
  await f.api.chat("Segunda"); const sent = f.calls.filter(c => c.url.endsWith("/embed/chat"));
  assert.equal(sent.length, 2); assert.notEqual(sent[0].body.message_id, sent[1].body.message_id);
}));

test("malformed or foreign receipts cannot acknowledge the pending message", async () => fixture(async f => {
  f.route((url) => {
    if (url.endsWith("/start")) return Response.json(initial);
    if (url.includes("/chat/state")) return Response.json(empty);
    return Response.json({ message: "Untrusted", chat_request: { message_id: "different_message_0001", status: "completed" } });
  });
  await f.api.start(); await assert.rejects(f.api.chat("Oi"), ChatRecoveryRequired); assert.equal(f.api.requiresChatRecovery, true);
  for (const patch of [{ session_id: "foreign" }, { conversation_id: "foreign" }, { turns: [{}] }, { active_request: { message_id: "message_00000001", status: "completed" } }]) {
    assert.throws(() => parseChatState({ ...empty, ...patch }, "session", "conversation"));
  }
}));

test("legacy rollout keeps its response contract while supplying a stable per-send key", async () => fixture(async f => {
  f.route((url, body) => {
    if (url.endsWith("/start")) return Response.json({ ...initial, chat_protocol: undefined });
    assert.ok(url.endsWith("/embed/chat")); assert.match(body.message_id, /^[a-zA-Z0-9_-]{16,128}$/);
    return Response.json({ message: "Resposta habitual" });
  });
  await f.api.start(); assert.equal((await f.api.chat("Oi")).message, "Resposta habitual"); assert.equal(f.api.usesDurableChat, false);
  assert.equal(f.calls.length, 2);
}));
