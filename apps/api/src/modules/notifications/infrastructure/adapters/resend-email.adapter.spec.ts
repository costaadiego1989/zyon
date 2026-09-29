import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { ResendEmailAdapter } from "./resend-email.adapter.js";
import { MERCHANT_EMAIL_FOOTER_SLOT, MERCHANT_EMAIL_HEADER_SLOT } from "../../../../shared/email/merchant-email-branding.js";

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

test("merchant email sends logo, CNPJ and configured social links through Resend", async () => {
  process.env.RESEND_API_KEY = "fake-test-key";
  globalThis.fetch = async (_url, init) => {
    const payload = JSON.parse(String(init?.body));
    assert.match(payload.html, /brand-logo\.png/);
    assert.match(payload.html, /CNPJ: 12\.345\.678\/0001-90/);
    assert.match(payload.html, /instagram\.com\/brand/);
    assert.doesNotMatch(payload.html, /javascript:/);
    return new Response(JSON.stringify({ id: "provider-brand" }), { status: 200 });
  };
  const prisma = {
    merchant: {
      findUnique: async ({ where }: { where: { id: string } }) => {
        assert.equal(where.id, "mrc_brand");
        return {
          name: "Loja Brand",
          theme: { logoUrl: "https://cdn.example.test/brand-logo.png" },
          storeSettings: {
            company: { cnpj: "12.345.678/0001-90" },
            social: { instagram: "https://instagram.com/brand", linkedin: "javascript:alert(1)" },
          },
        };
      },
    },
  } as never;
  const output = await new ResendEmailAdapter(prisma).send({
    ...input,
    merchantId: "mrc_brand",
    html: `<body>${MERCHANT_EMAIL_HEADER_SLOT}<p>Mensagem</p>${MERCHANT_EMAIL_FOOTER_SLOT}</body>`,
  });
  assert.deepEqual(output, { status: "sent", messageId: "provider-brand" });
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
