import assert from "node:assert/strict";
import test from "node:test";
import type { Prisma, PrismaClient } from "@prisma/client";
import { lockCheckoutSessionAnchor } from "../../../shared/persistence/checkout-session-lock.js";
import { PaymentIntentEntity } from "../../payment/domain/payment-intent.entity.js";
import { CheckoutChatRequestService } from "../../checkout/infrastructure/prisma/checkout-chat-request.service.js";
import { StrategyCheckoutChatService } from "../../checkout/application/services/strategy-checkout-chat.service.js";
import { StrategyChatPublisher } from "./strategy-chat-publisher.js";
import { lockStrategySession, StrategyExecutionLedger } from "./strategy-execution-ledger.js";
import { prepareProgressiveIncentivePayment, reviseIncentiveForPaymentReview, validateIncentivePayment } from "./incentive-execution-ledger.js";

const STOP = new Error("synthetic_stop_at_checkout_row_lock");
type SqlCall = { sql: string; values: unknown[] };

/** Strict SQL/delegate spies, NOT SQL/reentrancy/deadlock proof. Stop at the
 * first checkout row lock, before business reads, grants, flags or writes.
 * Private chat methods are invoked reflectively to isolate their lock wrapper;
 * these tests do not claim public chat admission/publication coverage. */
function fixture() {
  const calls: SqlCall[] = [];
  let storedSession = "";
  const raw = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      const sql = parts.join("?").replace(/\s+/g, " ").trim();
      calls.push({ sql, values: structuredClone(values) });
      if (sql.includes("FROM checkout_sessions") && /FOR (UPDATE|SHARE)$/.test(sql)) throw STOP;
      assert.ok(sql.includes("pg_advisory_xact_lock") || /FROM (merchants|merchant_rules|checkout_settings)/.test(sql), sql);
      return [];
    },
    strategyIncentiveAssignment: { async findUnique() { return { id: "synthetic-assignment" }; } },
    strategyTurn: { async findFirst() { return { outcome: null, completion: null,
      assignment: { sessionId: storedSession, execution: {} } }; } },
  };
  const tx = new Proxy(raw, { get(target, key) {
    if (typeof key === "string" && key in target) return Reflect.get(target, key);
    assert.fail(`unexpected transaction access: ${String(key)}`);
  } }) as unknown as Prisma.TransactionClient;
  let transactions = 0;
  const prisma = new Proxy({ async $transaction(work: (transaction: Prisma.TransactionClient) => Promise<unknown>) {
    transactions++; return work(tx);
  } }, { get(target, key) {
    if (key === "$transaction") return target.$transaction;
    assert.fail(`unexpected root client access: ${String(key)}`);
  } }) as unknown as PrismaClient;
  return { tx, prisma, calls, transactions: () => transactions, setSession: (value: string) => { storedSession = value; } };
}

function invokePrivate(instance: object, name: string, args: unknown[]) {
  const method: unknown = Reflect.get(instance, name);
  assert.equal(typeof method, "function");
  assert.ok(typeof method === "function");
  return Promise.resolve(Reflect.apply(method, instance, args));
}

const wrappers = ["progressive", "review", "payment-validation", "publisher", "strategy-stop",
  "chat-display", "chat-reconcile", "chat-claim", "chat-finish", "strategy-share", "strategy-admission", "strategy-completion"] as const;
type Wrapper = typeof wrappers[number];
const baseline = new Set<Wrapper>(["progressive", "payment-validation", "publisher", "strategy-admission", "strategy-completion"]);
const merchant = new Set<Wrapper>([...baseline, "review", "strategy-stop", "chat-reconcile"]);

