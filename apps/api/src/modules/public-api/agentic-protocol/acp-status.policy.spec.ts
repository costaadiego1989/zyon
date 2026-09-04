import test from "node:test";
import assert from "node:assert/strict";
import type { CheckoutEventName, CheckoutSession } from "@zyon/shared-types";
import { AcpStatusPolicy } from "./acp-status.policy.js";
import type { CheckoutSessionRepository } from "../../checkout/domain/ports/checkout-session.repository.port.js";

function buildSession(overrides: Partial<CheckoutSession> = {}): CheckoutSession {
  return {
    merchantId: "mrc_test",
    sessionId: "chk_test",
    globalUserId: "g_test",
    conversationId: "conv_test",
    cart: { currency: "BRL", total: 200, items: [{ sku: "sku_1", name: "P1", price: 100, quantity: 2 }] },
    abandonmentScore: 0,
    triggerAgent: false,
    chatHistory: [],
    createdAt: "2026-09-03T12:00:00.000Z",
    updatedAt: "2026-09-03T12:00:00.000Z",
    ...overrides,
  };
}

function createRepo(events: CheckoutEventName[] = []): CheckoutSessionRepository {
  return {
    async saveSession() {},
    async getSession() {
      return undefined;
    },
    async findSessionsByEmail() {
      return [];
    },
    async appendChatTurn(_m, _s, t) {
      return t as unknown as CheckoutSession;
    },
    async recordEvent() {},
    async findSessionsWithTrigger() {
      return [];
    },
    async getSessionEvents() {
      return events;
    },
  };
}

test("status: pure deriveFrom returns completed when order_completed present", () => {
  const session = buildSession();
  assert.equal(AcpStatusPolicy.deriveFrom(session, ["order_completed"]), "completed");
});

test("status: pure deriveFrom returns canceled when checkout_abandoned present", () => {
  const session = buildSession();
  assert.equal(AcpStatusPolicy.deriveFrom(session, ["checkout_abandoned"]), "canceled");
});

test("status: pure deriveFrom completed wins over canceled", () => {
  const session = buildSession();
  assert.equal(
    AcpStatusPolicy.deriveFrom(session, ["checkout_abandoned", "order_completed"]),
    "completed",
  );
});

test("status: pure deriveFrom returns awaiting_payment when items + shipping + total>0", () => {
  const session = buildSession({
    shipping: { customerPrice: 10, carrier: "C", method: "M" },
  });
  assert.equal(AcpStatusPolicy.deriveFrom(session, []), "awaiting_payment");
});

test("status: pure deriveFrom returns pending when shipping missing", () => {
  const session = buildSession({ shipping: undefined });
  assert.equal(AcpStatusPolicy.deriveFrom(session, []), "pending");
});

test("status: pure deriveFrom returns pending when total is zero", () => {
  const session = buildSession({
    cart: { currency: "BRL", total: 0, items: [] },
    shipping: { customerPrice: 10, carrier: "C", method: "M" },
  });
  assert.equal(AcpStatusPolicy.deriveFrom(session, []), "pending");
});

test("status: derive() calls repository.getSessionEvents and returns same result", async () => {
  const repo = createRepo(["order_completed"]);
  const policy = new AcpStatusPolicy(repo);
  const result = await policy.derive(buildSession());
  assert.equal(result, "completed");
});
