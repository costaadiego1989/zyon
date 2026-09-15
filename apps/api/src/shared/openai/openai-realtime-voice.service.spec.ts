import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIRealtimeVoiceService } from "./openai-realtime-voice.service.js";

test("realtime voice sessions bound output, instructions and cart context", async (t) => {
  const previousFetch = globalThis.fetch;
  const previousKey = process.env.OPENAI_API_KEY;
  const previousLimit = process.env.OPENAI_REALTIME_MAX_OUTPUT_TOKENS;
  const requests: RequestInit[] = [];
  t.after(() => {
    globalThis.fetch = previousFetch;
    if (previousKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = previousKey;
    if (previousLimit === undefined) delete process.env.OPENAI_REALTIME_MAX_OUTPUT_TOKENS;
    else process.env.OPENAI_REALTIME_MAX_OUTPUT_TOKENS = previousLimit;
  });

  process.env.OPENAI_API_KEY = "voice-test-key";
  delete process.env.OPENAI_REALTIME_MAX_OUTPUT_TOKENS;
  globalThis.fetch = (async (_url, init) => {
    requests.push(init ?? {});
    return Response.json({ value: "ephemeral-voice-secret-for-test" });
  }) as typeof fetch;

  const service = new OpenAIRealtimeVoiceService();
  await service.createClientSecret({
    merchantId: "merchant_test",
    conversationId: "conversation_test",
    cart: {
      items: Array.from({ length: 6 }, (_, index) => ({
        name: `Produto ${index + 1} com uma descricao muito longa para a sessao de voz`,
        quantity: 1,
        unitPrice: 10 + index,
      })),
      total: 75,
      currency: "BRL",
    },
  });

  const firstSession = JSON.parse(String(requests[0]?.body)).session;
  assert.equal(firstSession.max_output_tokens, 512);
  assert.match(firstSession.instructions, /até duas frases e 60 palavras/);
  assert.match(firstSession.instructions, /mais 2 item\(ns\)/);
  assert.doesNotMatch(firstSession.instructions, /Produto 5/);
  assert.equal(firstSession.tools.length, 3);

  process.env.OPENAI_REALTIME_MAX_OUTPUT_TOKENS = "9000";
  await service.createClientSecret({ merchantId: "merchant_test", conversationId: "conversation_next", cart: { items: [] } });
  const cappedSession = JSON.parse(String(requests[1]?.body)).session;
  assert.equal(cappedSession.max_output_tokens, 2048);
});
