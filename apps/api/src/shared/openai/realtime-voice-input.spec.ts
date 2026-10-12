import assert from "node:assert/strict";
import test from "node:test";
import { RealtimeVoiceInput, RealtimeVoiceResponses } from "@zyon/shared-types";

test("noise, breathing, empty and failed recognition never request a voice turn", () => {
  const input = new RealtimeVoiceInput();
  for (const [i, transcript] of ["", "...", "[respiração]", "(ruído)", "[inaudível]", "Silêncio"].entries()) {
    assert.equal(input.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: `noise-${i}`, transcript })?.kind, "noise");
  }
  assert.equal(input.receive({ type: "conversation.item.input_audio_transcription.failed", item_id: "failed" })?.kind, "failed");
});

test("very short audio spikes are ignored, while short confirmations and numbers work once", () => {
  const input = new RealtimeVoiceInput();
  input.receive({ type: "input_audio_buffer.speech_started", item_id: "spike", audio_start_ms: 0 });
  input.receive({ type: "input_audio_buffer.speech_stopped", item_id: "spike", audio_end_ms: 80 });
  assert.equal(input.receive({ type: "conversation.item.input_audio_transcription.completed", item_id: "spike", transcript: "Sim" })?.kind, "noise");
  for (const [i, transcript] of ["Sim", "Não", "Pix", "50", "01310100", "Quero trocar para cartão"].entries()) {
    const event = { type: "conversation.item.input_audio_transcription.completed", item_id: `speech-${i}`, transcript };
    assert.equal(input.receive(event)?.kind, "speech");
    assert.equal(input.receive(event), undefined);
  }
});

test("responses queue until the previous response finishes, and only accepted speech interrupts", () => {
  const sent: string[] = [];
  const responses = new RealtimeVoiceResponses(event => sent.push(String(event.type)));
  responses.request(); responses.receive("response.created"); responses.receive("output_audio_buffer.started");
  assert.deepEqual(sent, ["response.create"]);
  responses.request(true);
  assert.deepEqual(sent, ["response.create", "response.cancel", "output_audio_buffer.clear"]);
  responses.receive("response.done");
  assert.equal(sent.at(-1), "response.create");
  responses.request(); responses.request();
  responses.receive("response.done");
  assert.equal(sent.filter(type => type === "response.create").length, 3);
});
