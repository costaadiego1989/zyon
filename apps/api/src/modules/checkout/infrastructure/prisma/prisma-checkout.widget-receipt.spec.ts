import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";
import { PrismaCheckoutRepository } from "./prisma-checkout.repository.js";
import { toCheckoutSession } from "./checkout-session.mapper.js";
import { assertNoUnprojectedWidgetReceipt } from "../../domain/services/checkout-widget-receipt-boundary.js";

const KEY = "_widgetCrossSellAcceptance", CANARY = "PRIVATE_WIDGET_RECEIPT_CANARY";
const values = [undefined, null, { eventId: CANARY }, { version: 1, origin: "widget_checkout", quote: CANARY }];
function fixture(privateValue?: unknown, present = false) {
  const session = checkoutSession({ persistenceVersion: 7 });
  const stored = { ...session, id: "synthetic_checkout", version: 7,
    cart: { ...session.cart, ...(present ? { [KEY]: privateValue } : {}) },
    customer: session.customer ?? null, shipping: session.shipping ?? null,
    createdAt: new Date(session.createdAt), updatedAt: new Date(session.updatedAt) };
  const effects: string[] = [];
  let reads = 0;
  const effect = (name: string) => async () => { effects.push(name); throw new Error("unexpected_" + name); };
  const tx = {
    $queryRaw: async () => [], $executeRaw: async () => 1,
    checkoutSession: { findUnique: async () => { reads++; return structuredClone(stored); },
      create: effect("create"), update: effect("update"), updateMany: effect("updateMany"), upsert: effect("upsert") },
    merchantRule: { upsert: effect("rules") },
    strategyAssignment: { findUnique: async () => null },
    strategyIncentiveAssignment: { findUnique: async () => null },
    checkoutChatRequest: { findFirst: async () => null },
    paymentIntent: { findFirst: async () => null },
    completedOrder: { findFirst: async () => null },
    checkoutEvent: { findFirst: async () => null, create: effect("event") },
    couponRedemption: { updateMany: effect("cancel_coupon") },
  };
  const client = { ...tx, $transaction: async <T>(work: (value: typeof tx) => Promise<T>) => work(tx) };
  return { session, stored, effects, reads: () => reads,
    repo: new PrismaCheckoutRepository(client as unknown as PrismaClient) };
}
async function review(work: () => unknown) {
  await assert.rejects(async () => work(), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.equal(error.message, "cross_sell_quote_review_required");
    assert.equal("cause" in error, false);
    assert.equal(String(error.stack).includes(CANARY), false);
    return true;
  });
}

const inputOperations = ["save", "create", "cas-next", "cas-expected", "mutation-next", "mutation-expected", "benefits-next", "benefits-expected"] as const;
for (const op of inputOperations) for (const [index, value] of values.entries()) {
  test(`widget receipt input presence refused before any read/write: ${op}/${index}`, async () => {
    const f = fixture(), injected = { ...f.session, cart: { ...f.session.cart, [KEY]: value } };
    await review(() => op === "save" ? f.repo.saveSession(injected)
      : op === "create" ? f.repo.createSessionIfAbsent(injected)
      : op.startsWith("cas") ? f.repo.saveSessionIfUnchanged(op === "cas-next" ? injected : f.session, op === "cas-expected" ? injected : f.session)
      : op.startsWith("mutation") ? f.repo.commitCommercialMutation({ expected: op === "mutation-expected" ? injected : f.session, next: op === "mutation-next" ? injected : f.session })
      : f.repo.saveBenefitsIfMutable(op === "benefits-next" ? injected : f.session, op === "benefits-expected" ? injected : f.session, merchantRules()));
    assert.equal(f.reads(), 0); assert.deepEqual(f.effects, []);
  });
}

for (const [index, value] of values.entries()) {
  test(`mapper refuses private receipt instead of exposing base price: ${index}`, async () => {
    const f = fixture(value, true), original = structuredClone(f.stored);
    await review(() => toCheckoutSession(f.stored));
    assert.deepEqual(f.stored, original);
  });
  test(`chat expected-session receipt refused before snapshot/read: ${index}`, async () => {
    const f = fixture(), s = f.session;
    const injected = { ...s, cart: { ...s.cart, [KEY]: value } };
    await review(() => f.repo.appendChatExchange({ merchantId: s.merchantId, sessionId: s.sessionId,
      buyer: { role: "buyer", text: "Synthetic", occurredAt: s.updatedAt },
      agent: { role: "agent", text: "Synthetic", occurredAt: s.updatedAt },
      expectedSession: injected }));
    assert.equal(f.reads(), 0); assert.deepEqual(f.effects, []);
  });
  for (const op of ["read", "save", "cas", "mutation", "benefits", "reopen", "prepare", "completion", "preflight", "chat", "exchange"] as const) {
    test(`stored widget receipt refuses generic operation before effects: ${op}/${index}`, async () => {
      const f = fixture(value, true), s = f.session;
      await review(() => op === "read" ? f.repo.getSession(s.merchantId, s.sessionId)
        : op === "save" ? f.repo.saveSession(s)
        : op === "cas" ? f.repo.saveSessionIfUnchanged(s, s)
        : op === "mutation" ? f.repo.commitCommercialMutation({ expected: s, next: s })
        : op === "benefits" ? f.repo.saveBenefitsIfMutable(s, s, merchantRules())
        : op === "reopen" ? f.repo.reopenForBuyerEdit(s.merchantId, s.sessionId, "coupon")
        : op === "prepare" ? f.repo.prepareStorefrontCouponBenefits(s.merchantId, s.sessionId, "pix")
        : op === "completion" ? f.repo.assertPublicCompletionAllowed(s.merchantId, s.sessionId)
        : op === "preflight" ? f.repo.assertCouponBindingCommandAllowed(s.merchantId, s.sessionId)
        : op === "chat" ? f.repo.appendChatTurn(s.merchantId, s.sessionId, { role: "agent", text: "Synthetic", occurredAt: s.updatedAt })
        : f.repo.appendChatExchange({ merchantId: s.merchantId, sessionId: s.sessionId,
          buyer: { role: "buyer", text: "Synthetic", occurredAt: s.updatedAt },
          agent: { role: "agent", text: "Synthetic", occurredAt: s.updatedAt } }));
      assert.ok(f.reads() > 0); assert.deepEqual(f.effects, []);
    });
  }
}

test("plain session mapper preserves current prices and detaches its cart", () => {
  const f = fixture(), result = toCheckoutSession(f.stored);
  assert.deepEqual(result.cart, f.session.cart);
  assert.notEqual(result.cart, f.stored.cart);
});

test("inherited receipt cannot disappear through the generic input snapshot", async () => {
  const f = fixture();
  const cart = Object.assign(Object.create({ [KEY]: { eventId: CANARY } }), f.session.cart);
  await review(() => f.repo.saveSession({ ...f.session, cart }));
  assert.equal(f.reads(), 0); assert.deepEqual(f.effects, []);
});

test("hostile presence probe errors never expose caller-controlled secrets", async () => {
  const cart = new Proxy({}, { has: () => { throw new Error(CANARY); } });
  await review(() => assertNoUnprojectedWidgetReceipt(cart));
});
