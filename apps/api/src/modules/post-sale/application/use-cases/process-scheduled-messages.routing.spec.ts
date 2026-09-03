import test from "node:test";
import assert from "node:assert/strict";
import { ProcessScheduledMessagesUseCase } from "./process-scheduled-messages.use-case.js";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";
import type { ScheduledMessage } from "../../domain/ports/scheduled-message-repository.port.js";

function baseMsg(over: Partial<ScheduledMessage>): ScheduledMessage {
  return {
    id: "m1",
    merchantId: "mrc1",
    buyerId: "b1",
    orderId: "o1",
    type: "loyalty",
    channel: "whatsapp",
    sendAt: new Date(),
    status: "pending",
    sentAt: null,
    messageContent: null,
    buyerPhone: "+5511999998888",
    buyerEmail: "b@test.local",
    buyerName: "Ana",
    productName: "seu pedido",
    metadata: { couponCode: "LY10", discountPercent: 10 },
    createdAt: new Date(),
    ...over,
  };
}

function harness(opts: {
  msgs: ScheduledMessage[];
  provider: string;
  template?: any;
  templateSendResult?: { status: string; reason?: string };
}) {
  const updates: Array<{ id: string; data: any }> = [];
  const emailsSent: any[] = [];
  const bubbleSent: any[] = [];
  const templateSent: any[] = [];

  process.env.POST_SALE_WHATSAPP_PROVIDER = opts.provider;

  const messages = {
    async findPendingDue() {
      return opts.msgs;
    },
    async update(id: string, data: any) {
      updates.push({ id, data });
      return {} as any;
    },
  } as any;

  const whatsapp = {
    async send(m: any) {
      bubbleSent.push(m);
    },
  } as any;

  const email = {
    async send(m: any) {
      emailsSent.push(m);
    },
  } as any;

  const copywriter = new PostSaleAiCopywriterService(); // offline → deterministic templates

  const templateSender = {
    async sendTemplate(input: any) {
      templateSent.push(input);
      return { messageId: "SM1", status: opts.templateSendResult?.status ?? "sent", reason: opts.templateSendResult?.reason };
    },
  } as any;

  const templates = {
    async findByMerchantAndType() {
      return opts.template ?? null;
    },
  } as any;

  const uc = new ProcessScheduledMessagesUseCase(
    messages,
    whatsapp,
    email,
    copywriter,
    undefined,
    templateSender,
    templates
  );

  return { uc, updates, emailsSent, bubbleSent, templateSent };
}

const approvedTemplate = {
  metaStatus: "approved",
  twilioContentSid: "HX123",
  metaVariableMap: { "1": "buyerName", "2": "couponBlock" },
};

test("twilio provider + approved template → sends via template sender", async () => {
  const h = harness({ msgs: [baseMsg({})], provider: "twilio", template: approvedTemplate });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 1);
  assert.equal(h.templateSent.length, 1);
  assert.equal(h.emailsSent.length, 0);
  // Variables resolved from map: buyerName + couponBlock.
  assert.equal(h.templateSent[0].contentVariables["1"], "Ana");
  assert.match(h.templateSent[0].contentVariables["2"], /LY10/);
  assert.equal(h.templateSent[0].contentSid, "HX123");
});

test("twilio provider + NO approved template → falls back to email", async () => {
  const h = harness({ msgs: [baseMsg({})], provider: "twilio", template: null });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 1);
  assert.equal(h.templateSent.length, 0);
  assert.equal(h.emailsSent.length, 1);
});

test("twilio template skipped (no creds) → falls back to email", async () => {
  const h = harness({
    msgs: [baseMsg({})],
    provider: "twilio",
    template: approvedTemplate,
    templateSendResult: { status: "skipped", reason: "twilio_credentials_missing" },
  });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 1);
  assert.equal(h.templateSent.length, 1, "attempted template");
  assert.equal(h.emailsSent.length, 1, "fell back to email");
});

test("email provider default → always email, never template/bubble", async () => {
  const h = harness({ msgs: [baseMsg({})], provider: "email", template: approvedTemplate });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 1);
  assert.equal(h.emailsSent.length, 1);
  assert.equal(h.templateSent.length, 0);
  assert.equal(h.bubbleSent.length, 0);
});

test("bubblewhats provider → legacy send (opt-in)", async () => {
  const h = harness({ msgs: [baseMsg({})], provider: "bubblewhats" });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 1);
  assert.equal(h.bubbleSent.length, 1);
  assert.match(h.bubbleSent[0].message, /LY10/, "coupon in body");
});

test("no phone + no email → skipped, not sent", async () => {
  const h = harness({
    msgs: [baseMsg({ buyerPhone: null, buyerEmail: null })],
    provider: "twilio",
    template: approvedTemplate,
  });
  const stats = await h.uc.execute();
  assert.equal(stats.sent, 0);
  assert.equal(h.templateSent.length, 0);
  assert.equal(h.emailsSent.length, 0);
});
