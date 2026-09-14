import test from "node:test";
import assert from "node:assert/strict";
import { CheckoutWhatsAppConversationAdapter } from "./checkout-whatsapp-conversation.adapter.js";
import { HandleIncomingMessageUseCase } from "../../application/use-cases/handle-incoming-message.use-case.js";
import { resolveNumberedInput } from "../../application/services/whatsapp-menu-renderer.service.js";

test("WhatsApp invokes the checkout engine using the tenant session and renders actual products and payment data", async () => {
  let request: any;
  const adapter = new CheckoutWhatsAppConversationAdapter({ execute: async (input: any) => {
    request = input;
    return { message: "Escolha seu produto", actions: [{ label: "Continuar" }], experience: {
      suggestedProducts: [{ name: "Produto real", unit_price: 12.5 }], copy: { quick_replies: ["Continuar"] },
      payment_intent: { status: "pending", copy_paste: "PIX-CODE" },
    } };
  } } as any, { getSession: async (merchant: string, session: string) => merchant === "m1" && session === "s1" ? { merchantId: "m1", sessionId: "s1", conversationId: "conv1" } : undefined } as any);
  const result = await adapter.respond({ merchantId: "m1", checkoutSessionId: "s1", message: "Produtos" });
  assert.deepEqual(request, { merchant_id: "m1", session_id: "s1", conversation_id: "conv1", user_message: "Produtos" });
  assert.match(result.agentMessage, /Produto real/);
  assert.match(result.agentMessage, /12,50/);
  assert.match(result.agentMessage, /PIX-CODE/);
  assert.deepEqual(result.quickReplies, ["Continuar"]);
  request = undefined;
  await assert.rejects(adapter.respond({ merchantId: "other", checkoutSessionId: "s1", message: "Oi" }), /checkout_session_not_found/);
  assert.equal(request, undefined);
});

test("checkout response and numbered choices propagate through the real incoming pipeline", async () => {
  const sent: any[] = [], prompts: any[] = [];
  const session = { id: "wa", checkoutSessionId: "s1", currentOptions: ["Meu carrinho"], previousOptions: [], currentPage: 0 };
  const incoming = new HandleIncomingMessageUseCase({ execute: async () => ({ whatsappSession: session }) } as any,
    { execute: async (input: any) => sent.push(input) } as any, { updateMenuState: async () => {} } as any,
    { respond: async input => { prompts.push(input); return { agentMessage: "Seu carrinho tem dois itens", quickReplies: ["Finalizar"] }; } });
  await incoming.execute({ merchantId: "m1", deviceId: "device", fromNumber: "5511999999999", body: "1", messageType: "text", timestamp: 1, provider: "META_CLOUD" });
  assert.equal(prompts[0].message, "Meu carrinho");
  assert.equal(prompts[0].merchantId, "m1");
  assert.match(sent[0].text, /dois itens/);
  assert.equal(sent[0].provider, "META_CLOUD");
  assert.equal(resolveNumberedInput("1 camiseta", { currentOptions: ["Comprar"], previousOptions: [], page: 0, context: "menu" }).action, "freetext");
});

test("post-sale persistence failure is retryable and never sends a false success", async () => {
  let clears = 0, sends = 0;
  const session = { id: "wa", postSaleContext: { stage: "awaiting_nps", buyerId: "buyer", orderId: "order" } };
  const incoming = new HandleIncomingMessageUseCase({ execute: async () => ({ whatsappSession: session }) } as any,
    { execute: async () => { sends++; } } as any, { clearPostSaleContext: async () => { clears++; } } as any,
    { respond: async () => { throw new Error("must not reach checkout"); } },
    { handleNpsReply: async () => { throw new Error("database unavailable"); } } as any);
  await assert.rejects(incoming.execute({ merchantId: "m1", deviceId: "device", fromNumber: "5511999999999", body: "5", messageType: "text", timestamp: 1, provider: "META_CLOUD" }), /database unavailable/);
  assert.equal(clears, 0);
  assert.equal(sends, 0);
});
