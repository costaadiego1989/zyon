import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeRealtimeSdp, readRealtimeVoiceCall, realtimeVoiceFailureHint, RealtimeServerVoiceTurns } from "../dist/realtime-voice-session.js";

test("server-owned turns never issue client response.create, including after interruption", () => {
  const sent = [];
  const turns = new RealtimeServerVoiceTurns(event => sent.push(event));
  turns.sendText("Olá");
  turns.receive({ type: "response.created", response: { id: "reply-1", metadata: { zyon_turn_token: "signed-permit" } } });
  turns.receive({ type: "output_audio_buffer.started" });
  turns.interrupt();
  turns.sendText("Quero comprar");
  assert.deepEqual(sent.map(event => event.type), ["conversation.item.create", "response.cancel", "output_audio_buffer.clear", "conversation.item.create"]);
  assert.equal(turns.permitFor("reply-1"), "signed-permit");
  assert.equal(turns.permitFor("different-response"), undefined);
  assert(!JSON.stringify(sent).includes("signed-permit"));
  turns.receive({ type: "response.done", response: { id: "reply-1" } });
  assert.equal(turns.permitFor("reply-1"), undefined);
});

test("SDP offer and answer retain CRLF and a final terminator", () => {
  assert.equal(normalizeRealtimeSdp(" v=0\na=sendrecv\n "), "v=0\r\na=sendrecv\r\n");
  assert.equal(normalizeRealtimeSdp("v=0\r\na=recvonly\r\n"), "v=0\r\na=recvonly\r\n");
  for (const value of [null, {}, "", "secret", "v=0" + "a".repeat(200_000)]) {
    assert.throws(() => normalizeRealtimeSdp(value), /voice_sdp_invalid/);
  }
});

test("only a server SDP answer satisfies the browser contract, never an old token", async () => {
  assert.deepEqual(await readRealtimeVoiceCall(Response.json({ sdp: "v=0\na=recvonly\n", providerCallId: "opaque" })),
    { sdp: "v=0\r\na=recvonly\r\n" });
  for (const body of [{ value: "old-ephemeral-token" }, null, { sdp: "invalid" }]) {
    await assert.rejects(readRealtimeVoiceCall(Response.json(body)), /voice_sdp_invalid/);
  }
  await assert.rejects(readRealtimeVoiceCall(new Response("invalid json")), /voice_sdp_invalid/);
});

for (const body of [{ code: "voice_sdp_offer_required" }, { message: "voice_sdp_offer_required" }, { detail: "voice_sdp_offer_required" }]) {
  test(`HTTP voice errors retain the ${Object.keys(body)[0]} field and status`, async () => {
    await assert.rejects(readRealtimeVoiceCall(Response.json(body, { status: 400 })), error => {
      assert.equal(error.status, 400);
      assert.equal(error.code, "voice_sdp_offer_required");
      assert.match(realtimeVoiceFailureHint(error, "fallback"), /voice_sdp_offer_required/);
      return true;
    });
  });
}

test("raw provider errors and credentials never reach the voice hint", async () => {
  for (const body of [{ message: "provider failure with sk-proj-sensitive and buyer@example.test" }, { error: { message: "private text" } }]) {
    await assert.rejects(readRealtimeVoiceCall(Response.json(body, { status: 502 })), error => {
      assert.equal(error.code, "voice_session_failed");
      assert.doesNotMatch(realtimeVoiceFailureHint(error, "fallback"), /sk-proj|buyer@|private text/);
      return true;
    });
  }
});

test("shared interaction quota retains useful voice guidance", async () => {
  await assert.rejects(readRealtimeVoiceCall(Response.json({ code: "ai_interaction_rate_limited" }, { status: 429 })), error => {
    assert.match(realtimeVoiceFailureHint(error, "fallback"), /limite de interações por minuto/);
    return true;
  });
});
