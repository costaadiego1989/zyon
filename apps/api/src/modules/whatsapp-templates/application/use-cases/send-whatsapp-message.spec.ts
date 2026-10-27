import test from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import { WHATSAPP_TEMPLATE_TYPES } from "../../domain/catalog/template-types.js";
import { buildCatalog } from "../../domain/catalog/template-catalog.js";

function harness(type = "loyalty", options: { status?: string; active?: boolean; waba?: string; config?: boolean; result?: any; emailResult?: any; throwing?: boolean } = {}) {
  const calls = { whatsapp: [] as any[], email: [] as any[], legacy: 0 };
  const tpl = { merchantId: "m1", type, channel: "whatsapp", isActive: options.active ?? true, metaStatus: options.status ?? "approved",
    twilioContentSid: "zyon_test", metaWabaId: options.waba ?? "123456789", metaLastCheckedAt: new Date(), metaLanguage: "pt_BR",
    metaTemplateBody: "Olá {{1}}, retome em {{2}}.", metaVariableMap: { "1": "buyerName", "2": "link" } };
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

test("plan expiry cannot inherit an order subject from a saved template or caller", async () => {
  for (const milestone of ["7d", "3d", "24h", "expired"] as const) {
    for (const stored of [true, false]) {
      const type = `plan_expiry_${milestone}` as const;
      const emails: any[] = [];
      const repo = { findByMerchantAndType: async () => stored ? {
        merchantId: "m1", type, channel: "email", isActive: true,
        subject: "Pedido confirmado", body: "Plano {{planName}} termina em {{expiresAt}}.",
      } : null } as any;
      const sender = new SendWhatsAppMessageUseCase(repo, undefined, undefined,
        { send: async email => { emails.push(email); return { status: "sent", messageId: "email-plan" }; } });
      const result = await sender.execute({ merchantId: "m1", type, fallbackEmail: "owner@example.test",
        emailSubject: "Seu pedido está a caminho", freeformText: "Consulte a renovação do plano.",
        variables: { planName: "Growth", expiresAt: "19/10/2026, 09:00" } });
      assert.equal(result.status, "sent");
      assert.equal(emails.length, 1);
      assert.match(emails[0].subject, /Zyon.*Renovação do plano/);
      assert.doesNotMatch(emails[0].subject, /pedido|carrinho|\{\{/i);
      if (milestone !== "expired") assert.match(emails[0].subject, new RegExp(milestone === "24h" ? "24 horas" : milestone === "3d" ? "3 dias" : "7 dias"));
      assert.equal(emails[0].requireDelivery, true);
    }
  }
});

test("missing email subject uses the event's default while a merchant campaign subject is retained", async () => {
  for (const subject of [null, "", "   ", "{{storeName}} | Uma mensagem para você"]) {
    const emails: any[] = [];
    const repo = { findByMerchantAndType: async () => ({ merchantId: "m1", type: "review_request", channel: "email",
      isActive: true, subject, body: "Conte o que achou." }) } as any;
    const sender = new SendWhatsAppMessageUseCase(repo, undefined, undefined,
      { send: async email => { emails.push(email); return { status: "sent", messageId: "email-review" }; } });
    await sender.execute({ merchantId: "m1", type: "review_request", fallbackEmail: "buyer@example.test", variables: { storeName: "Loja\r\nTeste" } });
    assert.equal(emails[0].subject, subject?.trim() ? "Loja Teste | Uma mensagem para você" : "Loja Teste | Conte o que achou da sua compra");
  }
});

test("saved platform email defaults are revised at dispatch while custom copy is preserved", async () => {
  for (const custom of [false, true]) {
    const type = "review_request";
    const original = buildCatalog()[type];
    const emails: any[] = [];
    const repo = { findByMerchantAndType: async () => ({ merchantId: "m1", type, channel: "email", isActive: true,
      subject: custom ? "{{storeName}} | Texto personalizado" : `{{storeName}} | ${original.label}`,
      body: custom ? "Texto próprio da loja para {{buyerName}}." : original.freeformBody.replace(/\n/g, "\r\n"),
    }) } as any;
    const sender = new SendWhatsAppMessageUseCase(repo, undefined, undefined,
      { send: async email => { emails.push(email); return { status: "sent", messageId: "review-email" }; } });
    await sender.execute({ merchantId: "m1", type, fallbackEmail: "buyer@example.test", variables: { buyerName: "Ana", storeName: "Loja", productName: "Mouse" } });
    if (custom) {
      assert.equal(emails[0].subject, "Loja | Texto personalizado");
      assert.match(emails[0].html, /Texto próprio da loja para Ana/);
    } else {
      assert.equal(emails[0].subject, "Loja | Conte o que achou da sua compra");
      assert.doesNotMatch(emails[0].html, /Responda|aqui mesmo/i);
      assert.match(emails[0].html, /atendimento da loja/);
    }
  }
});
