import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppTemplateSenderAdapter } from "./whatsapp-template-sender.adapter.js";
import { SendWhatsAppMessageUseCase } from "../../application/use-cases/send-whatsapp-message.use-case.js";
import type { WhatsAppChannelConfigEntity, WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppTemplateRecord, WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";

describe("Meta Cloud template sender", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = originalFetch; });

  const config: WhatsAppChannelConfigEntity = {
    id: "connection-1", merchantId: "m1", enabled: true, provider: "META_CLOUD", status: "ACTIVE",
    credentials: { accessToken: "merchant-token", wabaId: "123456789", phoneNumberId: "987654321" },
    whatsappNumber: "5511999990000", createdAt: new Date(0), updatedAt: new Date(0),
  };
  const template = {
    id: "template-1", merchantId: "m1", type: "cart_recovery", channel: "whatsapp", isActive: true,
    metaStatus: "approved", twilioContentSid: "zyon_recovery_123", metaLanguage: "pt_BR", metaVariableMap: {},
  } as WhatsAppTemplateRecord;
  const input = {
    merchantId: "m1", type: "cart_recovery" as const, toNumber: "11999991111", contentSid: "zyon_recovery_123",
    language: "pt_BR", contentVariables: { "1": "Ana", "2": "https://store.test/recover" },
  };

  function harness(options: { config?: Partial<WhatsAppChannelConfigEntity> | null; template?: Partial<WhatsAppTemplateRecord> | null; response?: Response; transportError?: boolean } = {}) {
    const requests: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      if (options.transportError) throw new Error("network");
      return options.response ?? Response.json({ messages: [{ id: "wamid.test" }] });
    }) as typeof fetch;
    const configs = { async findByMerchantId() { return options.config === null ? null : { ...config, ...options.config }; } } as unknown as WhatsAppConfigRepository;
    const templates = { async findByMerchantAndType() { return options.template === null ? null : { ...template, ...options.template }; } } as unknown as WhatsAppTemplateRepositoryPort;
    return { adapter: new WhatsAppTemplateSenderAdapter(configs, templates), configs, templates, requests };
  }

  test("sends an approved merchant template through its exact Cloud API phone ID", async () => {
    const h = harness();
    assert.deepEqual(await h.adapter.sendTemplate(input), { messageId: "wamid.test", status: "sent" });
    assert.equal(h.requests[0]?.url, "https://graph.facebook.com/v23.0/987654321/messages");
    assert.equal(new Headers(h.requests[0]?.init?.headers).get("Authorization"), "Bearer merchant-token");
    assert.deepEqual(JSON.parse(String(h.requests[0]?.init?.body)), {
      messaging_product: "whatsapp", to: "5511999991111", type: "template",
      template: {
        name: "zyon_recovery_123", language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [{ type: "text", text: "Ana" }, { type: "text", text: "https://store.test/recover" }] }],
      },
    });
  });

  for (const invalid of [null, { enabled: false }, { status: "DISCONNECTED" }, { provider: "TWILIO" }, { credentials: {} }]) {
    test("never falls back to platform credentials for an unavailable connection", async () => {
      const h = harness({ config: invalid as any });
      assert.equal((await h.adapter.sendTemplate(input)).status, "skipped");
      assert.equal(h.requests.length, 0);
    });
  }

  test("requires the currently approved recovery template before dispatch", async () => {
    const h = harness({ template: { metaStatus: "submitted" } });
    assert.deepEqual(await h.adapter.sendTemplate(input), { messageId: "", status: "skipped", reason: "approved_template_unavailable" });
    assert.equal(h.requests.length, 0);
  });

  test("network and incomplete success are uncertain, while a completed Graph 4xx is safely not accepted", async () => {
    for (const options of [{ transportError: true }, { response: Response.json({}) }, { response: new Response("server", { status: 503 }) }]) {
      const h = harness(options);
      assert.equal((await h.adapter.sendTemplate(input)).status, "uncertain");
    }
    const rejected = harness({ response: new Response("invalid template", { status: 400 }) });
    assert.deepEqual(await rejected.adapter.sendTemplate(input), {
      messageId: "", status: "failed", acceptance: "not_accepted", reason: "meta_http_400",
    });
  });

  test("recovery falls back to email exactly once after a definite Meta refusal", async () => {
    const h = harness({ response: new Response("invalid template", { status: 400 }) });
    let emails = 0;
    const useCase = new SendWhatsAppMessageUseCase(h.templates, h.adapter, undefined, {
      async send() { emails++; return { status: "queued", messageId: "email-1" }; },
    }, h.configs);
    assert.deepEqual(await useCase.execute({
      merchantId: "m1", type: "cart_recovery", toPhone: input.toNumber, fallbackEmail: "buyer@example.test",
      freeformText: "Seu carrinho", variables: { buyerName: "Ana" },
    }), { channel: "email", status: "sent", messageId: "email-1" });
    assert.equal(emails, 1);
  });
});
