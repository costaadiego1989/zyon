import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutSession } from "@zyon/shared-types";
import {
  AcpPaymentOrchestrator,
  deriveStableIdempotencyKey,
  mapPaymentMethod,
} from "./acp-payment.orchestrator.js";
import type { CreatePaymentIntentUseCase } from "../../payment/application/create-payment-intent.use-case.js";
import type { CompleteOrderUseCase } from "../../checkout/application/use-cases/complete-order.use-case.js";
import type { EmbedTokenClaims } from "../../embed/domain/embed-token.service.js";

function makeClaims(overrides: Partial<EmbedTokenClaims> = {}): EmbedTokenClaims {
  const now = Math.floor(Date.now() / 1000);
  return {
    typ: "aacp_embed_v1",
    merchantId: "mrc_test",
    installationId: "inst_1",
    issuedAtUnix: now,
    expiresAtUnix: now + 3600,
    nonce: "n_1",
    scopes: ["payment:intents:confirm"],
    ...overrides,
  };
}

function buildSession(): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 100, items: [] },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
  };
}

function createPaymentSpy(
  result: { id: string; providerPaymentId: string | null; amountCents: number; currency: string },
  calls: unknown[],
): CreatePaymentIntentUseCase {
  return {
    async execute(input: unknown) {
      calls.push(input);
      return result;
    },
  } as unknown as CreatePaymentIntentUseCase;
}

function createCompleteSpy(calls: unknown[]): CompleteOrderUseCase {
  return {
    async execute(input: unknown) {
      calls.push(input);
      return { recorded: true, idempotent: false, event_type: "order.completed" as const };
    },
  } as unknown as CompleteOrderUseCase;
}

test("payment: maps credit_card to card", () => {
  assert.equal(mapPaymentMethod("credit_card"), "card");
});

test("payment: maps pix/undefined to pix", () => {
  assert.equal(mapPaymentMethod("pix"), "pix");
  assert.equal(mapPaymentMethod(undefined), "pix");
});

test("payment: maps boleto and crypto identity", () => {
  assert.equal(mapPaymentMethod("boleto"), "boleto");
  assert.equal(mapPaymentMethod("crypto"), "crypto");
});

test("payment: stable idempotency key uses sessionId:installationId:nonce", () => {
  const claims = makeClaims({ installationId: "inst_a", nonce: "nonce_a" });
  const k1 = deriveStableIdempotencyKey("chk_1", claims);
  const k2 = deriveStableIdempotencyKey("chk_1", claims);
  assert.equal(k1, k2);
  assert.match(k1, /^[a-f0-9]{64}$/);
});

test("payment: orchestration uses providerPaymentId as orderId", async () => {
  const intentCalls: unknown[] = [];
  const completeCalls: unknown[] = [];
  const payment = createPaymentSpy(
    { id: "intent_1", providerPaymentId: "pay_99", amountCents: 15000, currency: "BRL" },
    intentCalls,
  );
  const complete = createCompleteSpy(completeCalls);
  const orchestrator = new AcpPaymentOrchestrator(payment, complete);
  const result = await orchestrator.createIntentAndComplete(
    "mrc_test",
    "chk_test",
    buildSession(),
    { payment_token: "t" },
    makeClaims(),
  );
  assert.equal(result.orderId, "pay_99");
  assert.equal(result.orderTotal, 150);
  assert.equal(intentCalls.length, 1);
  assert.equal(completeCalls.length, 1);
});

test("payment: orchestration falls back to intent.id when providerPaymentId missing", async () => {
  const completeCalls: unknown[] = [];
  const payment = createPaymentSpy(
    { id: "intent_x", providerPaymentId: null, amountCents: 100, currency: "BRL" },
    [],
  );
  const orchestrator = new AcpPaymentOrchestrator(payment, createCompleteSpy(completeCalls));
  const result = await orchestrator.createIntentAndComplete(
    "mrc_test",
    "chk_test",
    buildSession(),
    { payment_token: "t" },
    makeClaims(),
  );
  assert.equal(result.orderId, "intent_x");
});

test("payment: explicit idempotency_key from body takes precedence over derived", async () => {
  const calls: unknown[] = [];
  const payment = createPaymentSpy(
    { id: "i", providerPaymentId: "p", amountCents: 0, currency: "BRL" },
    calls,
  );
  const orchestrator = new AcpPaymentOrchestrator(payment, createCompleteSpy([]));
  await orchestrator.createIntentAndComplete(
    "mrc_test",
    "chk_test",
    buildSession(),
    { payment_token: "t", idempotency_key: "  my-key  " },
    makeClaims(),
  );
  const args = calls[0] as { idempotency_key: string };
  assert.equal(args.idempotency_key, "my-key");
});

test("payment: currency from intent is forwarded to CompleteOrder", async () => {
  const calls: unknown[] = [];
  const payment = createPaymentSpy(
    { id: "i", providerPaymentId: "p", amountCents: 500, currency: "BRL" },
    [],
  );
  const orchestrator = new AcpPaymentOrchestrator(payment, createCompleteSpy(calls));
  await orchestrator.createIntentAndComplete(
    "mrc_test",
    "chk_test",
    buildSession(),
    { payment_token: "t" },
    makeClaims(),
  );
  const args = calls[0] as { currency: string; order_total: number };
  assert.equal(args.currency, "BRL");
  assert.equal(args.order_total, 5);
});
