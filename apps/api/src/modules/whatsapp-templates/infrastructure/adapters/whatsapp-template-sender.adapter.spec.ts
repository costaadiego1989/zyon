import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { WhatsAppTemplateSenderAdapter } from "./whatsapp-template-sender.adapter.js";
import { SendWhatsAppMessageUseCase } from "../../application/use-cases/send-whatsapp-message.use-case.js";
import type { WhatsAppChannelConfigEntity, WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppTemplateRecord, WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";

describe("template adapter revalidates recovery tenant authority", () => {
  const originalFetch = globalThis.fetch;
  const envKeys = ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_WHATSAPP_FROM"] as const;
  const originalEnv = Object.fromEntries(envKeys.map((key) => [key, process.env[key]]));
  afterEach(() => {
    globalThis.fetch = originalFetch;
    for (const key of envKeys) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });
  const config: WhatsAppChannelConfigEntity = {
    id: "connection-1", merchantId: "m1", enabled: true, provider: "TWILIO", status: "ACTIVE",
    credentials: { accountSid: "AC-tenant", authToken: "fake-tenant-token", senderId: "whatsapp:+5511999990000" },
    whatsappNumber: "5511999990000", createdAt: new Date(0), updatedAt: new Date(0),
  };
  const template = {
    merchantId: "m1", type: "cart_recovery", channel: "whatsapp", isActive: true,
    metaStatus: "approved", twilioContentSid: "HX-tenant", metaVariableMap: {},
  } as WhatsAppTemplateRecord;
  const input = {
    merchantId: "m1", type: "cart_recovery" as const, toNumber: "11999991111", contentSid: "HX-tenant",
    contentVariables: { "1": "Ana" },
  };

  function harness(options: {
    config?: Partial<WhatsAppChannelConfigEntity> | null;
    template?: Partial<WhatsAppTemplateRecord> | null;
    noConfigRepo?: boolean;
    noTemplateRepo?: boolean;
    configError?: boolean;
    templateError?: boolean;
    response?: Response;
    transportError?: boolean;
  } = {}) {
    process.env.TWILIO_ACCOUNT_SID = "AC-global";
    process.env.TWILIO_AUTH_TOKEN = "fake-global-token";
    process.env.TWILIO_WHATSAPP_FROM = "whatsapp:+5511999999999";
    const requests: { url: string; init?: RequestInit }[] = [];
    globalThis.fetch = (async (url, init) => {
      requests.push({ url: String(url), init });
      if (options.transportError) throw new DOMException("Request timed out", "TimeoutError");
      return options.response ?? new Response(JSON.stringify({ sid: "SM-test", status: "queued" }), { status: 201 });
    }) as typeof fetch;
    const configs = {
      async findByMerchantId(merchantId: string) {
        assert.equal(merchantId, "m1");
        if (options.configError) throw new Error("config read unavailable");
        return options.config === null ? null : { ...config, ...options.config };
      },
    } as WhatsAppConfigRepository;
    const templates = {
      async findByMerchantAndType(merchantId: string, type: string, channel: string) {
        assert.deepEqual([merchantId, type, channel], ["m1", "cart_recovery", "whatsapp"]);
        if (options.templateError) throw new Error("template read unavailable");
        return options.template === null ? null : { ...template, ...options.template };
      },
    } as WhatsAppTemplateRepositoryPort;
    return {
      adapter: new WhatsAppTemplateSenderAdapter(options.noConfigRepo ? undefined : configs, options.noTemplateRepo ? undefined : templates),
      requests,
    };
  }

  test("sends ContentSid with the connected tenant sender and credentials only", async () => {
    const h = harness();
    assert.deepEqual(await h.adapter.sendTemplate(input), { messageId: "SM-test", status: "sent" });
    assert.equal(h.requests.length, 1);
    assert.equal(h.requests[0]?.url, "https://api.twilio.com/2010-04-01/Accounts/AC-tenant/Messages.json");
    const headers = new Headers(h.requests[0]?.init?.headers);
    assert.equal(headers.get("Authorization"), `Basic ${Buffer.from("AC-tenant:fake-tenant-token").toString("base64")}`);
    const body = new URLSearchParams(String(h.requests[0]?.init?.body));
    assert.equal(body.get("From"), "whatsapp:+5511999990000");
    assert.equal(body.get("To"), "whatsapp:+5511999991111");
    assert.equal(body.get("ContentSid"), "HX-tenant");
    assert.equal(body.get("ContentVariables"), '{"1":"Ana"}');
    assert.equal(body.has("Body"), false);
    assert.ok(h.requests[0]?.init?.signal instanceof AbortSignal);
  });

  const invalidConnections: [string, Partial<WhatsAppChannelConfigEntity> | null][] = [
    ["missing", null], ["disconnected", { status: "DISCONNECTED" }],
    ["pending", { status: "PENDING_VERIFICATION" }], ["disabled", { enabled: false }],
    ["another merchant", { merchantId: "m2" }], ["Bubble provider", { provider: "BUBBLEWHATS" }],
    ["missing credentials", { credentials: {} }],
    ["mismatched connected number", { whatsappNumber: "5511999999999" }],
  ];
  for (const [label, invalidConfig] of invalidConnections) {
    test(`${label} connection cannot use configured global fallback`, async () => {
      const h = harness({ config: invalidConfig });
      assert.equal((await h.adapter.sendTemplate(input)).status, "skipped");
      assert.equal(h.requests.length, 0);
    });
  }

  test("missing or failing config repository never authorizes recovery using env", async () => {
    for (const options of [{ noConfigRepo: true }, { configError: true }]) {
      const h = harness(options);
      assert.equal((await h.adapter.sendTemplate(input)).status, "skipped");
      assert.equal(h.requests.length, 0);
    }
  });

  test("non-recovery messages preserve the existing stored credentials and global fallback", async () => {
    for (const options of [
      { config: { status: "DISCONNECTED", enabled: false } },
      { config: null }, { configError: true }, { noConfigRepo: true }, { config: { credentials: {} } },
    ]) {
      const h = harness(options);
      assert.equal((await h.adapter.sendTemplate({ ...input, type: undefined })).status, "sent");
      assert.equal(h.requests.length, 1);
      const expectedAccount = options.config?.status === "DISCONNECTED" ? "AC-tenant" : "AC-global";
      assert.ok(h.requests[0]?.url.includes(`/Accounts/${expectedAccount}/`));
    }
  });

  const recipientCases: [string, string][] = [
    ["+12025550123", "whatsapp:+12025550123"],
    ["+442079460958", "whatsapp:+442079460958"],
    ["+44 (20) 7946-0958", "whatsapp:+442079460958"],
    ["11999991111", "whatsapp:+5511999991111"],
    ["(11) 3333-1111", "whatsapp:+551133331111"],
    ["55999991111", "whatsapp:+5555999991111"],
    ["5511999991111", "whatsapp:+5511999991111"],
  ];
  for (const [recipient, expected] of recipientCases) {
    test(`recovery preserves the intended country and subscriber for ${recipient}`, async () => {
      const h = harness();
      assert.equal((await h.adapter.sendTemplate({ ...input, toNumber: recipient })).status, "sent");
      const body = new URLSearchParams(String(h.requests[0]?.init?.body));
      assert.equal(body.get("To"), expected);
    });
  }

  test("ambiguous or invalid recovery recipients never reach the provider", async () => {
    for (const recipient of ["442079460958", "12025550123", "011999991111", "+0012025550123", "+1", "+1234567890123456", "++5511999991111", "5511999991111 ext 2", "invalid"]) {
      const h = harness();
      assert.deepEqual(await h.adapter.sendTemplate({ ...input, toNumber: recipient }), {
        messageId: "", status: "skipped", reason: "invalid_recipient",
      });
      assert.equal(h.requests.length, 0);
    }
  });

  const invalidTemplates: [string, Partial<WhatsAppTemplateRecord> | null][] = [
    ["missing", null], ["rejected", { metaStatus: "rejected" }], ["pending", { metaStatus: "pending" }],
    ["paused", { metaStatus: "paused" }], ["disabled", { isActive: false }],
    ["another merchant", { merchantId: "m2" }], ["wrong type", { type: "order_shipped" }],
    ["wrong channel", { channel: "email" }], ["different SID", { twilioContentSid: "HX-other" }],
  ];
  for (const [label, invalidTemplate] of invalidTemplates) {
    test(`${label} template fails adapter revalidation`, async () => {
      const h = harness({ template: invalidTemplate });
      assert.deepEqual(await h.adapter.sendTemplate(input), {
        messageId: "", status: "skipped", reason: "approved_template_unavailable",
      });
      assert.equal(h.requests.length, 0);
    });
  }

  test("template repository absent or unavailable fails before provider dispatch", async () => {
    for (const options of [{ noTemplateRepo: true }, { templateError: true }]) {
      const h = harness(options);
      assert.equal((await h.adapter.sendTemplate(input)).status, "skipped");
      assert.equal(h.requests.length, 0);
    }
  });

  test("connection or template changed after routing is revalidated before dispatch", async () => {
    for (const changed of ["connection", "template"]) {
      const h = harness();
      let configReads = 0;
      let templateReads = 0;
      let emailCount = 0;
      const configs = {
        async findByMerchantId(_merchantId: string): Promise<WhatsAppChannelConfigEntity> {
          configReads++;
          return { ...config, enabled: changed !== "connection" || configReads === 1 };
        },
      } as WhatsAppConfigRepository;
      const templates = {
        async findByMerchantAndType(_merchantId: string, _type: string, _channel: string): Promise<WhatsAppTemplateRecord> {
          templateReads++;
          return { ...template, isActive: changed !== "template" || templateReads === 1 };
        },
      } as WhatsAppTemplateRepositoryPort;
      const adapter = new WhatsAppTemplateSenderAdapter(configs, templates);
      const router = new SendWhatsAppMessageUseCase(templates, adapter, undefined, {
        async send() { emailCount++; return { status: "queued", messageId: "email-test" }; },
      }, configs);
      assert.equal((await router.execute({
        merchantId: "m1", type: "cart_recovery", toPhone: input.toNumber,
        fallbackEmail: "buyer@example.test", freeformText: "Seu carrinho",
      })).channel, "email");
      assert.equal(configReads, 2);
      assert.equal(emailCount, 1);
      assert.equal(h.requests.length, 0);
    }
  });

  test("timeout and 5xx preserve unknown acceptance rather than rejection", async () => {
    for (const options of [
      { transportError: true }, { response: new Response("upstream timed out", { status: 504 }) },
      { response: new Response("request timeout", { status: 408 }) },
      { response: new Response("{}", { status: 201 }) },
      { response: new Response("null", { status: 201 }) },
      { response: new Response('{"sid":123}', { status: 201 }) },
      { response: new Response("malformed provider body", { status: 201 }) },
    ]) {
      const h = harness(options);
      assert.deepEqual(await h.adapter.sendTemplate(input), {
        messageId: "", status: "uncertain", reason: "provider_acceptance_unknown",
      });
      assert.equal(h.requests.length, 1);
    }
  });

  test("an unstructured provider 400 has no proof permitting another channel", async () => {
    const rejected = harness({ response: new Response("not approved", { status: 400 }) });
    assert.deepEqual(await rejected.adapter.sendTemplate(input), { messageId: "", status: "failed", reason: "twilio_400" });
    const invalid = harness();
    assert.equal((await invalid.adapter.sendTemplate({ ...input, toNumber: "invalid" })).status, "skipped");
    assert.equal(invalid.requests.length, 0);
  });

  for (const code of [21654, 21655, 21656, 63040, 63041, 63042]) {
    test(`synchronous Twilio validation exception ${code} proves no message creation`, async () => {
      const h = harness({ response: new Response(JSON.stringify({
        status: 400, code, message: "Content template cannot be sent",
        more_info: `https://www.twilio.com/docs/errors/${code}`,
      }), { status: 400 }) });
      assert.deepEqual(await h.adapter.sendTemplate(input), {
        messageId: "", status: "failed", acceptance: "not_accepted", reason: `twilio_${code}`,
      });
      assert.equal(h.requests.length, 1);
    });
  }

  test("error code alone, mismatched HTTP status, or any SID never proves non-acceptance", async () => {
    const exception = { status: 400, code: 63040, message: "Template rejected" };
    const cases: [number, unknown][] = [
      [400, null], [400, []], [400, { code: 63040 }],
      [400, { ...exception, status: 500 }], [400, { ...exception, code: "63040" }],
      [400, { ...exception, message: " " }], [400, { ...exception, sid: "SM-created" }],
      [400, { ...exception, sid: null }], [400, { ...exception, sid: "" }],
      [400, { ...exception, code: 63005 }], [400, { ...exception, code: 63049 }],
      [403, { ...exception, status: 403 }], [408, { ...exception, status: 408 }],
      [429, { ...exception, status: 429 }], [500, { ...exception, status: 500 }],
      [201, { ...exception, sid: "SM-created", status: "failed" }],
    ];
    for (const [status, body] of cases) {
      const h = harness({ response: new Response(JSON.stringify(body), { status }) });
      const result = await h.adapter.sendTemplate(input);
      assert.equal(result.acceptance, undefined, JSON.stringify({ status, body }));
      assert.notEqual(result.status, "sent");
      assert.equal(h.requests.length, 1);
    }
  });

  test("router uses email exactly once after verified synchronous template refusal", async () => {
    const h = harness({ response: new Response(JSON.stringify({
      status: 400, code: 63040, message: "Template rejected",
    }), { status: 400 }) });
    let emailCount = 0;
    const configs = { async findByMerchantId(merchantId: string) { assert.equal(merchantId, "m1"); return config; } } as WhatsAppConfigRepository;
    const templates = { async findByMerchantAndType(merchantId: string, type: string, channel: string) {
      assert.deepEqual([merchantId, type], ["m1", "cart_recovery"]);
      assert.ok(channel === "whatsapp" || channel === "email");
      return channel === "email" ? { ...template, channel: "email" as const, body: "Seu carrinho", subject: "Lembrete" } : template;
    } } as WhatsAppTemplateRepositoryPort;
    const router = new SendWhatsAppMessageUseCase(templates, h.adapter, undefined, {
      async send() { emailCount++; return { status: "queued", messageId: "email-test" }; },
    }, configs);
    assert.deepEqual(await router.execute({
      merchantId: "m1", type: "cart_recovery", toPhone: input.toNumber,
      fallbackEmail: "buyer@example.test", freeformText: "Seu carrinho",
    }), { channel: "email", status: "sent", messageId: "email-test" });
    assert.equal(h.requests.length, 1);
    assert.equal(emailCount, 1);
  });

  test("router never adds email after generic errors, timeouts, or created-message failures", async () => {
    for (const response of [
      new Response("not approved", { status: 400 }),
      new Response(JSON.stringify({ status: 400, code: 63005, message: "Channel rejected content" }), { status: 400 }),
      new Response(JSON.stringify({ status: 408, code: 63040, message: "Template rejected" }), { status: 408 }),
      new Response(JSON.stringify({ status: 500, code: 63040, message: "Template rejected" }), { status: 500 }),
      new Response(JSON.stringify({ status: "failed", sid: "SM-created", error_code: 63040 }), { status: 201 }),
      new Response(JSON.stringify({ status: "undelivered", sid: "SM-created", error_code: 63040 }), { status: 201 }),
    ]) {
      const h = harness({ response });
      let emailCount = 0;
      const configs = { async findByMerchantId(merchantId: string) { assert.equal(merchantId, "m1"); return config; } } as WhatsAppConfigRepository;
      const templates = { async findByMerchantAndType(merchantId: string, type: string, channel: string) { assert.deepEqual([merchantId, type, channel], ["m1", "cart_recovery", "whatsapp"]); return template; } } as WhatsAppTemplateRepositoryPort;
      const router = new SendWhatsAppMessageUseCase(templates, h.adapter, undefined, {
        async send() { emailCount++; return { status: "queued", messageId: "email-test" }; },
      }, configs);
      const result = await router.execute({
        merchantId: "m1", type: "cart_recovery", toPhone: input.toNumber,
        fallbackEmail: "buyer@example.test", freeformText: "Seu carrinho",
      });
      assert.equal(result.channel, "whatsapp_template");
      assert.ok(result.status === "failed" || result.status === "uncertain");
      assert.equal(h.requests.length, 1);
      assert.equal(emailCount, 0);
    }
  });

  test("a provider failure status cannot be reported as sent even with an ID", async () => {
    for (const status of ["failed", "undelivered", "canceled"]) {
      const h = harness({ response: new Response(JSON.stringify({ sid: "SM-test", status }), { status: 201 }) });
      assert.deepEqual(await h.adapter.sendTemplate(input), { messageId: "SM-test", status: "failed", reason: `twilio_message_${status}` });
    }
  });
});
