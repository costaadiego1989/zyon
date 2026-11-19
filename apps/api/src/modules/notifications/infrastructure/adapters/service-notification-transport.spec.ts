import assert from "node:assert/strict";
import test from "node:test";
import { OrderNotificationWhatsAppAdapter } from "./order-notification-whatsapp.adapter.js";
import { SendWhatsAppMessageUseCase } from "../../../whatsapp-templates/application/use-cases/send-whatsapp-message.use-case.js";
import { WhatsAppTemplateSenderAdapter } from "../../../whatsapp-templates/infrastructure/adapters/whatsapp-template-sender.adapter.js";
import { withWhatsAppSubmission } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { operatorConnection } from "../../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";
import { canonicalJson } from "../../../../shared/http/canonical-json.js";

const recipient = "+5521999990000", deliveryId = "service_notification:" + "a".repeat(64);
const input: any = { merchantId: "m", appointmentId: "a", eventId: "e", deliveryId, type: "service_appointment_notice", part: "text", toPhone: recipient,
  freeformText: "Service Professional 03/01/2030 10:00 America/Sao_Paulo BRL 50.00 pending", variables: { appointmentSummary: "Canonical service summary" } };
function fixture(session = true) {
  const config: any = { id: "c", merchantId: "m", provider: "META_CLOUD", enabled: true, status: "ACTIVE", deviceId: "META_CLOUD:c", whatsappNumber: "+5521999999999",
    credentials: { accessToken: "synthetic-token", wabaId: "123456", phoneNumberId: "654321" } };
  const template: any = { id: "template", merchantId: "m", type: "service_appointment_notice", channel: "whatsapp", isActive: true, metaStatus: "approved", twilioContentSid: "service_confirmed",
    metaWabaId: "123456", metaCategory: "UTILITY", metaLastCheckedAt: new Date(), metaLanguage: "pt_BR", metaTemplateBody: "Appointment {{1}}. Thank you.", metaVariableMap: { "1": "appointmentSummary" }, metaRevision: 1 };
  const configs: any = { findByMerchantId: async () => structuredClone(config) }, templates: any = { findByMerchantAndType: async () => structuredClone(template) };
  const sender = new WhatsAppTemplateSenderAdapter(configs, templates, { syncStatus: async () => ({ status: "approved", contentSid: template.twilioContentSid }) } as any);
  const messages = new SendWhatsAppMessageUseCase(templates, sender, undefined, undefined, configs);
  const prisma: any = { merchant: { findUnique: async () => ({ name: "Services" }) }, whatsAppWebhookInbox: { findFirst: async () => session ? { createdAt: new Date(), payload: { provider: "META_CLOUD", merchantId: "m", deviceId: "META_CLOUD:c", fromNumber: recipient, timestamp: Date.now() } } : null } };
  const adapter = new OrderNotificationWhatsAppAdapter(prisma, configs, messages), started: any[] = [];
  const run = async (request = input) => {
    const connection = operatorConnection(config, { merchantId: "m", configId: "c", deviceId: "META_CLOUD:c", provider: "META_CLOUD", accountId: "654321", recipient });
    assert.equal(connection.kind, "ready"); if (connection.kind !== "ready") throw Error("scope unavailable"); const scope = Object.freeze({ ...connection.scope, messageId: deliveryId });
    return withWhatsAppSubmission({ requestScope: scope, startRequest: async (actual, start) => { assert.equal(canonicalJson(actual), canonicalJson(scope)); started.push(actual); return start(); } }, () => adapter.executeService(request));
  };
  return { config, template, adapter, run, started };
}

test("T38 service transport retains merchant/channel/template authority at actual initiation", async t => {
  const originalFetch = globalThis.fetch, posts: any[] = [];
  globalThis.fetch = (async (url: any, init: any) => { posts.push({ url: String(url), ...JSON.parse(init.body) }); return new Response(JSON.stringify({ messages: [{ id: "wamid-service" }] }), { status: 200 }); }) as typeof fetch;
  try {
    await t.test("a service notice without the private submission capability never reaches Meta", async () => {
      const f = fixture(), offset = posts.length, result = await f.adapter.executeService(input); assert.notEqual(result.status, "accepted"); assert.equal(posts.length, offset);
    });
    await t.test("an authenticated open session uses its canonical service body, correlation and merchant account", async () => {
      const f = fixture(), offset = posts.length, result = await f.run(); assert.equal(result.status, "accepted"); assert.equal(result.messageId, "wamid-service");
      assert.equal(f.started.length, 1); assert.equal(posts.length, offset + 1); const post = posts.at(-1);
      assert.match(post.url, /654321\/messages$/); assert.equal(post.biz_opaque_callback_data, deliveryId); assert.equal(post.to, recipient.slice(1)); assert.equal(post.type, "text"); assert.equal(post.text.body, input.freeformText);
    });
    await t.test("outside the session only the exact active approved service utility template can start, with the final capability hook", async () => {
      const f = fixture(false), offset = posts.length, result = await f.run(); assert.equal(result.status, "accepted"); assert.equal(f.started.length, 1); assert.equal(posts.length, offset + 1);
      const post = posts.at(-1); assert.equal(post.type, "template"); assert.equal(post.template.name, "service_confirmed"); assert.equal(post.template.components[0].parameters[0].text, "Canonical service summary"); assert.equal(post.biz_opaque_callback_data, deliveryId);
    });
    await t.test("disabled/unapproved/wrong-WABA service templates cannot fall back to a fake order type or another channel", async () => {
      for (const change of [{ isActive: false }, { metaStatus: "rejected" }, { metaWabaId: "999999" }]) {
        const f = fixture(false); Object.assign(f.template, change); const offset = posts.length; const result = await f.run(); assert.notEqual(result.status, "accepted"); assert.equal(posts.length, offset); assert.equal(f.started.length, 0);
      }
    });
    await t.test("service media uses a distinct part before text and never borrows an order-paid/shipped animation", async () => {
      const f = fixture(), offset = posts.length; const result = await f.run({ ...input, part: "media", mediaUrl: "https://example.test/service.webp" });
      assert.equal(result.status, "accepted"); assert.equal(posts.length, offset + 1); assert.equal(posts.at(-1).type, "sticker"); assert.equal(posts.at(-1).sticker.link, "https://example.test/service.webp");
    });
    await t.test("service template parameters compact line breaks while freeform preserves the complete readable body", async () => {
      const summary = "Service\nProfessional\t03/01/2030\r\n10:00 America/Sao_Paulo\nBRL 50.00 pending";
      const templated = fixture(false), offset = posts.length; await templated.run({ ...input, freeformText: summary, variables: { appointmentSummary: summary } });
      assert.equal(posts.length, offset + 1); const value = posts.at(-1).template.components[0].parameters[0].text;
      assert.doesNotMatch(value, /[\r\n\t]/);
      for (const fact of ["Service", "Professional", "03/01/2030", "10:00", "America/Sao_Paulo", "50.00", "pending"]) assert.ok(value.includes(fact), fact);
      const session = fixture(true); await session.run({ ...input, freeformText: summary, variables: { appointmentSummary: summary } });
      assert.equal(posts.at(-1).text.body, summary);
    });
  } finally { globalThis.fetch = originalFetch; }
});
