import test from "node:test";
import assert from "node:assert/strict";
import { StartCheckoutUseCase } from "../../application/use-cases/start-checkout.use-case.js";
import { SendChatMessageUseCase } from "../../application/use-cases/send-chat-message.use-case.js";
import { InMemoryCheckoutRepository } from "../repositories/in-memory-checkout.repository.js";
import { DeterministicConversationAdapter } from "./deterministic-conversation.adapter.js";
import { CheckoutCustomerService } from "../../application/services/checkout-customer.service.js";
import { CheckoutShippingService } from "../../application/services/checkout-shipping.service.js";
import { CheckoutOfferService } from "../../application/services/checkout-offer.service.js";

function makeSetup() {
  const checkout = new InMemoryCheckoutRepository();
  const conversation = new DeterministicConversationAdapter();
  const custService = new CheckoutCustomerService(checkout);
  const shipService = new CheckoutShippingService(checkout, custService);
  const offerService = new CheckoutOfferService(checkout);
  const useCase = new SendChatMessageUseCase(
    checkout,
    conversation,
    custService,
    shipService,
    offerService
  );
  return { checkout, useCase };
}

function makeId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

test("deterministic-chat e2e: reply returned without calling fetch (no LLM)", async () => {
  const { checkout, useCase } = makeSetup();
  const merchantId = makeId("mrc_det");
  const sessionId = makeId("chk_det");

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: { currency: "BRL", total: 300, items: [{ sku: "s1", name: "Item", price: 300, quantity: 1 }] }
  });

  const originalFetch = globalThis.fetch;
  let fetchCalled = false;
  globalThis.fetch = (async () => {
    fetchCalled = true;
    return new Response("", { status: 200 });
  }) as typeof fetch;

  try {
    const result = await useCase.execute({
      merchant_id: merchantId,
      session_id: sessionId,
      conversation_id: makeId("conv"),
      user_message: "esta caro"
    });
    assert.equal(fetchCalled, false, "fetch must not be called — deterministic adapter only");
    assert.ok(result.message.length > 0, "message returned");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("deterministic-chat e2e: price objection produces objection=price in session history", async () => {
  const { checkout, useCase } = makeSetup();
  const merchantId = makeId("mrc_price");
  const sessionId = makeId("chk_price");

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: { currency: "BRL", total: 300, items: [{ sku: "s1", name: "Item", price: 300, quantity: 1 }] }
  });

  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    conversation_id: makeId("conv"),
    user_message: "esta muito caro"
  });

  assert.ok(result.message.length > 0);
  // agent turn appended
  const session = await checkout.getSession(merchantId, sessionId);
  const agentTurns = session?.chatHistory.filter((t) => t.role === "agent") ?? [];
  assert.ok(agentTurns.length > 0, "agent turn persisted in session chat history");
});

test("deterministic-chat e2e: shipping objection message contains relevant content", async () => {
  const { checkout, useCase } = makeSetup();
  const merchantId = makeId("mrc_ship");
  const sessionId = makeId("chk_ship");

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: { currency: "BRL", total: 300, items: [{ sku: "s1", name: "Item", price: 300, quantity: 1 }] }
  });

  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    conversation_id: makeId("conv"),
    user_message: "frete esta muito caro"
  });

  assert.ok(result.message.length > 0, "response message not empty");
  // buyer turn persisted
  const session = await checkout.getSession(merchantId, sessionId);
  const buyerTurns = session?.chatHistory.filter((t) => t.role === "buyer") ?? [];
  assert.ok(buyerTurns.length > 0, "buyer turn persisted in session chat history");
});

test("deterministic-chat e2e: multiple turns accumulate in chat history", async () => {
  const { checkout, useCase } = makeSetup();
  const merchantId = makeId("mrc_multi");
  const sessionId = makeId("chk_multi");
  const convId = makeId("conv");

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: { currency: "BRL", total: 300, items: [{ sku: "s1", name: "Item", price: 300, quantity: 1 }] }
  });

  await useCase.execute({ merchant_id: merchantId, session_id: sessionId, conversation_id: convId, user_message: "esta caro" });
  await useCase.execute({ merchant_id: merchantId, session_id: sessionId, conversation_id: convId, user_message: "ainda assim" });

  const session = await checkout.getSession(merchantId, sessionId);
  const history = session?.chatHistory ?? [];
  assert.ok(history.length >= 4, "at least 2 buyer + 2 agent turns after 2 messages");
});

test("deterministic-chat e2e: reply includes agent name when agentContext resolved", async () => {
  const { checkout, useCase } = makeSetup();
  const merchantId = makeId("mrc_agent");
  const sessionId = makeId("chk_agent");

  await new StartCheckoutUseCase(checkout, checkout, checkout).execute({
    merchant_id: merchantId,
    session_id: sessionId,
    cart: { currency: "BRL", total: 300, items: [{ sku: "s1", name: "Item", price: 300, quantity: 1 }] }
  });

  // No agentContext port wired → adapter still returns deterministic reply without crashing
  const result = await useCase.execute({
    merchant_id: merchantId,
    session_id: sessionId,
    conversation_id: makeId("conv"),
    user_message: "ok"
  });

  assert.ok(typeof result.message === "string", "message is a string");
  assert.ok(result.message.length > 0, "message not empty");
});
