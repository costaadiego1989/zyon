import test from "node:test";
import assert from "node:assert/strict";
import { ChatContextService } from "./chat-context.service.js";
import { InterventionRuleTextBuilder } from "./intervention-rule-text.builder.js";
import { checkoutSession, merchantRules } from "../../__tests__/checkout-test-fixtures.js";

function createService(buyerIntent: unknown) {
  const session = checkoutSession({
    merchantId: "merchant",
    sessionId: "session",
    globalUserId: "buyer",
    buyerIntent: { primary_intent: "price_sensitive" },
  } as any);
  const sessions = { getSession: async () => session };
  const merchants = {
    getRules: async () => merchantRules(),
    getProfile: async () => ({ id: "merchant", name: "Loja teste" }),
  };
  const buyerContext = { load: async () => ({ buyerIntent }) };

  return {
    session,
    service: new ChatContextService(
      sessions as any,
      new InterventionRuleTextBuilder(),
      undefined,
      merchants as any,
      undefined,
      undefined,
      buyerContext as any,
    ),
  };
}

test("ChatContextService removes stale intent when active consent no longer returns one", async () => {
  const { service, session } = createService(undefined);

  const context = await service.loadContext("merchant", "session", undefined, undefined, "olá");

  assert.equal(context.buyerIntent, undefined);
  assert.equal((session as any).buyerIntent, undefined);
});

test("ChatContextService exposes the current consented intent for the active chat turn", async () => {
  const intent = {
    primary_intent: "price_sensitive",
    urgency: "high",
    budget_tier: "budget",
    pain_points: ["price"],
  };
  const { service, session } = createService(intent);

  const context = await service.loadContext("merchant", "session", undefined, undefined, "quero cupom");

  assert.deepEqual(context.buyerIntent, intent);
  assert.deepEqual((session as any).buyerIntent, intent);
});
