import assert from "node:assert/strict";
import test from "node:test";
import { MetaInboundMediaAdapter } from "./meta-inbound-media.adapter.js";

const bytes = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("OpusHead"), Buffer.alloc(32)]);
const context = { inboxId: "inbox-1", conversationId: "conversation" };
function fixture(t: any, options: any = {}) {
  const calls: any[] = [], transcripts: any[] = [];
  const config = { id: "config", merchantId: "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "unit-meta-secret", phoneNumberId: "1234567", wabaId: "7654321" } };
  t.mock.method(globalThis, "fetch", async (url: string) => {
    calls.push(url);
    if (calls.length === 1) return new Response(JSON.stringify({ url: options.url ?? "https://lookaside.fbsbx.com/voice",
      mime_type: options.mime === undefined ? "audio/ogg; codecs=opus" : options.mime,
      file_size: options.size ?? bytes.length }), { status: 200 });
    return new Response(options.bytes ?? bytes, { status: options.httpStatus ?? 200 });
  });
  const audio = { interpret: async (input: unknown) => { transcripts.push(input); return "ANEXO NÃO CONFIÁVEL: transcrição\nQuero dois kits."; } };
  const adapter = new MetaInboundMediaAdapter({ findById: async () => options.foreign ? { ...config, merchantId: "foreign" } : config } as never,
    { interpret: async () => assert.fail("audio must not be sent to image vision") } as never, audio as never);
  return { adapter, calls, transcripts };
}

test("an authenticated Ogg/Opus download reaches transcription with private canonical scope", async t => {
  const f = fixture(t);
  const result = await f.adapter.interpret("merchant", "META_CLOUD:config", { id: "123456", mimeType: "audio/ogg" }, context);
  assert.match(result ?? "", /transcrição/); assert.equal(f.calls.length, 2); assert.equal(f.transcripts.length, 1);
  const input = f.transcripts[0]; assert.equal(input.merchantId, "merchant"); assert.equal(input.inboxId, "inbox-1");
  assert.equal(input.conversationId, "conversation"); assert.equal(input.mediaId, "123456"); assert.equal(input.mimeType, "audio/ogg");
  assert.deepEqual(input.bytes, bytes); assert.equal(input.url, undefined); assert.equal(input.apiKey, undefined);
});

for (const [name, options, scope] of [
  ["foreign merchant", { foreign: true }, context], ["missing authenticated context", {}, undefined],
  ["missing MIME", { mime: null }, context], ["generic MIME", { mime: "application/octet-stream" }, context],
  ["oversize", { size: 3 * 1024 * 1024 + 1 }, context], ["foreign media host", { url: "https://evil.example/voice" }, context],
  ["negative metadata size", { size: -1 }, context], ["fractional metadata size", { size: 1.5 }, context],
  ["stream exceeds the limit", { bytes: Buffer.alloc(3 * 1024 * 1024 + 1) }, context],
  ["empty download", { bytes: Buffer.alloc(0) }, context], ["incomplete download", { bytes: bytes.subarray(0, 40) }, context],
  ["incompatible bytes", { bytes: Buffer.from("not an Ogg voice note") }, context], ["download error", { httpStatus: 500 }, context],
] as const) test(`${name} never calls transcription`, async t => {
  const f = fixture(t, options);
  const result = await f.adapter.interpret("merchant", "META_CLOUD:config", { id: "123456", mimeType: "audio/ogg" }, scope);
  assert.equal(result, undefined); assert.equal(f.transcripts.length, 0);
});