function run(wrapper: Wrapper, f: ReturnType<typeof fixture>, merchantId: string, sessionId: string) {
  f.setSession(sessionId);
  const request = { merchant_id: merchantId, session_id: sessionId, conversation_id: "synthetic-conversation",
    message_id: "synthetic_message_0001", user_message: "synthetic text" };
  const claim = { requestId: "synthetic-request", requestHash: "ab".repeat(32) };
  switch (wrapper) {
    case "strategy-share": return lockStrategySession(f.tx, merchantId, sessionId);
    case "strategy-admission": return (async () => {
      const names = ["REVENUE_STRATEGY_EXECUTION_ENABLED", "REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS"] as const;
      const previous = names.map(name => [name, process.env[name]] as const);
      process.env.REVENUE_STRATEGY_EXECUTION_ENABLED = "true";
      process.env.REVENUE_STRATEGY_EXECUTION_MERCHANT_IDS = merchantId;
      try { return await new StrategyExecutionLedger(f.prisma).admitTurn({ merchantId, sessionId,
        route: "primary_llm", requestKey: "synthetic-request", inputHash: "ab".repeat(32), chatRequest: claim }); }
      finally { for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; } }
    })();
    case "strategy-completion": return new StrategyExecutionLedger(f.prisma).completeTurn(merchantId,
      "synthetic-turn", { outcome: "provider_not_dispatched" });
    case "progressive": return prepareProgressiveIncentivePayment(f.tx, merchantId, sessionId, "pix");
    case "review": return reviseIncentiveForPaymentReview(f.tx, merchantId, sessionId);
    case "payment-validation": return validateIncentivePayment(f.tx, PaymentIntentEntity.create({
      merchantId, sessionId, idempotencyKey: "synthetic-key", amountCents: 100, currency: "BRL", method: "pix" }).snapshot());
    case "publisher": return new StrategyChatPublisher(f.prisma).publish({ merchantId, sessionId,
      turnId: "synthetic-turn", claim, userMessage: request.user_message, result: { content: "synthetic answer", toolCalls: [] } });
    case "strategy-stop": return invokePrivate(new StrategyCheckoutChatService(f.prisma, {
      async callPinned() { assert.fail("provider gateway must not be called"); },
    }), "stopBeforeDispatch", [request, claim, {}, "checkout_context_catalog"]);
    case "chat-display": return new CheckoutChatRequestService(f.prisma).recordDisplay(merchantId, {
      session_id: sessionId, conversation_id: request.conversation_id, definition: "widget-visible-text-v1",
      display_ref: { turn_id: "synthetic-turn", text_hash: "ab".repeat(32) } });
    case "chat-reconcile": return new CheckoutChatRequestService(f.prisma).reconcile(request);
    case "chat-claim": return invokePrivate(new CheckoutChatRequestService(f.prisma), "claim", [request]);
    case "chat-finish": return invokePrivate(new CheckoutChatRequestService(f.prisma), "finish", [{
      id: claim.requestId, merchantId, sessionId, requestHash: claim.requestHash }, "completed", null]);
  }
}

function assertOrder(f: ReturnType<typeof fixture>, wrapper: Wrapper, merchantId: string, sessionId: string, offset = 0) {
  const calls = f.calls.slice(offset);
  const row = calls.findIndex(call => call.sql.includes("FROM checkout_sessions"));
  const anchor = calls.findIndex(call => call.sql.includes("pg_advisory_xact_lock"));
  assert.ok(anchor >= 0, "checkout session anchor required");
  assert.equal(anchor, row - 1, "anchor must be acquired immediately before checkout row lock");
  assert.deepEqual(calls[anchor].values, [JSON.stringify(["checkout-session", merchantId, sessionId])]);
  assert.deepEqual(calls[row].values, [merchantId, sessionId]);
  assert.equal(calls[row].sql.endsWith(["chat-display", "strategy-share", "strategy-admission", "strategy-completion"].includes(wrapper)
    ? "FOR SHARE" : "FOR UPDATE"), true);
  const prefix = calls.slice(0, anchor);
  assert.deepEqual(prefix.map(call => call.sql.match(/FROM (\w+)/)?.[1]),
    wrapper === "payment-validation" ? ["merchants", "merchants", "merchant_rules", "checkout_settings"]
      : baseline.has(wrapper) ? ["merchants", "merchant_rules", "checkout_settings"] : merchant.has(wrapper) ? ["merchants"] : []);
  for (const call of prefix) assert.deepEqual(call.values, [merchantId]);
  assert.equal(f.transactions(), ["progressive", "review", "payment-validation", "strategy-share"].includes(wrapper) ? 0 : 1);
}

for (const wrapper of wrappers) {
  for (const [merchantId, sessionId] of [["synthetic-tenant-a", "same-session"], ["synthetic-tenant-b", "different-session"]]) {
    test(`${wrapper} preserves tenant-scoped merchant/config -> anchor -> row lock order (${merchantId})`, async () => {
      const f = fixture();
      await assert.rejects(run(wrapper, f, merchantId, sessionId), error => error === STOP);
      assertOrder(f, wrapper, merchantId, sessionId);
    });
  }
  test(`${wrapper} reacquires the same anchor on the caller's transaction rather than an ambient client`, async () => {
    const f = fixture(), merchantId = "synthetic-reentrant-tenant", sessionId = "synthetic-reentrant-session";
    // Model an outer transaction that already holds the same preceding locks.
    if (merchant.has(wrapper)) await f.tx.$queryRaw`SELECT id FROM merchants WHERE id=${merchantId} FOR UPDATE`;
    if (baseline.has(wrapper)) {
      await f.tx.$queryRaw`SELECT id FROM merchant_rules WHERE merchant_id=${merchantId} FOR SHARE`;
      await f.tx.$queryRaw`SELECT id FROM checkout_settings WHERE merchant_id=${merchantId} FOR SHARE`;
    }
    await lockCheckoutSessionAnchor(f.tx, merchantId, sessionId);
    const offset = f.calls.length;
    await assert.rejects(run(wrapper, f, merchantId, sessionId), error => error === STOP);
    assertOrder(f, wrapper, merchantId, sessionId, offset);
    const anchors = f.calls.filter(call => call.sql.includes("pg_advisory_xact_lock"));
    assert.equal(anchors.length, 2);
    assert.deepEqual(anchors[0].values, anchors[1].values);
  });
}
