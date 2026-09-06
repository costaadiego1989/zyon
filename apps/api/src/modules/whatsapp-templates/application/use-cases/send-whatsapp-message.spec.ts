import test, { afterEach, describe } from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import type { WhatsAppTemplateRecord } from "../../domain/ports/whatsapp-template-repository.port.js";
import type { WhatsAppSendResult } from "../../../notifications/domain/ports/whatsapp-sender.port.js";
import type { SendEmailOutput } from "../../../notifications/domain/ports/email-sender.port.js";

describe("SendWhatsAppMessageUseCase provider acceptance", () => {
  const originalProvider = process.env.WHATSAPP_PROVIDER;
  afterEach(() => {
    if (originalProvider === undefined) delete process.env.WHATSAPP_PROVIDER;
    else process.env.WHATSAPP_PROVIDER = originalProvider;
  });

  function harness(opts: {
    provider: string;
    template?: Partial<WhatsAppTemplateRecord> | null;
    templateResult?: { status: string; reason?: string };
    bubbleResult?: WhatsAppSendResult | void;
    emailResult?: Partial<SendEmailOutput>;
  }) {
    process.env.WHATSAPP_PROVIDER = opts.provider;
    const sent = { template: [] as any[], email: [] as any[], bubble: [] as any[] };

    const templates = {
      async findByMerchantAndType() {
        return opts.template === null || opts.template === undefined
          ? null
          : ({
              metaVariableMap: { "1": "buyerName", "2": "couponBlock" },
              metaStatus: "approved",
              twilioContentSid: "HX1",
              ...opts.template,
            } as any);
      },
    } as any;
    const templateSender = {
      async sendTemplate(i: any) {
        sent.template.push(i);
        return { messageId: "SM", status: opts.templateResult?.status ?? "sent", reason: opts.templateResult?.reason };
      },
    } as any;
    const bubble = {
      async send(m: any) {
        sent.bubble.push(m);
        return "bubbleResult" in opts ? opts.bubbleResult : { status: "accepted" as const };
      },
    };
    const email = {
      async send(m: any) {
        sent.email.push(m);
        return (opts.emailResult ?? { messageId: "email-test-id", status: "queued" }) as SendEmailOutput;
      },
    };

    const uc = new SendWhatsAppMessageUseCase(templates, templateSender, bubble, email);
    return { uc, sent };
  }

  const base = {
    merchantId: "m1",
    type: "order_confirmation" as const,
    toPhone: "+5511999998888",
    variables: { buyerName: "Ana", coupon: "VOLTA10", discountPercent: 10 },
    fallbackEmail: "ana@test.local",
    emailSubject: "Volte",
    freeformText: "Oi Ana! cupom VOLTA10",
  };

  test("twilio + approved template → sends template with resolved vars", async () => {
    const h = harness({ provider: "twilio", template: {} });
    const r = await h.uc.execute(base);
    assert.equal(r.channel, "whatsapp_template");
    assert.equal(r.status, "sent");
    assert.equal(h.sent.template[0].contentVariables["1"], "Ana");
    assert.match(h.sent.template[0].contentVariables["2"], /VOLTA10/);
    assert.equal(h.sent.email.length, 0);
  });

  test("twilio + no approved template → email fallback", async () => {
    const h = harness({ provider: "twilio", template: null });
    const r = await h.uc.execute(base);
    assert.equal(r.channel, "email");
    assert.equal(h.sent.template.length, 0);
    assert.equal(h.sent.email.length, 1);
  });

  test("twilio template skipped (no creds) → email fallback", async () => {
    const h = harness({ provider: "twilio", template: {}, templateResult: { status: "skipped", reason: "twilio_credentials_missing" } });
    const r = await h.uc.execute(base);
    assert.equal(r.channel, "email");
    assert.equal(h.sent.template.length, 1);
    assert.equal(h.sent.email.length, 1);
  });

  test("email provider → always email, never template/bubble", async () => {
    const h = harness({ provider: "email", template: {} });
    const r = await h.uc.execute(base);
    assert.equal(r.channel, "email");
    assert.equal(h.sent.template.length, 0);
    assert.equal(h.sent.bubble.length, 0);
  });

  test("bubblewhats provider → legacy freeform", async () => {
    const h = harness({ provider: "bubblewhats" });
    const r = await h.uc.execute(base);
    assert.equal(r.channel, "bubblewhats");
    assert.equal(r.status, "sent");
    assert.match(h.sent.bubble[0].message, /VOLTA10/);
    assert.equal(h.sent.email.length, 0);
  });

  test("skipped and legacy void Bubble results fall back to accepted email", async () => {
    for (const bubbleResult of [undefined, { status: "skipped", reason: "not_configured" } as const]) {
      const h = harness({ provider: "bubblewhats", bubbleResult });
      const result = await h.uc.execute(base);
      assert.deepEqual(result, { channel: "email", status: "sent" });
      assert.equal(h.sent.bubble.length, 1);
      assert.equal(h.sent.email.length, 1);
    }
  });

  test("skipped and legacy void Bubble results without fallback do not count as sent", async () => {
    for (const bubbleResult of [undefined, { status: "skipped", reason: "missing_phone" } as const]) {
      const h = harness({ provider: "bubblewhats", bubbleResult });
      const result = await h.uc.execute({ ...base, fallbackEmail: undefined });
      assert.deepEqual(result, { channel: "none", status: "skipped", reason: "no_reachable_channel" });
      assert.equal(h.sent.bubble.length, 1);
      assert.equal(h.sent.email.length, 0);
    }
  });

  test("email fallback requires a message ID before counting queued or sent acceptance", async () => {
    for (const emailResult of [
      { status: "queued" as const },
      { status: "sent" as const, messageId: "" },
    ]) {
      const h = harness({ provider: "email", emailResult });
      const result = await h.uc.execute(base);
      assert.deepEqual(result, { channel: "none", status: "skipped", reason: "no_reachable_channel" });
      assert.equal(h.sent.email.length, 1);
    }
  });

  test("no phone + no email → none/skipped", async () => {
    const h = harness({ provider: "twilio", template: {} });
    const r = await h.uc.execute({ ...base, toPhone: undefined, fallbackEmail: undefined });
    assert.equal(r.channel, "none");
    assert.equal(r.status, "skipped");
  });

  test("no phone but has email → email", async () => {
    const h = harness({ provider: "twilio", template: {} });
    const r = await h.uc.execute({ ...base, toPhone: undefined });
    assert.equal(r.channel, "email");
  });
});
