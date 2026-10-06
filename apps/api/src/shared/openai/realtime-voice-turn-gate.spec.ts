import test from "node:test";
import assert from "node:assert/strict";
import { RealtimeVoiceTurnGate } from "./realtime-voice-turn-gate.js";
import { AiUserRateLimitService } from "../http/ai-user-rate-limit.service.js";
import { DistributedRateLimitStore } from "../http/rate-limit.store.js";
import { RealtimeCapabilityService } from "../auth/realtime-capability.js";

function setup() {
  const events: any[] = [];
  let closed = false;
  const limiter = new AiUserRateLimitService(new DistributedRateLimitStore({ production: false, ipMax: 600, tenantMax: 60, windowMs: 60000 }));
  const gate = new RealtimeVoiceTurnGate({ userId: "buyer:user_a", merchantId: "m_a", resourceId: "conv_a" }, limiter, new RealtimeCapabilityService("test-ai-voice-secret-at-least-32-characters"), event => events.push(event), async () => { closed = true; });
  return { gate, limiter, events, closed: () => closed };
}

test("text and spoken items share ten user messages; duplicate provider events do not consume twice", async () => {
  const { gate, limiter, events, closed } = setup();
  for (let i = 0; i < 6; i++) await limiter.assertAllowed("buyer:user_a");
  for (let i = 0; i < 4; i++) {
    const item = { role: "user", id: `audio_${i}`, content: [{ type: "input_audio" }] };
    await gate.handle({ type: "conversation.item.added", item });
    await gate.handle({ type: "conversation.item.created", item });
    assert.equal(events.filter(event => event.type === "response.create").length, i);
    await gate.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: item.id, transcript: "Quero consultar o carrinho" });
    await gate.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: item.id, transcript: "Quero consultar o carrinho" });
    const metadata = events.at(-1).response.metadata;
    await gate.handle({ type: "response.created", response: { id: `resp_${i}`, metadata } });
    await gate.handle({ type: "response.done", response: { id: `resp_${i}` } });
  }
  assert.equal(events.filter(event => event.type === "response.create").length, 4);
  await gate.handle({ type: "conversation.item.added", item: { role: "user", id: "eleventh" } });
  assert.equal(events.filter(event => event.type === "response.create").length, 4);
  assert.equal(closed(), true);
});

test("noise consumes no user message and admitted turns wait for the active response", async () => {
  const { gate, limiter, events } = setup();
  await gate.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "noise", transcript: "[ruido]" });
  assert.equal(events[0].type, "conversation.item.delete");
  await gate.handle({ type: "conversation.item.added", item: { id: "text_a", role: "user", content: [{ type: "input_text" }] } });
  await gate.handle({ type: "conversation.item.added", item: { id: "text_b", role: "user", content: [{ type: "input_text" }] } });
  assert.equal(events.filter(event => event.type === "response.create").length, 1);
  const first = events.find(event => event.type === "response.create");
  await gate.handle({ type: "response.created", response: { id: "resp_a", metadata: first.response.metadata } });
  await gate.handle({ type: "response.done", response: { id: "resp_a" } });
  assert.equal(events.filter(event => event.type === "response.create").length, 2);
  assert.equal((await limiter.consume("buyer:user_a")).remaining, 7);
});

test("tool continuation reuses an admitted voice turn and server response keys cannot be replayed", async () => {
  const { gate, limiter, events, closed } = setup();
  await gate.handle({ type: "conversation.item.added", item: { role: "user", id: "audio_a" } });
  const metadata = events[0].response.metadata;
  await gate.handle({ type: "response.created", response: { id: "resp_a", metadata } });
  await gate.handle({ type: "response.output_item.done", response_id: "resp_a", item: { type: "function_call", call_id: "tool_a" } });
  await gate.handle({ type: "response.done", response: { id: "resp_a" } });
  await gate.handle({ type: "conversation.item.added", item: { type: "function_call_output", call_id: "tool_a" } });
  assert.equal(events.filter(event => event.type === "response.create").length, 2);
  assert.equal((await limiter.consume("buyer:user_a")).remaining, 8);
  assert.equal(closed(), false);
  await gate.handle({ type: "response.created", response: { id: "replay", metadata } });
  assert.equal(closed(), true);
  assert.equal(events.at(-1).type, "response.cancel");
});

test("browser attempts to generate directly or enable automatic responses close the voice call", async () => {
  const first = setup();
  await first.gate.handle({ type: "response.created", response: { id: "unadmitted" } });
  assert.equal(first.closed(), true);
  const second = setup();
  await second.gate.handle({ type: "session.updated", session: { audio: { input: { turn_detection: { create_response: true } } } } });
  assert.equal(second.closed(), true);
});

test("checkout speech follows the verified account after OTP authentication", async () => {
  const users: string[] = [], events: any[] = [];
  let authenticated = false;
  const gate = new RealtimeVoiceTurnGate(
    { userId: "visitor:guest", merchantId: "m_a", resourceId: "conv_a" },
    { assertAllowed: async (id: string) => { users.push(id); } } as never,
    new RealtimeCapabilityService("test-ai-voice-secret-at-least-32-characters"),
    event => events.push(event), async () => {},
    async () => authenticated ? "buyer:account_a" : "visitor:guest",
  );
  await gate.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "before", transcript: "Meu email" });
  await gate.handle({ type: "response.created", response: { id: "before", metadata: events[0].response.metadata } });
  await gate.handle({ type: "response.done", response: { id: "before" } });
  authenticated = true;
  await gate.handle({ type: "conversation.item.input_audio_transcription.completed", item_id: "after", transcript: "Meu nome completo" });
  assert.deepEqual(users, ["visitor:guest", "buyer:account_a"]);
  const permit = new RealtimeCapabilityService("test-ai-voice-secret-at-least-32-characters").verify(events.at(-1).response.metadata.zyon_turn_token, "ai-voice-turn");
  assert.equal(permit.aiUserId, "buyer:account_a");
});
