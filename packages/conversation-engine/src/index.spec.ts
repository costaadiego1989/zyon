import test from "node:test";
import assert from "node:assert/strict";
import { generateSalesReply, isSafeGeneratedMessage } from "./index.js";

test("generateSalesReply sends OpenAI-compatible chat completion payloads", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: unknown; headers: HeadersInit | undefined }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body)),
      headers: init?.headers
    });
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: "Posso aplicar a condicao autorizada agora." } }]
      }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const reply = await generateSalesReply({
      provider: "openai_chat",
      apiKey: "deepseek-key",
      baseUrl: "https://deepseek.test/v1",
      model: "deepseek-chat",
      userMessage: "esta caro",
      brandVoice: "consultative",
      failOnProviderError: true
    });

    assert.equal(reply.objection, "price");
    assert.equal(reply.message, "Posso aplicar a condicao autorizada agora.");
    assert.equal(calls[0]?.url, "https://deepseek.test/v1/chat/completions");
    assert.equal((calls[0]?.body as { model?: string }).model, "deepseek-chat");
    assert.equal(
      ((calls[0]?.body as { messages?: Array<{ role: string; content: string }> }).messages ?? [])[0]?.role,
      "system"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateSalesReply falls back when provider is unavailable unless strict mode is enabled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as typeof fetch;

  try {
    const fallback = await generateSalesReply({
      provider: "openai_chat",
      apiKey: "deepseek-key",
      userMessage: "frete caro",
      brandVoice: "consultative"
    });

    assert.equal(fallback.objection, "shipping_cost");
    const ascii = fallback.message
      .normalize("NFD")
      .replace(/\p{Diacritic}/gu, "");
    assert.match(ascii, /melhor condicao permitida|condicao autorizada/);
    await assert.rejects(
      () =>
        generateSalesReply({
          provider: "openai_chat",
          apiKey: "deepseek-key",
          userMessage: "frete caro",
          brandVoice: "consultative",
          failOnProviderError: true
        }),
      /ai_provider_http_429/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateSalesReply rejects unsafe provider text that exceeds authorized commercial terms", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "Consegui liberar 90% de desconto para fechar agora." } }]
      }),
      { status: 200 }
    )) as typeof fetch;

  try {
    const reply = await generateSalesReply({
      provider: "openai_chat",
      apiKey: "deepseek-key",
      userMessage: "quero 90% de desconto",
      brandVoice: "consultative",
      authorizedOffer: {
        id: "off_1",
        merchantId: "mrc_1",
        sessionId: "chk_1",
        type: "discount_percent",
        value: 10,
        approved: true,
        reason: "discount_allowed",
        marginAfterOffer: 0.5,
        expiresAt: "2999-01-01T00:00:00.000Z"
      }
    });

    assert.doesNotMatch(reply.message, /90\s*%/);
    assert.match(reply.message, /10% de desconto/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("generateSalesReply forwards cart, merchant and history to the chat completion", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; body: any }> = [];
  globalThis.fetch = (async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(
      JSON.stringify({ choices: [{ message: { content: "Posso aplicar 5% agora?" } }] }),
      { status: 200 }
    );
  }) as typeof fetch;

  try {
    const reply = await generateSalesReply({
      userMessage: "esta caro",
      brandVoice: "consultative",
      provider: "openai_chat",
      apiKey: "sk-test",
      merchantName: "Loja Demo",
      cart: {
        currency: "BRL",
        total: 200,
        items: [{ sku: "x", name: "Bolsa", price: 200, cost: 100, quantity: 1 }]
      },
      authorizedOffer: {
        id: "off_demo",
        merchantId: "m",
        sessionId: "s",
        type: "discount_percent",
        value: 10,
        approved: true,
        reason: "discount_allowed",
        marginAfterOffer: 0.5,
        expiresAt: "2999-01-01T00:00:00.000Z"
      },
      history: [
        { role: "buyer", text: "oi", occurredAt: "2026-05-04T12:00:00Z" },
        { role: "agent", text: "Olá! Posso ajudar.", occurredAt: "2026-05-04T12:00:01Z" }
      ],
      failOnProviderError: true
    });

    assert.equal(reply.message, "Posso aplicar 5% agora?");
    const sent = calls[0]?.body as { messages: Array<{ role: string; content: string }> };
    assert.ok(
      sent.messages.some((m) => m.role === "system" && m.content.includes("Loja Demo")),
      "system mentions merchant"
    );
    assert.ok(
      sent.messages.some((m) => m.role === "system" && m.content.includes("Bolsa")),
      "system mentions cart item name"
    );
    assert.equal(
      sent.messages.find((m) => m.role === "user" && m.content === "esta caro")?.role,
      "user"
    );
    assert.equal(
      sent.messages.filter((m) => m.role === "user" || m.role === "assistant").length,
      3,
      "history (2) + current user (1) forwarded"
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("isSafeGeneratedMessage blocks delivery, stock, payment, and unauthorized shipping claims", () => {
  assert.equal(isSafeGeneratedMessage("Entrega garantida amanha para voce."), false);
  assert.equal(isSafeGeneratedMessage("Produto reservado e estoque garantido."), false);
  assert.equal(isSafeGeneratedMessage("Seu pagamento foi aprovado."), false);
  assert.equal(isSafeGeneratedMessage("Liberei frete gratis para fechar."), false);
  assert.equal(isSafeGeneratedMessage("Posso te ajudar a finalizar com seguranca."), true);
});
