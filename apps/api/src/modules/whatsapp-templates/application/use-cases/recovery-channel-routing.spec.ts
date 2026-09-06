import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import type { WhatsAppChannelConfigEntity, WhatsAppConfigRepository } from "../../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppTemplateRecord, WhatsAppTemplateRepositoryPort } from "../../domain/ports/whatsapp-template-repository.port.js";
import type { TemplateSendInput, TemplateSendResult } from "../../domain/ports/whatsapp-template-sender.port.js";
import type { SendEmailInput, SendEmailOutput } from "../../../notifications/domain/ports/email-sender.port.js";

describe("recovery chooses a connected merchant template or email", () => {
  const originalProvider = process.env.WHATSAPP_PROVIDER;
  afterEach(() => {
    if (originalProvider === undefined) delete process.env.WHATSAPP_PROVIDER;
    else process.env.WHATSAPP_PROVIDER = originalProvider;
  });

  const config: WhatsAppChannelConfigEntity = {
    id: "connection-1", merchantId: "m1", enabled: true, provider: "TWILIO", status: "ACTIVE",
    credentials: { accountSid: "AC-merchant", authToken: "fake-token", senderId: "whatsapp:+5511999990000" },
    whatsappNumber: "5511999990000", createdAt: new Date(0), updatedAt: new Date(0),
  };
  const template: WhatsAppTemplateRecord = {
    id: "template-1", merchantId: "m1", type: "cart_recovery", channel: "whatsapp", name: "recovery",
    body: "Hello", subject: null, isActive: true, metaCategory: "MARKETING", metaLanguage: "pt_BR",
    metaTemplateBody: "Hello {{1}} {{2}}", metaVariableMap: { "1": "buyerName", "2": "link" },
    twilioContentSid: "HX-merchant", metaStatus: "approved", metaRejectionReason: null,
    createdAt: new Date(0), updatedAt: new Date(0),
  };
  const input = {
    merchantId: "m1", type: "cart_recovery" as const, toPhone: "+5511999991111",
    fallbackEmail: "buyer@example.test", emailSubject: "Seu carrinho", freeformText: "Olá, Ana!",
    variables: { buyerName: "Ana", link: "https://shop.example.test/recover/1" },
  };

  function harness(options: {
    connection?: Partial<WhatsAppChannelConfigEntity> | null;
    template?: Partial<WhatsAppTemplateRecord> | null;
    configError?: boolean;
    templateError?: boolean;
    senderError?: boolean;
    emailError?: boolean;
    templateResult?: Partial<TemplateSendResult>;
    emailResult?: Partial<SendEmailOutput>;
    absentConfigRepo?: boolean;
    emailTemplate?: Partial<WhatsAppTemplateRecord>;
    emailTemplateError?: boolean;
  } = {}) {
    const sent = { whatsapp: [] as TemplateSendInput[], email: [] as SendEmailInput[], bubble: 0 };
    const reads: unknown[][] = [];
    const templates = {
      async findByMerchantAndType(...args: string[]) {
        if (args[2] === "email") {
          assert.deepEqual(args, [input.merchantId, "cart_recovery", "email"]);
          if (options.emailTemplateError) throw new Error("email template unavailable");
          return options.emailTemplate ? { ...template, channel: "email", ...options.emailTemplate } : null;
        }
        reads.push(args);
        if (options.templateError) throw new Error("db unavailable");
        return options.template === null ? null : { ...template, ...options.template };
      },
    } as WhatsAppTemplateRepositoryPort;
    const configs = {
      async findByMerchantId(merchantId: string) {
        assert.equal(merchantId, input.merchantId);
        if (options.configError) throw new Error("db unavailable");
        return options.connection === null ? null : { ...config, ...options.connection };
      },
    } as WhatsAppConfigRepository;
    const sender = {
      async sendTemplate(message: TemplateSendInput): Promise<TemplateSendResult> {
        sent.whatsapp.push(message);
        if (options.senderError) throw new Error("timeout after provider acceptance");
        return { status: "queued", messageId: "SM-test", ...options.templateResult };
      },
    };
    const email = {
      async send(message: SendEmailInput): Promise<SendEmailOutput> {
        sent.email.push(message);
        if (options.emailError) throw new Error("email timeout");
        return { status: "queued", messageId: "email-test", ...options.emailResult };
      },
    };
    const bubble = { async send() { sent.bubble++; return { status: "accepted" as const }; } };
    return {
      uc: new SendWhatsAppMessageUseCase(templates, sender, bubble, email, options.absentConfigRepo ? undefined : configs),
      sent, reads,
    };
  }

  for (const provider of ["twilio", "email", "bubblewhats"]) {
    test(`active connection and approved template choose WhatsApp despite global ${provider}`, async () => {
      process.env.WHATSAPP_PROVIDER = provider;
      const h = harness();
      assert.deepEqual(await h.uc.execute(input), { channel: "whatsapp_template", status: "sent", messageId: "SM-test" });
      assert.deepEqual(h.reads, [["m1", "cart_recovery", "whatsapp"]]);
      assert.deepEqual(h.sent.whatsapp[0], {
        merchantId: "m1", type: "cart_recovery", toNumber: input.toPhone, contentSid: "HX-merchant",
        contentVariables: { "1": "Ana", "2": input.variables.link },
      });
      assert.equal(h.sent.email.length, 0);
      assert.equal(h.sent.bubble, 0);
    });
  }

  const unavailableConnections: [string, Partial<WhatsAppChannelConfigEntity> | null][] = [
    ["missing", null], ["disconnected with credentials", { status: "DISCONNECTED" }],
    ["pending verification", { status: "PENDING_VERIFICATION" }], ["disabled", { enabled: false }],
    ["inactive", { status: "INACTIVE" }], ["another merchant", { merchantId: "m2" }],
    ["legacy Bubble", { provider: "BUBBLEWHATS" }], ["unsupported provider", { provider: "META_CLOUD" }],
    ["missing credentials", { credentials: {} }], ["missing connected number", { whatsappNumber: undefined }],
    ["sender differs from connected number", { whatsappNumber: "5511999990001" }],
  ];
  for (const [label, connection] of unavailableConnections) {
    test(`${label} selects email without WhatsApp dispatch`, async () => {
      process.env.WHATSAPP_PROVIDER = "bubblewhats";
      const h = harness({ connection });
      assert.deepEqual(await h.uc.execute(input), { channel: "email", status: "sent", messageId: "email-test" });
      assert.equal(h.sent.whatsapp.length, 0);
      assert.equal(h.sent.email.length, 1);
      assert.equal(h.sent.bubble, 0);
      assert.equal(h.reads.length, 0);
    });
  }

  const unavailableTemplates: [string, Partial<WhatsAppTemplateRecord> | null][] = [
    ["missing", null], ["pending", { metaStatus: "pending" }], ["rejected", { metaStatus: "rejected" }],
    ["paused", { metaStatus: "paused" }], ["disabled", { isActive: false }],
    ["missing SID", { twilioContentSid: null }], ["blank SID", { twilioContentSid: " " }],
    ["another merchant", { merchantId: "m2" }], ["wrong type", { type: "order_confirmation" }],
    ["wrong channel", { channel: "email" }],
  ];
  for (const [label, invalidTemplate] of unavailableTemplates) {
    test(`${label} template selects email`, async () => {
      const h = harness({ template: invalidTemplate });
      assert.equal((await h.uc.execute(input)).channel, "email");
      assert.equal(h.sent.whatsapp.length, 0);
      assert.equal(h.sent.email.length, 1);
      assert.equal(h.sent.bubble, 0);
    });
  }

  test("missing connection reader or failed preflight reads choose email", async () => {
    for (const options of [{ absentConfigRepo: true }, { configError: true }, { templateError: true }]) {
      const h = harness(options);
      assert.equal((await h.uc.execute(input)).channel, "email");
      assert.equal(h.sent.whatsapp.length, 0);
      assert.equal(h.sent.email.length, 1);
    }
  });

  test("sender skipped after connection revalidation permits email", async () => {
    const h = harness({ templateResult: { status: "skipped", messageId: "", reason: "connection_disconnected" } });
    assert.equal((await h.uc.execute(input)).channel, "email");
    assert.equal(h.sent.email.length, 1);
  });

  test("generic provider failure lacks proof permitting a second channel", async () => {
    const h = harness({ templateResult: { status: "failed", messageId: "", reason: "twilio_400" } });
    assert.deepEqual(await h.uc.execute(input), { channel: "whatsapp_template", status: "failed", reason: "twilio_400" });
    assert.equal(h.sent.email.length, 0);
  });

  test("explicit not-accepted proof permits email exactly once", async () => {
    const h = harness({ templateResult: {
      status: "failed", messageId: "", acceptance: "not_accepted", reason: "twilio_63040",
    } });
    assert.deepEqual(await h.uc.execute(input), { channel: "email", status: "sent", messageId: "email-test" });
    assert.equal(h.sent.whatsapp.length, 1);
    assert.equal(h.sent.email.length, 1);
    assert.equal(h.sent.bubble, 0);
  });

  test("contradictory proof with a provider ID cannot enable another channel", async () => {
    const h = harness({ templateResult: {
      status: "failed", messageId: "SM-created", acceptance: "not_accepted", reason: "twilio_63040",
    } });
    const result = await h.uc.execute(input);
    assert.equal(result.channel, "whatsapp_template");
    assert.ok(result.status === "failed" || result.status === "uncertain");
    assert.equal(h.sent.whatsapp.length, 1);
    assert.equal(h.sent.email.length, 0);
    assert.equal(h.sent.bubble, 0);
  });

  test("verified WhatsApp refusal without a reachable email records no sent message", async () => {
    const h = harness({ templateResult: {
      status: "failed", messageId: "", acceptance: "not_accepted", reason: "twilio_63040",
    } });
    assert.deepEqual(await h.uc.execute({ ...input, fallbackEmail: undefined }), {
      channel: "none", status: "skipped", reason: "no_reachable_channel",
    });
    assert.equal(h.sent.whatsapp.length, 1);
    assert.equal(h.sent.email.length, 0);
  });

  test("timeout, unknown acceptance and missing provider ID never fall through to email", async () => {
    for (const options of [
      { senderError: true }, { templateResult: { status: "uncertain" as const, messageId: "" } },
      { templateResult: { status: "queued" as const, messageId: "" } },
      { templateResult: { status: "sent" as const, messageId: " " } },
      { templateResult: { status: "skipped" as const, messageId: "SM-already-created" } },
    ]) {
      const h = harness(options);
      const result = await h.uc.execute(input);
      assert.equal(result.channel, "whatsapp_template");
      assert.equal(result.status, "uncertain");
      assert.equal(h.sent.whatsapp.length, 1);
      assert.equal(h.sent.email.length, 0);
      assert.equal(h.sent.bubble, 0);
    }
  });

  test("email timeout or missing acceptance ID stays uncertain on email", async () => {
    for (const options of [{ emailError: true }, { emailResult: { messageId: "" } }]) {
      const h = harness({ connection: null, ...options });
      assert.deepEqual(await h.uc.execute(input), { channel: "email", status: "uncertain", reason: "provider_acceptance_unknown" });
      assert.equal(h.sent.whatsapp.length, 0);
      assert.equal(h.sent.email.length, 1);
    }
  });

  test("email fallback escapes buyer content while preserving line breaks", async () => {
    const h = harness({ connection: null });
    await h.uc.execute({ ...input, freeformText: 'Ana <img src=x onerror="alert(1)"> & loja\nSeu carrinho' });
    assert.ok(h.sent.email[0]?.html.includes('Ana &lt;img src=x onerror=&quot;alert(1)&quot;&gt; &amp; loja<br>Seu carrinho'));
    assert.ok(!h.sent.email[0]?.html.includes('<img'));
  });

  test("merchant email edits are rendered and require actual provider delivery", async () => {
    const h = harness({ connection: null, emailTemplate: { subject: "Olá {{buyerName}}", body: "Retome {{link}}\n{{buyerName}}" } });
    await h.uc.execute(input);
    assert.equal(h.sent.email[0]?.subject, "Olá Ana");
    assert.ok(h.sent.email[0]?.html.includes(`Retome ${input.variables.link}<br>Ana`));
    assert.ok(h.sent.email[0]?.html.includes('Retomar minha compra'));
    assert.equal(h.sent.email[0]?.requireDelivery, true);
  });

  test("disabled or unreadable email template and missing provider cannot report sent", async () => {
    for (const options of [{ emailTemplate: { isActive: false } }, { emailTemplateError: true }, { emailResult: { status: "skipped" as const, messageId: "" } }]) {
      const h = harness({ connection: null, ...options });
      const result = await h.uc.execute(input);
      assert.equal(result.status, "skipped");
      assert.equal(result.channel, "none");
    }
  });

  test("no phone uses email; disconnected phone without email sends nothing", async () => {
    const connected = harness();
    assert.equal((await connected.uc.execute({ ...input, toPhone: undefined })).channel, "email");
    assert.equal(connected.sent.whatsapp.length, 0);
    const disconnected = harness({ connection: null });
    assert.deepEqual(await disconnected.uc.execute({ ...input, fallbackEmail: undefined }), {
      channel: "none", status: "skipped", reason: "no_reachable_channel",
    });
    assert.equal(disconnected.sent.whatsapp.length + disconnected.sent.email.length + disconnected.sent.bubble, 0);
  });
});
