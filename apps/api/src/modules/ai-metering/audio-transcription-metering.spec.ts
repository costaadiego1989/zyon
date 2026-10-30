import assert from "node:assert/strict";
import test from "node:test";
import { AiMeteringService } from "./ai-metering.service.js";

const usage = { input_tokens: 100, output_tokens: 20, total_tokens: 120, input_token_details: { audio_tokens: 100 } };
const key = "whatsapp-audio:" + "a".repeat(64);
function fixture(options: { price?: boolean; deny?: boolean; persistFailure?: boolean; completeFailure?: boolean } = {}) {
  const rows = new Map<string, any>(); const creates: any[] = []; let external = 0;
  const db = {
    merchant: { findUnique: async ({ where }: any) => where.id === "foreign" ? null : ({ id: where.id, billingAccountMerchantId: "billing-account" }) },
    aiPriceVersion: { findFirst: async () => options.price === false ? null : ({ rates: { input: "1250000", output: "5000000" }, currency: "USD", version: "fixture" }) },
    aiUsageEvent: {
      create: async ({ data }: any) => {
        if (options.persistFailure) throw Error("storage unavailable");
        if ([...rows.values()].some(row => row.idempotencyKey === data.idempotencyKey)) throw Object.assign(Error("duplicate"), { code: "P2002" });
        const row = { id: `event-${rows.size}`, usageKnown: false, costStatus: "unpriced", ...data };
        rows.set(row.id, row); creates.push(data); return row;
      },
      findUnique: async ({ where }: any) => rows.get(where.id),
      update: async ({ where, data }: any) => {
        if (options.completeFailure) throw Error("completion unavailable");
        const row = { ...rows.get(where.id), ...data }; rows.set(where.id, row); return row;
      },
    },
  };
  const authorizations: any[] = [];
  const governance = { authorize: async (...args: any[]) => { authorizations.push(args); if (options.deny) throw Error("model_denied"); return { actorId: "buyer-fixture", actorRole: "buyer" }; } };
  const meter = new AiMeteringService(db as never, {} as never, null, governance as never);
  const request = (overrides: any = {}) => {
    const body = new FormData(); body.set("model", "gpt-4o-mini-transcribe"); body.set("response_format", "json");
    body.set("file", new Blob(["private-audio-bytes"], { type: "audio/ogg" }), "voice.ogg");
    return meter.fetchTranscription({ merchantId: "merchant", conversationId: "conversation", source: "voice_whatsapp_audio", costCenter: "voice", ...overrides.context },
      overrides.url ?? "https://api.openai.com/v1/audio/transcriptions", { method: "POST", headers: { Authorization: "Bearer private-unit-key" }, body, ...overrides.init },
      { model: "gpt-4o-mini-transcribe", idempotencyKey: key, ...overrides.admission }, async () => {
        external++; if (overrides.error) throw overrides.error;
        return overrides.response ?? Response.json({ id: "provider-id", text: "private-transcript", usage: { ...usage, transcript: "private-transcript" } });
      });
  };
  return { meter, rows, creates, authorizations, request, calls: () => external };
}

test("audio measures the scoped physical request without retaining private content or replacing its permanent claim", async () => {
  const f = fixture(); const response = await f.request(); assert.equal(response.ok, true); assert.equal(f.calls(), 1);
  const row = [...f.rows.values()][0]; assert.equal(row.merchantId, "merchant"); assert.equal(row.billingAccountId, "billing-account");
  assert.equal(row.conversationId, "conversation"); assert.equal(row.channel, "voice"); assert.equal(row.component, "transcription");
  assert.equal(row.usageKnown, true); assert.equal(row.costMicros, 225n); assert.equal(row.costStatus, "estimated");
  assert.equal(row.executionStatus, "succeeded"); assert.equal(row.idempotencyKey, key); assert.equal(row.providerEventId, undefined);
  assert.deepEqual(f.authorizations[0].slice(1), ["model", "openai:gpt-4o-mini-transcribe"]);
  const ledger = JSON.stringify(row, (_, value) => typeof value === "bigint" ? String(value) : value);
  for (const secret of ["private-transcript", "private-audio-bytes", "private-unit-key", "api.openai.com", "provider-id"]) assert(!ledger.includes(secret));
  await assert.rejects(f.request(), /already_attempted/); assert.equal(f.calls(), 1);
});

test("concurrent duplicates atomically admit exactly one paid request", async () => {
  const f = fixture(); const result = await Promise.allSettled([f.request(), f.request()]);
  assert.equal(result.filter(x => x.status === "fulfilled").length, 1); assert.equal(f.calls(), 1); assert.equal(f.rows.size, 1);
});

for (const [name, options, overrides, code] of [
  ["governance denial", { deny: true }, {}, /model_denied/],
  ["missing pricing", { price: false }, {}, /pricing_unavailable/],
  ["missing merchant", {}, { context: { merchantId: "foreign" } }, /company_not_found/],
  ["missing conversation", {}, { context: { conversationId: "" } }, /scope_invalid/],
  ["invalid permanent key", {}, { admission: { idempotencyKey: "client-key" } }, /scope_invalid/],
  ["unbound model", {}, { admission: { model: "different-model" } }, /scope_invalid/],
  ["insecure endpoint", {}, { url: "http://api.openai.com/v1/audio/transcriptions" }, /scope_invalid/],
  ["persistence unavailable", { persistFailure: true }, {}, /storage unavailable/],
] as const) test(`${name} prevents a physical audio request`, async () => {
  const f = fixture(options); await assert.rejects(f.request(overrides), code); assert.equal(f.calls(), 0); assert.equal(f.rows.size, 0);
});

test("timeout persists unknown and a duplicate cannot retry the paid request", async () => {
  const f = fixture(); await assert.rejects(f.request({ error: Error("sensitive provider URL") }), /^Error: audio_transcription_provider_unavailable$/);
  assert.equal([...f.rows.values()][0].executionStatus, "unknown");
  await assert.rejects(f.request(), /already_attempted/); assert.equal(f.calls(), 1);
});

for (const [status, expected] of [[400, "rejected"], [408, "unknown"], [429, "rejected"], [500, "unknown"]] as const)
  test(`HTTP ${status} is recorded ${expected} without permitting a replay`, async () => {
    const f = fixture(); const response = await f.request({ response: new Response("provider-private-error", { status }) });
    assert.equal(response.status, status); assert.equal([...f.rows.values()][0].executionStatus, expected);
    await assert.rejects(f.request(), /already_attempted/); assert.equal(f.calls(), 1);
  });

for (const response of [Response.json({ text: "private-transcript" }), Response.json({ usage: { input_tokens: -1, output_tokens: 0 } }), new Response("invalid JSON")])
  test("unconfirmed provider usage fails honestly and keeps the permanent attempt", async () => {
    const f = fixture(); await assert.rejects(f.request({ response }), /metering_unconfirmed/);
    assert.equal([...f.rows.values()][0].usageKnown, false); await assert.rejects(f.request(), /already_attempted/); assert.equal(f.calls(), 1);
  });

test("a completion outage cannot release an unmetered transcript or a second physical request", async () => {
  const f = fixture({ completeFailure: true }); await assert.rejects(f.request(), /metering_unconfirmed/);
  assert.equal([...f.rows.values()][0].usageKnown, false); await assert.rejects(f.request(), /already_attempted/); assert.equal(f.calls(), 1);
});
