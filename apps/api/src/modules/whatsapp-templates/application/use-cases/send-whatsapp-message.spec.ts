import test from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";

function harness(type = "loyalty", options: { linkSlot?: boolean; status?: string; active?: boolean; waba?: string; config?: boolean; result?: any; emailResult?: any; throwing?: boolean } = {}) {
  const calls = { whatsapp: [] as any[], email: [] as any[], legacy: 0 };
  const tpl = { merchantId: "m1", type, channel: "whatsapp", isActive: options.active ?? true, metaStatus: options.status ?? "approved",
    twilioContentSid: "zyon_test", metaWabaId: options.waba ?? "123456789", metaLastCheckedAt: new Date(), metaLanguage: "pt_BR",
    metaTemplateBody: options.linkSlot === false ? "Ola {{1}}." : "Ola {{1}}, retome sua compra: {{2}}.", metaVariableMap: { "1": "buyerName", "2": "link" } };
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

test("cart recovery refuses a missing, insecure or malformed link before contacting providers", async () => {
  for (const link of [undefined, "", "javascript:alert(1)", "https://user:password@store.example", "http://store.example"]) {
    const h = harness("cart_recovery");
    const result = await h.sender.execute({ ...input, type: "cart_recovery", variables: { link } });
    assert.equal(result.status, "skipped");
    assert.equal(h.calls.whatsapp.length + h.calls.email.length, 0);
  }
});
test("Meta recovery needs the approved BODY slot for its runtime link", async () => {
  const { hasRecoveryLinkSlot } = await import("./send-whatsapp-message.use-case.js");
  assert.equal(hasRecoveryLinkSlot({ metaVariableMap: { "1": "link" }, metaTemplateBody: "Retome em {{1}}." }), true);
  for (const template of [
    { metaVariableMap: { "1": "link" }, metaTemplateBody: "Retome em https://example.com." },
    { metaVariableMap: { "1": "buyerName" }, metaTemplateBody: "Ola {{1}}." },
    { metaVariableMap: {} as Record<string, string>, metaTemplateBody: "{{1}}" },
  ]) assert.equal(hasRecoveryLinkSlot(template), false);
});

test("approved Meta template without its link slot falls back to the same URL in email", async () => {
  const h = harness("cart_recovery", { linkSlot: false });
  const link = "https://store.example/store/test?show=checkout&recovery=signed";
  assert.equal((await h.sender.execute({ ...input, type: "cart_recovery", variables: { link } })).channel, "email");
  assert.equal(h.calls.whatsapp.length, 0);
  assert.ok(h.calls.email[0].html.includes('href="' + link.replace(/&/g, "&amp;") + '"'));
});
