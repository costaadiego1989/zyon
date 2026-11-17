import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { MetaCloudTemplateAdapter } from "./meta-cloud-template.adapter.js";
import type { WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";

describe("Meta Cloud template submission", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });
  const input = {
    merchantId: "merchant-1", friendlyName: "merchant-1_cart_recovery", language: "pt_BR", category: "MARKETING",
    metaBody: "Olá {{1}}, retome em {{2}}", sampleVariables: { "1": "Ana", "2": "https://store.test/recover" },
  };
  const configs = {
    async findByMerchantId() {
      return {
        id: "cfg", merchantId: input.merchantId, enabled: true, provider: "META_CLOUD", status: "ACTIVE",
        credentials: { accessToken: "merchant-token", wabaId: "123456789", phoneNumberId: "987654321" },
        createdAt: new Date(), updatedAt: new Date(),
      };
    },
  } as unknown as WhatsAppConfigRepository;

  test("submits a deterministic Meta template name with positional body examples", async () => {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      return Response.json({ id: "template-id", status: "PENDING" });
    }) as typeof fetch;
    const result = await new MetaCloudTemplateAdapter(configs).createAndSubmit(input);
    assert.equal(result.status, "submitted");
    assert.match(result.contentSid, /^zyon_merchant_1_cart_recovery_[a-f0-9]{10}$/);
    assert.equal(requests[0]?.url, "https://graph.facebook.com/v23.0/123456789/message_templates");
    assert.equal(new Headers(requests[0]?.init?.headers).get("Authorization"), "Bearer merchant-token");
    const body = JSON.parse(String(requests[0]?.init?.body));
    assert.equal(body.name, result.contentSid);
    assert.deepEqual(body.components, [{ type: "BODY", text: input.metaBody, example: { body_text: [["Ana", "https://store.test/recover"]] } }]);
  });

  test("authentication uses Meta's preset, expiration and copy-code button instead of a utility text body", async () => {
    let sent: any;
    globalThis.fetch = (async (_url, init) => { sent = JSON.parse(String(init?.body)); return Response.json({ status: "PENDING" }); }) as typeof fetch;
    await new MetaCloudTemplateAdapter(configs).createAndSubmit({ ...input, category: "AUTHENTICATION", metaBody: "{{1}} é seu código de verificação.", sampleVariables: { "1": "123456" } });
    assert.equal(sent.category, "AUTHENTICATION");
    assert.deepEqual(sent.components, [{ type: "BODY", add_security_recommendation: true }, { type: "FOOTER", code_expiration_minutes: 10 },
      { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] }]);
  });

  test("authentication reconciliation accepts provider-generated wording but fences category and OTP button", async () => {
    const native = { name: "zyon_auth", status: "APPROVED", language: "pt_BR", category: "AUTHENTICATION", components: [
      { type: "BODY", text: "{{1}} é seu código de verificação. Não compartilhe este código." },
      { type: "BUTTONS", buttons: [{ type: "URL", url: "https://www.whatsapp.com/otp/code/?otp_type=COPY_CODE&code=otp{{1}}" }] } ] };
    const expected = { language: "pt_BR", category: "AUTHENTICATION", body: "Texto local para prévia {{1}}" };
    globalThis.fetch = (async () => Response.json({ data: [native] })) as typeof fetch;
    assert.equal((await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_auth", expected)).status, "approved");
    globalThis.fetch = (async () => Response.json({ data: [{ ...native, category: "UTILITY" }] })) as typeof fetch;
    assert.equal((await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_auth", expected)).rejectionReason, "template_category_mismatch");
    globalThis.fetch = (async () => Response.json({ data: [{ ...native, components: [{ type: "BODY", text: "{{1}} código" }] }] })) as typeof fetch;
    assert.equal((await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_auth", expected)).rejectionReason, "template_content_mismatch");
  });

  test("polls an exact name and maps Meta approval states", async () => {
    globalThis.fetch = (async () => Response.json({ data: [{ name: "zyon_test", status: "APPROVED" }] })) as typeof fetch;
    assert.deepEqual(await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_test"), {
      contentSid: "zyon_test", status: "approved",
    });
  });

  test("one WABA snapshot serves different template names and concurrent reads", async () => {
    let reads = 0;
    globalThis.fetch = (async () => { reads++; return Response.json({ data: [{ name: "one", status: "APPROVED" }, { name: "two", status: "PENDING" }] }); }) as typeof fetch;
    const adapter = new MetaCloudTemplateAdapter(configs);
    const [one, two] = await Promise.all([adapter.syncStatus(input.merchantId, "one"), adapter.syncStatus(input.merchantId, "two")]);
    assert.equal(one.status, "approved");
    assert.equal(two.status, "submitted");
    assert.equal(reads, 1);
  });

  test("80008 stops WABA polling and creation for an hour without overwriting approval", async () => {
    let reads = 0;
    globalThis.fetch = (async () => { reads++; return Response.json({ error: { code: 80008 } }, { status: 400 }); }) as typeof fetch;
    const adapter = new MetaCloudTemplateAdapter(configs);
    const first = await adapter.syncStatus(input.merchantId, "one");
    const second = await adapter.syncStatus(input.merchantId, "two");
    const create = await adapter.createAndSubmit(input);
    assert.equal(first.status, "unknown");
    assert.equal(second.status, "unknown");
    assert.equal(create.status, "draft");
    assert.ok((first.retryAfterMs ?? 0) >= 59 * 60_000);
    assert.equal(reads, 1);
  });

  test("an uncertain create keeps its deterministic identifier for reconciliation", async () => {
    globalThis.fetch = (async () => { throw new Error("timeout"); }) as typeof fetch;
    const result = await new MetaCloudTemplateAdapter(configs).createAndSubmit(input);
    assert.equal(result.status, "submission_unknown");
    assert.match(result.contentSid, /^zyon_/);
  });

  test("approval must match both language and body, even when the name is approved", async () => {
    const expected = { language: "pt_BR", body: input.metaBody };
    for (const item of [
      { language: "en_US", components: [{ type: "BODY", text: input.metaBody }] },
      { language: "pt_BR", components: [{ type: "BODY", text: "Conteúdo alterado" }] },
    ]) {
      globalThis.fetch = (async () => Response.json({ data: [{ name: "zyon_test", status: "APPROVED", ...item }] })) as typeof fetch;
      assert.notEqual((await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_test", expected)).status, "approved");
    }
    globalThis.fetch = (async () => Response.json({ data: [{ name: "zyon_test", status: "APPROVED", language: "pt_BR", components: [{ type: "BODY", text: input.metaBody }] }] })) as typeof fetch;
    assert.equal((await new MetaCloudTemplateAdapter(configs).syncStatus(input.merchantId, "zyon_test", expected)).status, "approved");
  });
});

test("five-minute account link model uses its own name and verifies the actual provider expiry", async () => {
  const original = globalThis.fetch;
  const config = { findByMerchantId: async () => ({ merchantId: "m1", enabled: true, provider: "META_CLOUD", status: "ACTIVE", credentials: { accessToken: "local", wabaId: "123456789", phoneNumberId: "987654321" } }) } as any;
  const input = { merchantId: "m1", friendlyName: "buyer_whatsapp_link_otp_m1_v1", language: "pt_BR", category: "AUTHENTICATION", metaBody: "{{1}} é seu código de verificação.", sampleVariables: { "1": "123456" } };
  const payloads: any[] = [];
  try {
    globalThis.fetch = (async (_u, init) => { payloads.push(JSON.parse(String(init?.body))); return Response.json({ status: "PENDING" }); }) as typeof fetch;
    const five = await new MetaCloudTemplateAdapter(config).createAndSubmit({ ...input, authenticationExpirationMinutes: 5 });
    const ten = await new MetaCloudTemplateAdapter(config).createAndSubmit(input);
    assert.notEqual(five.contentSid, ten.contentSid);
    assert.deepEqual(payloads[0].components, [{ type: "BODY", add_security_recommendation: true }, { type: "FOOTER", code_expiration_minutes: 5 }, { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copiar código" }] }]);
    assert.equal(payloads[1].components[1].code_expiration_minutes, 10);
    const expected = { language: "pt_BR", category: "AUTHENTICATION", body: input.metaBody, authenticationExpirationMinutes: 5 as const };
    for (const expiry of [5, 10, undefined]) {
      globalThis.fetch = (async () => Response.json({ data: [{ name: five.contentSid, language: "pt_BR", category: "AUTHENTICATION", status: "APPROVED", components: [{ type: "BODY", text: "{{1}} Código" }, ...(expiry ? [{ type: "FOOTER", text: `Este código expira em ${expiry} minutos.` }] : []), { type: "BUTTONS", buttons: [{ type: "OTP", otp_type: "COPY_CODE" }] }] }] })) as typeof fetch;
      const state = await new MetaCloudTemplateAdapter(config).syncStatus("m1", five.contentSid, expected);
      assert.equal(state.status, expiry === 5 ? "approved" : "disabled");
    }
  } finally { globalThis.fetch = original; }
});

test("legacy checkout authentication retains its pre-migration identifier and ten-minute preset", async () => {
  const original=globalThis.fetch;let payload:any;
  try {
    const configs={findByMerchantId:async()=>({merchantId:"legacy-store",enabled:true,provider:"META_CLOUD",status:"ACTIVE",credentials:{accessToken:"local",wabaId:"123456789",phoneNumberId:"987654321"}})} as any;
    globalThis.fetch=(async(_url,init)=>{payload=JSON.parse(String(init?.body));return Response.json({status:"PENDING"});}) as typeof fetch;
    const result=await new MetaCloudTemplateAdapter(configs).createAndSubmit({merchantId:"legacy-store",friendlyName:"checkout_otp_store_v1",language:"pt_BR",category:"AUTHENTICATION",metaBody:"{{1}} é seu código de verificação.",sampleVariables:{"1":"123456"}});
    assert.equal(result.contentSid,"zyon_checkout_otp_store_v1_cb17f874c5");
    assert.equal(payload.name,result.contentSid);assert.equal(payload.components[1].code_expiration_minutes,10);
  } finally {globalThis.fetch=original;}
});
