import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { OpenRouterProvider } from "@zyon/conversation-engine";
import { OpenAIRealtimeVoiceService } from "./openai-realtime-voice.service.js";
import { configureAiMetering, meteredAiFetch, withAiMetering, type AiMeteringContext } from "../ai-metering.js";
import { classifyStorefrontIntent } from "../../modules/storefront/infrastructure/ai/structured-intent-classifier.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";

for (const ambient of ["absent", "foreign"] as const) {
  test(`voice classifier uses its server-owned metering context when ambient tenant is ${ambient}`, async t => {
    const names = ["OPENAI_API_KEY", "OPENAI_REALTIME_BASE_URL", "OPENAI_REALTIME_ENABLED", "JWT_SECRET"];
    const previous = Object.fromEntries(names.map(name => [name, process.env[name]]));
    const contexts: AiMeteringContext[] = [], received: any[] = [];
    let classifierRequests = 0;
    const server = createServer((request, response) => {
      request.resume();
      if (request.url === "/v1/realtime/calls") {
        response.writeHead(201, { "content-type": "application/sdp", location: "/v1/realtime/calls/owned-call" }); response.end("v=0\r\nowned-answer\r\n");
      } else if (request.url === "/v1/chat/completions") {
        classifierRequests++;
        response.setHeader("content-type", "application/json"); response.end(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ schemaVersion: 2, domain: "STORE_COMMERCE", intent: "PRODUCT_SEARCH", confidence: 0.99, requiresTool: true, needsProductDiscovery: true, shoppingPhase: "search" }) } }], usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 } }));
      } else { response.writeHead(200); response.end(); }
    });
    const sockets = new WebSocketServer({ server }); let socket!: WebSocket;
    const connected = new Promise<void>(resolve => sockets.once("connection", value => { socket = value; value.on("message", data => received.push(JSON.parse(data.toString()))); resolve(); }));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const base = `http://127.0.0.1:${address.port}/v1`;
    Object.assign(process.env, { OPENAI_API_KEY: "synthetic-voice-key", OPENAI_REALTIME_BASE_URL: base, OPENAI_REALTIME_ENABLED: "true", JWT_SECRET: "synthetic-voice-metering-secret-at-least-32-characters" });
    const dispose = configureAiMetering({ fetch: async (context, input, init, transport) => { contexts.push(structuredClone(context)); return transport!(input, init); } }, () => undefined);
    const metering = { openVoiceSession: async () => ({ id: "owned-metering-session", source: "voice_checkout", model: "synthetic-openai" }), voiceSessionState: async () => {}, observeVoice: async () => {}, authorizeVoiceTurn: async () => {}, rememberVoicePermit: async () => {} };
    const service = new OpenAIRealtimeVoiceService({ assertAllowed: async () => {} } as never, metering as never);
    t.after(async () => {
      await service.onModuleDestroy(); dispose();
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve())); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve()));
      for (const [name, value] of Object.entries(previous)) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    });
    const provider = new OpenRouterProvider({ apiKey: "synthetic-classifier-key", model: "synthetic-classifier", baseUrl: base, fetchFn: meteredAiFetch("storefront_agent") });
    const start = () => service.createCall({ sdp: "v=0\r\nowned-offer", surface: "storefront", merchantId: "owned-merchant", conversationId: "owned-conversation", aiUserId: "visitor:owned", cart: { items: [] }, checkScope: async input => {
      const result = await classifyStorefrontIntent(provider, input);
      return result.classification.domain === "STORE_COMMERCE" ? { allowed: true } : { allowed: false, reason: "scope_unclear", message: "Reformule seu pedido." };
    } });
    if (ambient === "foreign") await withAiMetering({ merchantId: "foreign-merchant", source: "unrelated", costCenter: "text" }, start); else await start();
    await connected;
    const generated = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(Error("owned_sideband_timeout")), 5000);
      socket.on("message", data => { const event = JSON.parse(data.toString()); if (event.type === "response.create") { clearTimeout(timer); resolve(event.response); } });
    });
    socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "owned-speech", transcript: "Quero ver os produtos que esta loja vende." }));
    const response = await generated;
    assert.equal(classifierRequests, 1); assert.equal(contexts.length, 1);
    assert.deepEqual(contexts[0], { merchantId: "owned-merchant", conversationId: "owned-conversation", voiceSessionId: "owned-metering-session", source: "storefront_agent", costCenter: "voice" });
    const capability = new RealtimeCapabilityService().verify(response.metadata.zyon_turn_token, "ai-voice-turn");
    assert.equal(capability.merchantId, "owned-merchant"); assert.equal(capability.resourceId, "owned-conversation");
    assert.equal(response.conversation, undefined); assert.equal(received.filter(event => event.type === "response.create").length, 1);
  });
}
