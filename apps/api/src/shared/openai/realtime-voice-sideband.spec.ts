import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { once } from "node:events";
import { WebSocketServer, type WebSocket } from "ws";
import { OpenAIRealtimeVoiceService } from "./openai-realtime-voice.service.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";

// Real loopback HTTP + WebSocket, synthetic provider/classifier. Not cloud/audio proof.
for (const decision of ["allowed", "outside", "exception"] as const) {
  test(`actual service sideband enforces storefront scope before response creation: ${decision}`, async t => {
    const previous = Object.fromEntries(["OPENAI_API_KEY", "OPENAI_REALTIME_BASE_URL", "OPENAI_REALTIME_ENABLED", "JWT_SECRET"].map(name => [name, process.env[name]]));
    const traffic: string[] = [], received: any[] = [];
    const server = createServer((req, res) => {
      req.resume(); traffic.push(`${req.method} ${req.url}`);
      if (req.url === "/v1/realtime/calls") {
        res.writeHead(201, { "content-type": "application/sdp", location: "/v1/realtime/calls/synthetic_call" });
        res.end("v=0\r\nsynthetic-answer\r\n");
      } else { res.writeHead(200); res.end(); }
    });
    const sockets = new WebSocketServer({ server });
    let socket!: WebSocket;
    const connected = new Promise<void>(resolve => sockets.once("connection", value => {
      socket = value;
      value.on("message", data => received.push(JSON.parse(data.toString())));
      resolve();
    }));
    server.listen(0, "127.0.0.1"); await once(server, "listening");
    const address = server.address(); assert.ok(address && typeof address !== "string");
    process.env.OPENAI_API_KEY = "synthetic-no-cloud-key";
    process.env.JWT_SECRET = "synthetic-voice-scope-secret-32-characters-minimum";
    process.env.OPENAI_REALTIME_BASE_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.OPENAI_REALTIME_ENABLED = "true";
    let limits = 0, checks = 0;
    const service = new OpenAIRealtimeVoiceService({ assertAllowed: async () => { limits++; } } as never);
    t.after(async () => {
      await service.onModuleDestroy();
      for (const client of sockets.clients) client.terminate();
      await new Promise<void>(resolve => sockets.close(() => resolve()));
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[name]; else process.env[name] = value;
      }
    });
    const call = await service.createCall({ sdp: "v=0\r\nsynthetic-offer", surface: "storefront", merchantId: "synthetic-store",
      conversationId: "synthetic-conversation", aiUserId: "visitor:synthetic", cart: { items: [] }, checkScope: async input => {
        checks++; assert.equal(limits, 1); assert.equal(input.userMessage, "PRIVATE Fibonacci");
        if (decision === "exception") throw new Error("PRIVATE_PROVIDER_ERROR");
        return decision === "allowed" ? { allowed: true } : { allowed: false, reason: "out_of_scope", message: "Posso ajudar com produtos desta loja." };
      } });
    assert.equal(call.providerCallId, "synthetic_call");
    await connected;
    const response = new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("synthetic_sideband_response_timeout")), 3000);
      socket.on("message", data => {
        const event = JSON.parse(data.toString());
        if (event.type === "response.create") { clearTimeout(timer); resolve(event.response); }
      });
    });
    socket.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", item_id: "synthetic_item", transcript: "PRIVATE Fibonacci" }));
    const generated = await response;
    assert.equal(checks, 1); assert.equal(limits, 1);
    assert.equal(received.filter(event => event.type === "response.create").length, 1);
    if (decision === "allowed") {
      assert.equal(generated.conversation, undefined);
      const claims = new RealtimeCapabilityService().verify(generated.metadata.zyon_turn_token, "ai-voice-turn");
      assert.equal(claims.merchantId, "synthetic-store");
      assert.equal(claims.resourceId, "synthetic-conversation");
    } else {
      assert.equal(generated.conversation, "none"); assert.deepEqual(generated.input, []);
      assert.deepEqual(generated.tools, []); assert.equal(generated.tool_choice, "none");
      assert.equal(generated.metadata.zyon_turn_token, undefined);
      assert.ok(received.some(event => event.type === "conversation.item.delete" && event.item_id === "synthetic_item"));
      assert.ok(!JSON.stringify(received).includes("PRIVATE"));
    }
    await service.onModuleDestroy();
    assert.equal(traffic.filter(value => value.includes("/hangup")).length, 1);
  });
}
