import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import { SendWhatsAppMessageUseCase } from "./send-whatsapp-message.use-case.js";
import { WhatsAppTemplateSenderAdapter } from "../../infrastructure/adapters/whatsapp-template-sender.adapter.js";
import type { WhatsAppTemplateRecord } from "../../domain/ports/whatsapp-template-repository.port.js";

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

function setup(options: { providerStatus?: string; providerReason?: string; changeRevision?: boolean; changeBody?: boolean; revoke?: boolean; response?: Response; timeout?: boolean } = {}) {
  const state = { emails: 0, sends: 0, checks: 0, authorized: true };
  const config = { id: "config-a", merchantId: "merchant-a", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    credentials: { accessToken: "test-token", wabaId: "123456789", phoneNumberId: "987654321" } };
  const template: Partial<WhatsAppTemplateRecord> = { id: "template-a", merchantId: "merchant-a", type: "cart_recovery", channel: "whatsapp", isActive: true,
    metaStatus: "approved", twilioContentSid: "recovery_a", metaLanguage: "pt_BR", metaWabaId: "123456789", metaCategory: "MARKETING",
    metaRevision: 2, metaLastCheckedAt: new Date(Date.now() - 60 * 60_000), metaTemplateBody: "Olá {{1}}, retome {{2}}", metaVariableMap: { "1": "buyerName", "2": "link" } };
  const repo = { findByMerchantAndType: async (_merchant: string, _type: string, channel: string) => channel === "email" ? null : { ...template } };
  const configs = { findByMerchantId: async () => config };
  const submission = { createAndSubmit: async () => assert.fail("must never create a template during dispatch"), syncStatus: async () => {
    state.checks++;
    if (options.changeRevision) template.metaRevision = 3;
    if (options.changeBody) template.metaTemplateBody = "Other content {{1}} {{2}}";
    if (options.revoke) state.authorized = false;
    return { status: options.providerStatus ?? "approved", contentSid: "recovery_a", rejectionReason: options.providerReason };
  } };
  globalThis.fetch = (async () => { state.sends++; if (options.timeout) throw Error("transport timeout with sensitive data"); return options.response ?? Response.json({ messages: [{ id: "wamid.accepted" }] }); }) as typeof fetch;
  const sender = new WhatsAppTemplateSenderAdapter(configs as any, repo as any, submission as any);
  const router = new SendWhatsAppMessageUseCase(repo as any, sender, undefined, { send: async () => { state.emails++; return { status: "sent", messageId: "email-accepted" }; } } as any, configs as any);
  const input = { merchantId: "merchant-a", type: "cart_recovery" as const, toPhone: "11999991111", fallbackEmail: "buyer@example.test",
    variables: { buyerName: "Ana", storeName: "Loja A", link: "https://shop.example.test/recovery" }, freeformText: "Retome a compra",
    assertDispatchAuthorized: async () => { if (!state.authorized) throw Error("withdrawn"); } };
  return { state, router, input };
}

test("stale approved recovery is freshly verified against Meta and sent once on WhatsApp", async () => {
  const h = setup();
  assert.deepEqual(await h.router.execute(h.input), { channel: "whatsapp_template", status: "sent", messageId: "wamid.accepted" });
  assert.deepEqual(h.state, { emails: 0, sends: 1, checks: 1, authorized: true });
});

for (const status of ["unknown", "rejected", "paused", "disabled"]) test(`fresh provider ${status} never releases a stale local approval`, async () => {
  const h = setup({ providerStatus: status });
  const result = await h.router.execute(h.input);
  assert.equal(result.channel, "email");
  assert.equal(result.status, "sent");
  assert.equal(result.fallbackReason, "approved_template_unavailable");
  assert.equal(h.state.sends, 0);
  assert.equal(h.state.checks, 1);
});

for (const change of ["changeRevision", "changeBody"] as const) test(`${change} during provider verification prevents dispatch of the old revision`, async () => {
  const h = setup({ [change]: true });
  assert.equal((await h.router.execute(h.input)).fallbackReason, "template_revision_changed");
  assert.equal(h.state.sends, 0);
});

test("activity or consent change during template verification prevents both physical channels", async () => {
  const h = setup({ revoke: true });
  const result = await h.router.execute(h.input);
  assert.equal(result.status, "skipped");
  assert.equal(result.reason, "notification_authority_changed");
  assert.equal(h.state.sends, 0);
  assert.equal(h.state.emails, 0);
});

test("verified provider rejection preserves numeric diagnostic codes without raw error text", async () => {
  const h = setup({ response: Response.json({ error: { code: 131049, error_subcode: 42, message: "secret recipient and token" } }, { status: 400 }) });
  const result = await h.router.execute(h.input);
  assert.equal(result.channel, "email");
  assert.equal(result.fallbackReason, "meta_http_400_code_131049_subcode_42");
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.equal(h.state.sends, 1);
  assert.equal(h.state.emails, 1);
});

test("ambiguous WhatsApp acceptance never creates a second email contact", async () => {
  const h = setup({ timeout: true });
  const result = await h.router.execute(h.input);
  assert.equal(result.channel, "whatsapp_template");
  assert.equal(result.status, "uncertain");
  assert.equal(h.state.sends, 1);
  assert.equal(h.state.emails, 0);
});
