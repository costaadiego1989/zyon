import assert from "node:assert/strict";
import test from "node:test";
import { WhatsAppTemplateSenderAdapter } from "./whatsapp-template-sender.adapter.js";
import { withWhatsAppSubmission } from "../../../../shared/whatsapp/whatsapp-automation-context.js";
import { operatorConnection } from "../../../whatsapp-channel/domain/services/whatsapp-operator-connection.js";

function fixture() {
  const config = { id: "config-a", merchantId: "merchant-a", provider: "META_CLOUD", status: "ACTIVE", enabled: true,
    credentials: { phoneNumberId: "90001001", wabaId: "90001999", accessToken: "synthetic-staff-token" } };
  const template = { id: "template-a", merchantId: "merchant-a", type: "support_case_alert", channel: "whatsapp", isActive: true,
    metaStatus: "approved", metaWabaId: "90001999", metaRevision: 1, metaLanguage: "pt_BR", metaCategory: "UTILITY", metaLastCheckedAt: new Date(),
    metaTemplateBody: "Novo atendimento em {{1}}. Abra {{2}}. Obrigado.", metaVariableMap: { "1": "storeName", "2": "dashboardLink" }, twilioContentSid: "staff_alert" };
  const connection = operatorConnection(config as never, { merchantId: "merchant-a", configId: "config-a", deviceId: "META_CLOUD:config-a", provider: "META_CLOUD", accountId: "90001001", recipient: "+5511999991111" });
  assert.equal(connection.kind, "ready"); if (connection.kind !== "ready") throw Error();
  const scope = Object.freeze({ ...connection.scope, messageId: "support_case_alert:" + "a".repeat(64) });
  const input = { merchantId: "merchant-a", type: "support_case_alert" as const, correlationId: scope.messageId, toNumber: scope.recipient!, contentSid: "staff_alert", language: "pt_BR",
    contentVariables: { "1": "Synthetic store", "2": "https://app.example.test/#whatsapp-seller?tab=conversations&ticketId=opaque" } };
  return { config, template, scope, input };
}
test("HUM-10 a staff template outside the durable submission frame makes no network request", async () => {
  const f = fixture(), adapter = new WhatsAppTemplateSenderAdapter();
  assert.deepEqual(await adapter.sendTemplate(f.input), { status: "skipped", messageId: "", reason: "staff_alert_submission_required" });
});
test("HUM-10 staff template uses exactly the original config, account, recipient and minimal variables at the request boundary", async () => {
  const f = fixture(), previous = globalThis.fetch, requests: Array<{ url: string; body: unknown }> = [], configs: string[] = [];
  globalThis.fetch = (async (url, init) => { requests.push({ url: String(url), body: JSON.parse(String(init?.body)) }); return Response.json({ messages: [{ id: "synthetic-staff-template" }] }); }) as typeof fetch;
  try {
    const adapter = new WhatsAppTemplateSenderAdapter({ findById: async (id: string) => { configs.push(id); return f.config; }, findByMerchantId: async () => { throw Error("must not switch configs"); } } as never,
      { findByMerchantAndType: async () => f.template } as never);
    const result = await withWhatsAppSubmission({ requestScope: f.scope, startRequest: (scope, start) => { assert.deepEqual(scope, f.scope); return start(); } }, () => adapter.sendTemplate(f.input));
    assert.deepEqual(result, { status: "sent", messageId: "synthetic-staff-template" }); assert.deepEqual(configs, ["config-a"]);
    assert.deepEqual(requests, [{ url: "https://graph.facebook.com/v23.0/90001001/messages", body: { messaging_product: "whatsapp", to: "5511999991111", type: "template",
      template: { name: "staff_alert", language: { code: "pt_BR" }, components: [{ type: "body", parameters: [{ type: "text", text: f.input.contentVariables["1"] }, { type: "text", text: f.input.contentVariables["2"] }] }] }, biz_opaque_callback_data: f.scope.messageId } }]);
  } finally { globalThis.fetch = previous; }
});
test("HUM-10 unapproved or customer-data template variables cannot cross the staff boundary", async () => {
  const f = fixture(); let invoked = 0;
  for (const patch of [{ metaStatus: "draft" }, { metaVariableMap: { "1": "buyerName", "2": "dashboardLink" } }, { metaWabaId: "other" }]) {
    const adapter = new WhatsAppTemplateSenderAdapter({ findById: async () => f.config } as never, { findByMerchantAndType: async () => ({ ...f.template, ...patch }) } as never);
    const result = await withWhatsAppSubmission({ requestScope: f.scope, startRequest: async () => { invoked++; throw Error("must not submit"); } }, () => adapter.sendTemplate(f.input));
    assert.equal(result.status, "skipped");
  }
  assert.equal(invoked, 0);
});
test("HUM-10 a changed credential digest cannot replace the original staff attempt even on the same account", async () => {
  const f = fixture(); let invoked = 0;
  const adapter = new WhatsAppTemplateSenderAdapter({ findById: async () => ({ ...f.config, credentials: { ...f.config.credentials, accessToken: "synthetic-new-token" } }) } as never,
    { findByMerchantAndType: async () => f.template } as never);
  const result = await withWhatsAppSubmission({ requestScope: f.scope, startRequest: async () => { invoked++; throw Error("must not submit"); } }, () => adapter.sendTemplate(f.input));
  assert.equal(result.status, "skipped"); assert.equal(invoked, 0);
});
