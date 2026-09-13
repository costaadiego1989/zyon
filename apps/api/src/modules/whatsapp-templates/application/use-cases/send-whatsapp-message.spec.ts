import test from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

function harness(type = "loyalty", options: { status?: string; active?: boolean; waba?: string; config?: boolean; result?: any; emailResult?: any; throwing?: boolean } = {}) {
  const calls = { whatsapp: [] as any[], email: [] as any[], legacy: 0 };
  const tpl = { merchantId: "m1", type, channel: "whatsapp", isActive: options.active ?? true, metaStatus: options.status ?? "approved",
    twilioContentSid: "zyon_test", metaWabaId: options.waba ?? "123456789", metaLastCheckedAt: new Date(), metaLanguage: "pt_BR",
    metaVariableMap: { "1": "buyerName", "2": "link" } };
  const repo = { async findByMerchantAndType(_m: string, _t: string, channel: string) { return channel === "whatsapp" ? tpl : { ...tpl, channel: "email", isActive: true, subject: "{{storeName}}", body: "Olá {{buyerName}}! <script>bad</script> {{link}}" }; } } as any;
  const configs = { async findByMerchantId() { return options.config === false ? null : { merchantId: "m1", provider: "META_CLOUD", enabled: true, status: "ACTIVE", credentials: { accessToken: "token", wabaId: "123456789", phoneNumberId: "987654321" } }; } } as any;
  const sender = new SendWhatsAppMessageUseCase(repo, { async sendTemplate(input) { calls.whatsapp.push(input); if (options.throwing) throw new Error("timeout"); return options.result ?? { status: "sent", messageId: "wamid.1" }; } },
    { async send() { calls.legacy++; return { status: "accepted" }; } }, { async send(input) { calls.email.push(input); return options.emailResult ?? { status: "queued", messageId: "email.1" }; } }, configs);
  return { sender, calls };
}
const input = { merchantId: "m1", type: "loyalty" as const, toPhone: "+5511999991111", fallbackEmail: "buyer@example.test", freeformText: "hello", variables: { buyerName: "Ana", storeName: "Loja", link: "https://loja.example/pedido" } };
for (const type of WHATSAPP_TEMPLATE_TYPES) test(`${type}: active merchant approval uses official WhatsApp`, async () => {
  const h = harness(type);
  assert.equal((await h.sender.execute({ ...input, type })).messageId, "wamid.1");
  assert.equal(h.calls.email.length + h.calls.legacy, 0);
  assert.equal(h.calls.whatsapp[0].type, type);
});
for (const options of [{ config: false }, { active: false }, { waba: "another-account" }, ...["draft", "submitted", "rejected", "paused", "disabled"].map(status => ({ status }))]) test(`unavailable approval falls back before dispatch: ${JSON.stringify(options)}`, async () => {
  const h = harness("loyalty", options);
  assert.equal((await h.sender.execute(input)).channel, "email");
  assert.equal(h.calls.whatsapp.length + h.calls.legacy, 0);
  assert.equal(h.calls.email[0].requireDelivery, true);
  assert.match(h.calls.email[0].html, /&lt;script&gt;/);
  assert.equal(h.calls.email[0].subject, "Loja");
});
for (const options of [{ throwing: true }, { result: { status: "uncertain", messageId: "" } }, { result: { status: "sent", messageId: "" } }]) test("ambiguous acceptance holds the original channel without email or retry", async () => {
  const h = harness("loyalty", options);
  assert.equal((await h.sender.execute(input)).status, "uncertain");
  assert.equal(h.calls.email.length, 0);
});
test("a proven rejection allows one fallback email", async () => {
  const h = harness("loyalty", { result: { status: "failed", messageId: "", acceptance: "not_accepted" } });
  assert.equal((await h.sender.execute(input)).channel, "email");
  assert.equal(h.calls.email.length, 1);
});
test("email logging fallback never counts as delivery", async () => {
  const h = harness("loyalty", { config: false, emailResult: { status: "skipped", messageId: "" } });
  assert.equal((await h.sender.execute(input)).status, "skipped");
});
