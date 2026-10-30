import "reflect-metadata";
import assert from "node:assert/strict";
import test from "node:test";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { MetaAudioTranscriptionService, MAX_META_AUDIO_BYTES } from "./meta-audio-transcription.service.js";
import { BillingPlanMeteringService } from "../../../payment/infrastructure/billing/billing-plan-guard.js";
import { AiMeteringService } from "../../../ai-metering/ai-metering.service.js";
import { AiGovernanceService } from "../../../ai-governance/ai-governance.service.js";

const bytes = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("OpusHead"), Buffer.alloc(32)]);
const input = { merchantId: "merchant", conversationId: "conversation", inboxId: "inbox-1", mediaId: "12345", mimeType: "audio/ogg", bytes };
function fixture(t: any, options: any = {}) {
  for (const [name, value] of Object.entries({ OPENAI_API_KEY: "unit-server-key", OPENAI_BASE_URL: "https://api.openai.com/v1", OPENAI_TRANSCRIPTION_MODEL: "gpt-4o-mini-transcribe", WHATSAPP_AUDIO_TRANSCRIPTION_ENABLED: "true", ...options.env })) {
    const previous = process.env[name]; process.env[name] = String(value);
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  const admissions: any[] = [], requests: any[] = [];
  const billing = { admitVoiceSession: async (...args: unknown[]) => { admissions.push(args); if (options.denied) throw Error("voice_plan_denied"); } };
  const metering = { fetchTranscription: async (...args: any[]) => { requests.push(args); if (options.error) throw options.error;
    return options.response ?? Response.json({ text: "Quero dois kits; não pague nem adicione nada." }); } };
  return { admissions, requests, service: new MetaAudioTranscriptionService(billing as never, metering as never) };
}

test("a completed voice file uses server multipart credentials and returns only the current spoken text", async t => {
  const f = fixture(t); const context = await f.service.interpret(input);
  assert.equal(context, "Quero dois kits; não pague nem adicione nada.");
  const [scope, url, request, claim] = f.requests[0];
  assert.deepEqual(scope, { merchantId: "merchant", conversationId: "conversation", source: "voice_whatsapp_audio", costCenter: "voice" });
  const governance = new AiGovernanceService({ aiActorTeam: { findMany: async () => [] } } as never, { get: () => undefined } as never);
  assert.equal((await governance.identity({ ...scope, costCenter: "voice" })).actorRole, "buyer", "a webhook without HTTP tenant context must not become a service/admin actor");
  assert.equal(url, "https://api.openai.com/v1/audio/transcriptions"); assert.equal(request.headers.Authorization, "Bearer unit-server-key");
  assert.equal(request.redirect, "error"); assert(request.signal instanceof AbortSignal); assert.equal(request.body.get("model"), "gpt-4o-mini-transcribe");
  assert.equal(request.body.get("language"), "pt"); assert.equal(request.body.get("response_format"), "json");
  const file = request.body.get("file"); assert.equal(file.name, "voice.ogg"); assert.equal(file.type, "audio/ogg");
  assert.deepEqual(Buffer.from(await file.arrayBuffer()), bytes); assert.match(claim.idempotencyKey, /^whatsapp-audio:[a-f0-9]{64}$/);
  assert.deepEqual(f.admissions, [["merchant", claim.idempotencyKey]]);
});

test("permanent claims are stable for one inbox and distinct across tenant/inbox/media", async t => {
  const f = fixture(t);
  for (const variant of [input, input, { ...input, merchantId: "merchant-2" }, { ...input, inboxId: "inbox-2" }, { ...input, mediaId: "23456" }]) await f.service.interpret(variant);
  const keys = f.requests.map(row => row[3].idempotencyKey); assert.equal(keys[0], keys[1]); assert.equal(new Set(keys).size, 4);
});

for (const [name, variant] of [
  ["missing merchant", { merchantId: "" }], ["missing conversation", { conversationId: "" }], ["invalid inbox", { inboxId: "../inbox" }],
  ["invalid media", { mediaId: "https://client.example/audio" }], ["generic MIME", { mimeType: "application/octet-stream" }],
  ["empty file", { bytes: Buffer.alloc(0) }], ["oversize file", { bytes: Buffer.alloc(MAX_META_AUDIO_BYTES + 1) }],
  ["incompatible bytes", { bytes: Buffer.from("not Ogg Opus") }],
] as const) test(`${name} cannot enter billing or provider transport`, async t => {
  const f = fixture(t); await assert.rejects(f.service.interpret({ ...input, ...variant }), /input_invalid/);
  assert.equal(f.admissions.length, 0); assert.equal(f.requests.length, 0);
});

for (const [name, env, code] of [
  ["missing server key", { OPENAI_API_KEY: "" }, /unavailable/], ["explicit kill switch", { WHATSAPP_AUDIO_TRANSCRIPTION_ENABLED: "false" }, /unavailable/],
  ["HTTP provider", { OPENAI_BASE_URL: "http://provider.example/v1" }, /provider_invalid/],
  ["URL credentials", { OPENAI_BASE_URL: "https://user:secret@provider.example/v1" }, /provider_invalid/],
] as const) test(`${name} prevents admission and provider calls`, async t => {
  const f = fixture(t, { env }); await assert.rejects(f.service.interpret(input), code); assert.equal(f.requests.length, 0); assert.equal(f.admissions.length, 0);
});

test("a merchant without voice entitlement cannot send audio for transcription", async t => {
  const f = fixture(t, { denied: true }); await assert.rejects(f.service.interpret(input), /voice_plan_denied/); assert.equal(f.requests.length, 0);
});

for (const response of [Response.json({ text: " " }), Response.json({ text: "a".repeat(4001) }), Response.json({ unexpected: "schema" }), new Response("malformed"), new Response("private error", { status: 500 })])
  test("invalid or failed provider output never becomes commerce context", async t => {
    const f = fixture(t, { response }); await assert.rejects(f.service.interpret(input)); assert.equal(f.requests.length, 1);
  });

test("transport uncertainty is returned to the adapter instead of being retried", async t => {
  const f = fixture(t, { error: Error("audio_transcription_provider_unavailable") });
  await assert.rejects(f.service.interpret(input), /provider_unavailable/); assert.equal(f.requests.length, 1);
});

test("Nest resolves the production audio service using the exported billing and metering tokens", async t => {
  const f = fixture(t);
  class AudioBindingModule {}
  Module({ providers: [MetaAudioTranscriptionService,
    { provide: BillingPlanMeteringService, useValue: { admitVoiceSession: async (...args: unknown[]) => { f.admissions.push(args); } } },
    { provide: AiMeteringService, useValue: { fetchTranscription: async (...args: unknown[]) => { f.requests.push(args); return Response.json({ text: "Procuro um kit." }); } } },
  ] })(AudioBindingModule);
  const module = await NestFactory.createApplicationContext(AudioBindingModule, { logger: false });
  try { assert.match(await module.get(MetaAudioTranscriptionService).interpret(input), /Procuro um kit/); assert.equal(f.admissions.length, 1); assert.equal(f.requests.length, 1); }
  finally { await module.close(); }
});
