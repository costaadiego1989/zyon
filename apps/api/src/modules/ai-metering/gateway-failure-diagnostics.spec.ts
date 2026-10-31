import assert from "node:assert/strict";
import test from "node:test";
import { AiMeteringService } from "./ai-metering.service.js";

function fixture(queuedCompletion = false) {
  let row: any; let unavailable = queuedCompletion; let calls = 0; const queue: string[] = [];
  const create = async ({ data }: any) => {
    if (row) throw Object.assign(Error("duplicate"), { code: "P2002" });
    row = { id: "event", usageKnown: false, costStatus: "unpriced", metadata: { existing: true }, ...data }; return row;
  };
  const db = { merchant: { findUnique: async () => ({ id: "merchant" }) },
    aiPriceVersion: { findFirst: async () => ({ rates: { input: "1250000", output: "5000000" }, currency: "USD", version: "fixture" }) },
    aiUsageEvent: { create, upsert: async ({ create: data }: any) => create({ data }), findUnique: async () => row,
      update: async ({ data }: any) => { if (unavailable) throw Error("temporary storage outage"); row = { ...row, ...Object.fromEntries(Object.entries(data).filter(([, value]) => value !== undefined)) }; return row; } } };
  const meter = new AiMeteringService(db as never, {} as never, { zadd: async (_: string, _time: number, value: string) => { queue.push(value); } } as never,
    { authorize: async () => ({ actorRole: "buyer" }) } as never);
  const request = async (response: Response, voice = false) => {
    const transport: typeof fetch = async () => { calls++; return response; };
    const context = { merchantId: "merchant", conversationId: "conversation", source: voice ? "voice_whatsapp_audio" : "storefront_image" };
    if (!voice) return meter.fetch(context, "https://api.openai.com/v1/chat/completions", {
      method: "POST", headers: { Authorization: "Bearer private-fixture-key" }, body: JSON.stringify({ model: "gpt-4o-mini" }) }, transport);
    const form = new FormData(); form.set("model", "gpt-4o-mini-transcribe"); form.set("response_format", "json"); form.set("file", new Blob(["private-audio-bytes"]), "voice.ogg");
    return meter.fetchTranscription(context, "https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer private-fixture-key" }, body: form },
      { model: "gpt-4o-mini-transcribe", idempotencyKey: "whatsapp-audio:" + "a".repeat(64) }, transport);
  };
  return { meter, request, queue, row: () => row, calls: () => calls, restoreStorage: () => { unavailable = false; } };
}

for (const voice of [false, true]) test(`${voice ? "STT" : "JSON vision/chat"} rejection persists only safe gateway diagnostics`, async () => {
  const f = fixture(); const response = await f.request(Response.json({ error: { code: "invalid_api_key", message: "private-fixture-key private-transcript https://private.example", param: "private-param" } }, { status: 401 }), voice);
  assert.equal(response.status, 401); assert.equal((await response.json()).error.param, "private-param", "diagnostics must not consume the caller response");
  assert.equal(f.row().executionStatus, "rejected"); assert.equal(f.row().usageKnown, false); assert.equal(f.row().costStatus, "unpriced");
  assert.deepEqual(f.row().metadata, { existing: true, gatewayFailure: { httpStatus: 401, errorCode: "invalid_api_key" } });
  const ledger = JSON.stringify(f.row()); for (const secret of ["private-fixture-key", "private-transcript", "private.example", "private-param", "private-audio-bytes"]) assert(!ledger.includes(secret));
  assert.equal(f.calls(), 1);
});

for (const response of [Response.json({ error: { code: "private_identifier_123", message: "private-body" } }, { status: 400 }), new Response("private-non-json-error", { status: 400 })])
  test("unknown error codes and raw error bodies are omitted", async () => {
    const f = fixture(); await f.request(response);
    assert.deepEqual(f.row().metadata, { existing: true, gatewayFailure: { httpStatus: 400 } }); assert.equal(f.calls(), 1);
  });

test("safe rejection diagnostics survive a durable completion retry without a new provider request", async () => {
  const f = fixture(true); await f.request(Response.json({ error: { code: "insufficient_quota", message: "private-body" } }, { status: 429 }), true);
  assert.equal(f.queue.length, 1); const pending = JSON.parse(f.queue[0]!);
  assert.deepEqual(pending.gatewayFailure, { httpStatus: 429, errorCode: "insufficient_quota" }); assert(!f.queue[0]!.includes("private-body"));
  f.restoreStorage(); await f.meter.complete(pending);
  assert.deepEqual(f.row().metadata.gatewayFailure, pending.gatewayFailure); assert.equal(f.row().executionStatus, "rejected"); assert.equal(f.calls(), 1);
});

test("a gateway server error remains unknown and does not become zero-cost success", async () => {
  const f = fixture(); await f.request(Response.json({ error: { code: "server_error" } }, { status: 503 }), true);
  assert.equal(f.row().executionStatus, "unknown"); assert.equal(f.row().usageKnown, false); assert.equal(f.row().costStatus, "unpriced");
  assert.deepEqual(f.row().metadata.gatewayFailure, { httpStatus: 503, errorCode: "server_error" }); assert.equal(f.calls(), 1);
});
