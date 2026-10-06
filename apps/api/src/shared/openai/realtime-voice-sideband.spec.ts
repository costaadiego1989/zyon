import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { setTimeout as delay } from "node:timers/promises";
import { WebSocketServer, type WebSocket } from "ws";
import { AiUserRateLimitService } from "../http/ai-user-rate-limit.service.js";
import { DistributedRateLimitStore } from "../http/rate-limit.store.js";
import { OpenAIRealtimeVoiceService } from "./openai-realtime-voice.service.js";

async function until(predicate: () => boolean) {
  const deadline = Date.now() + 5000;
  while (!predicate()) { if (Date.now() > deadline) throw Error("sideband_condition_timeout"); await delay(10); }
}

test("real HTTP/WebSocket sideband admits ten user turns, deduplicates events and hangs up the eleventh", async () => {
  const prior = Object.fromEntries(["OPENAI_REALTIME_BASE_URL", "OPENAI_API_KEY", "OPENAI_REALTIME_ENABLED", "JWT_SECRET"].map(key => [key, process.env[key]]));
  const received: any[] = [];
  let hangups = 0;
  let configuration: any;
  let sideband: WebSocket | undefined;
  const server = createServer(async (request, response) => {
    assert.equal(request.headers.authorization, "Bearer local-test-key");
    if (request.url?.endsWith("/hangup")) { hangups++; response.writeHead(200); response.end(); return; }
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    assert.match(request.headers["content-type"]!, /^multipart\/form-data; boundary=/);
    const form = await new Request(`http://127.0.0.1${request.url}`, {
      method: "POST", headers: { "content-type": request.headers["content-type"]! }, body: Buffer.concat(chunks),
    }).formData();
    assert.equal(form.get("sdp"), "v=0\r\na=offer");
    configuration = { session: JSON.parse(form.get("session") as string) };
    response.writeHead(201, { location: "/v1/realtime/calls/local_call" });
    response.end("v=0\r\na=answer");
  });
  const sockets = new WebSocketServer({ server });
  sockets.on("connection", (socket, request) => {
    assert.equal(request.url, "/v1/realtime?call_id=local_call");
    assert.equal(request.headers.authorization, "Bearer local-test-key");
    sideband = socket;
    socket.on("message", data => {
      const event = JSON.parse(data.toString());
      received.push(event);
      if (event.type === "response.create") {
        const id = `response_${received.length}`;
        socket.send(JSON.stringify({ type: "response.created", response: { id, metadata: event.response.metadata } }));
        socket.send(JSON.stringify({ type: "response.done", response: { id } }));
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  process.env.OPENAI_REALTIME_BASE_URL = `http://127.0.0.1:${port}/v1`;
  process.env.OPENAI_API_KEY = "local-test-key";
  process.env.OPENAI_REALTIME_ENABLED = "true";
  process.env.JWT_SECRET = "local-sideband-secret-at-least-32-characters";
  const store = new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60000 });
  const limiter = new AiUserRateLimitService(store);
  const service = new OpenAIRealtimeVoiceService(limiter);
  try {
    const result = await service.createCall({ merchantId: "merchant_a", conversationId: "conversation_a", aiUserId: "buyer:user_a", cart: { items: [] }, sdp: "v=0\r\na=offer" });
    assert.equal(result.providerCallId, "local_call");
    assert.equal(configuration.session.audio.input.turn_detection.create_response, false);
    for (let i = 0; i < 10; i++) {
      const item = { id: `user_${i}`, type: "message", role: "user", content: [{ type: i < 6 ? "input_text" : "input_audio" }] };
      sideband!.send(JSON.stringify({ type: "conversation.item.added", item }));
      sideband!.send(JSON.stringify({ type: "conversation.item.created", item }));
      if (i >= 6) sideband!.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: item.id, transcript: "Quero consultar meu carrinho" }));
    }
    await until(() => received.filter(event => event.type === "response.create").length === 10);
    const permit = received[0].response.metadata.zyon_turn_token;
    assert.equal(await limiter.consumeVoicePermit(permit, { userId: "buyer:user_a", merchantId: "merchant_a", resourceId: "conversation_a" }), true);
    await assert.rejects(() => limiter.consumeVoicePermit(permit, { userId: "buyer:user_a", merchantId: "merchant_a", resourceId: "conversation_a" }));
    sideband!.send(JSON.stringify({ type: "conversation.item.added", item: { id: "eleventh", role: "user", type: "message" } }));
    await until(() => hangups === 1);
    assert.equal(received.filter(event => event.type === "response.create").length, 10);
    assert.equal(JSON.parse(received.find(event => event.type === "conversation.item.create").item.content[0].text).zyon_voice_error, "ai_interaction_rate_limited");
    assert.equal((await limiter.consume("buyer:user_b")).allowed, true);
  } finally {
    await service.onModuleDestroy();
    sideband?.terminate();
    store.onModuleDestroy();
    await new Promise<void>(resolve => sockets.close(() => resolve()));
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    for (const [key, value] of Object.entries(prior)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
