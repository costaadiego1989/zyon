import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ResendEmailAdapter } from "./resend-email.adapter.js";
import { Logger } from "@nestjs/common";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";

const originalFetch = globalThis.fetch;
const originalKey = process.env.RESEND_API_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
});
const input = { to: "owner@example.test", subject: "Estado do template", html: "<p>Aprovado</p>", requireDelivery: true };

test("strict email has no simulated success or network call without configuration", async () => {
  delete process.env.RESEND_API_KEY;
  globalThis.fetch = async () => { throw new Error("unexpected network call"); };
  assert.deepEqual(await new ResendEmailAdapter().send(input), { status: "skipped", messageId: "" });
});

test("legacy email retains development fallback", async () => {
  delete process.env.RESEND_API_KEY;
  const result = await new ResendEmailAdapter().send({ ...input, requireDelivery: undefined });
  assert.equal(result.status, "queued");
  assert.match(result.messageId, /^dev-/);
});

test("strict email uses bounded provider call and requires real acceptance ID", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.resend.com/emails");
    assert.ok(init?.signal instanceof AbortSignal);
    const payload = JSON.parse(String(init.body));
    assert.equal(payload.to, input.to);
    assert.equal(payload.requireDelivery, undefined);
    return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
  };
  assert.deepEqual(await new ResendEmailAdapter().send(input), { status: "sent", messageId: "provider-1" });
});

test("provider receives a single readable subject even when dynamic text contains control characters", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.subject, "Loja Teste | Pedido #1001 confirmado");
    return new Response(JSON.stringify({ id: "provider-1" }), { status: 200 });
  };
  await new ResendEmailAdapter().send({ ...input, subject: "Loja\r\n\u0000Teste\u202e | Pedido #1001 confirmado" });
});

for (const id of [undefined, null, "", "   ", 123]) {
  test(`strict email rejects missing or invalid ID ${String(id)}`, async () => {
    process.env.RESEND_API_KEY = "fake-test-key";
    globalThis.fetch = async () => new Response(JSON.stringify({ id }), { status: 200 });
    await assert.rejects(new ResendEmailAdapter().send(input), /acceptance unknown/);
  });
}

test("strict email propagates timeout without retrying provider", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new DOMException("timeout", "TimeoutError"); };
  await assert.rejects(new ResendEmailAdapter().send(input), /timeout/);
  assert.equal(calls, 1);
});

test("strict delivery logs neither recipient nor raw provider errors and keeps explicit rejection proof", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  const originalError=Logger.prototype.error, logs:unknown[][]=[];
  Logger.prototype.error=function(...args:unknown[]){logs.push(args);};
  try {
    globalThis.fetch=async()=>new Response(JSON.stringify({error:"PRIVATE KEY recipient@example.test"}),{status:429});
    await assert.rejects(new ResendEmailAdapter().send(input),e=>e instanceof EmailProviderRejection&&e.retryable);
    globalThis.fetch=async()=>{throw Error("transport PRIVATE KEY recipient@example.test");};
    await assert.rejects(new ResendEmailAdapter().send(input));
    assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|recipient@|owner@|fake-test-key/);
    assert.deepEqual(logs,[["strict_email_provider_rejected"],["strict_email_acceptance_unknown"]]);
  }finally{Logger.prototype.error=originalError;}
});

test("provider receives plain text and inline logo content with the REST content_id field", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.equal(payload.text, "Mensagem da loja");
    assert.deepEqual(payload.attachments, [{ filename: "logo.png", content: "aGVsbG8=", content_type: "image/png", content_id: "store-logo" }]);
    return new Response(JSON.stringify({ id: "provider-logo" }), { status: 200 });
  };
  const result = await new ResendEmailAdapter().send({ ...input, text: "Mensagem da loja", html: '<img src="cid:store-logo">',
    attachments: [{ filename: "logo.png", content: "aGVsbG8=", contentType: "image/png", contentId: "store-logo" }] });
  assert.equal(result.messageId, "provider-logo");
});
