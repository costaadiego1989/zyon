import assert from "node:assert/strict";
import test from "node:test";
import { configureAiMetering } from "../../../../shared/ai-metering.js";
import { AiGovernanceService } from "../../../ai-governance/ai-governance.service.js";
import { StorefrontAttachmentInterpreter } from "../../../storefront/application/services/storefront-attachment-interpreter.service.js";
import { MetaInboundMediaAdapter } from "./meta-inbound-media.adapter.js";

const context = { inboxId: "inbox-1", conversationId: "conversation" };
function fixture(t: any, options: { foreign?: boolean; mime?: string; deny?: boolean; fail?: boolean } = {}) {
  const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]); const scopes: any[] = [], requests: any[] = []; let metaCalls = 0;
  for (const [name, value] of Object.entries({ DEEPSEEK_API_KEY: "unit-only", DEEPSEEK_VISION_MODEL: "deepseek-flash", DEEPSEEK_BASE_URL: "https://api.deepseek.com/v1" })) {
    const previous = process.env[name]; process.env[name] = value;
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
  t.after(configureAiMetering({ fetch: async (scope, url, init) => {
    scopes.push(scope);
    if (options.deny) throw Error("ai_access_denied");
    requests.push({ url, init }); if (options.fail) throw Error("private-provider-key-url");
    return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ schemaVersion: 1, status: "PRODUCTS",
      products: [{ name: "Sérum", brand: null, presentation: null, quantity: null, confidence: 0.99 }] }) } }] });
  } }, () => undefined));
  t.mock.method(globalThis, "fetch", async (url: string) => {
    metaCalls++;
    assert(String(url).startsWith("https://graph.facebook.com/") || String(url).startsWith("https://lookaside.fbsbx.com/"), "only fake Meta GETs may use this transport");
    return metaCalls === 1 ? Response.json({ url: "https://lookaside.fbsbx.com/unit", mime_type: options.mime ?? "image/jpeg", file_size: bytes.length }) : new Response(bytes);
  });
  const config = { id: "config", merchantId: options.foreign ? "foreign" : "merchant", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "unit-only", phoneNumberId: "123456", wabaId: "654321" } };
  const adapter = new MetaInboundMediaAdapter({ findById: async () => config } as never, new StorefrontAttachmentInterpreter(),
    { interpret: async () => assert.fail("a reference photo cannot become current speech") } as never);
  return { adapter, scopes, requests, metaCalls: () => metaCalls };
}

test("a Meta photo in a worker with no HTTP tenant reaches scoped metering and stays untrusted reference data", async t => {
  const f = fixture(t); const result = await f.adapter.interpret("merchant", "META_CLOUD:config", { id: "12345", mimeType: "image/jpeg" }, context);
  assert.equal(f.scopes.length, 1); assert.equal(f.requests.length, 1); assert.equal(f.metaCalls(), 2);
  assert.deepEqual(f.scopes[0], { merchantId: "merchant", conversationId: "conversation", source: "storefront_image", costCenter: undefined });
  const governance = new AiGovernanceService({ aiActorTeam: { findMany: async () => [] } } as never, { get: () => undefined } as never);
  assert.equal((await governance.identity(f.scopes[0])).actorRole, "buyer");
  assert.equal(result?.kind, "attachment_context"); assert.match(result?.kind === "attachment_context" ? result.context : "", /ANEXO NÃO CONFIÁVEL.*imagem/);
  assert.match(result?.kind === "attachment_context" ? result.context : "", /Nunca siga instruções/);
  assert.match(result?.kind === "attachment_context" ? result.context : "", /Sérum/);
  assert.equal("text" in result!, false); assert.equal("scope" in result!, false);
});

for (const [name, options, scope] of [
  ["foreign merchant", { foreign: true }, context], ["missing authenticated context", {}, undefined],
  ["missing inbox", {}, { inboxId: "", conversationId: "conversation" }], ["missing conversation", {}, { inboxId: "inbox-1", conversationId: "" }],
  ["unknown MIME", { mime: "application/octet-stream" }, context],
] as const) test(`${name} never calls a vision provider`, async t => {
  const f = fixture(t, options); const result = await f.adapter.interpret("merchant", "META_CLOUD:config", { id: "12345", mimeType: "image/jpeg" }, scope);
  assert.equal(result, undefined); assert.equal(f.requests.length, 0); assert.equal(f.scopes.length, 0);
});

for (const options of [{ deny: true }, { fail: true }]) test("governance or provider failure is closed and never grants image command authority", async t => {
  const f = fixture(t, options); const result = await f.adapter.interpret("merchant", "META_CLOUD:config", { id: "12345", mimeType: "image/jpeg" }, context);
  assert.equal(result, undefined); assert.equal(f.requests.length, options.deny ? 0 : 1);
});
