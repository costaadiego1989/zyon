import test from "node:test";
import assert from "node:assert/strict";
import { ReturnNoticeSender } from "../../infrastructure/adapters/return-notice.sender.js";
import { ReturnNoticeJob } from "./return-notice.job.js";
import { renderReturnDecisionEmail } from "../../infrastructure/templates/return-decision.template.js";
import { RETURN_NOTICE_TYPES, type ReturnNoticeClaim } from "../../domain/return-notice.js";
import { buildCatalog } from "../../../whatsapp-templates/domain/catalog/template-catalog.js";
import { prepareSalesWhatsApp, salesDefaults, validateSalesEdit } from "../../../whatsapp-templates/domain/sales-template-content.js";
import { SubmitTemplatePackageUseCase } from "../../../whatsapp-templates/application/use-cases/submit-template-package.use-case.js";
import { EmailProviderRejection } from "../../domain/ports/email-provider-rejection.js";

const claim = (channel = "email"): ReturnNoticeClaim => ({ id: "delivery_1", merchantId: "merchant_1", returnId: "return_1",
  ticketId: "sup_ticket_1", type: "return_rejected", channel, attempts: 1, leaseUntil: new Date(Date.now() + 90000),
  createdAt: new Date(), payload: { orderId: "order_29", kind: "exchange", explanation: "A etiqueta está ausente.\nEntre na conversa para consultar a análise.", items: [{ name: "Creme", quantity: 1 }] } });
function setup(options: { emailResult?: unknown; whatsappResult?: unknown; preferences?: unknown; templateStatus?: string; returnStatus?: string; wabaId?: string; email?: string } = {}) {
  const emailCalls: any[] = [], whatsappCalls: any[] = [];
  const prisma = { return: { findFirst: async () => ({ buyerId: "buyer_1", status: options.returnStatus ?? "REJECTED" }) },
    buyerAccount: { findUnique: async () => ({ email: options.email ?? "buyer@recipient.invalid", phone: "+5511999990000", displayName: "Ana" }) },
    merchant: { findUnique: async () => ({ name: "Loja <Exemplo>", storeSlug: "loja-exemplo" }) },
    buyerPreference: { findUnique: async () => options.preferences === undefined ? { emailOptIn: true, whatsappOptIn: true } : options.preferences } };
  const templates = { findByMerchantAndType: async (_merchant: string, type: string, channel: string) => ({
    merchantId: "merchant_1", type, channel, isActive: true, body: buildCatalog()[type as "return_rejected"].freeformBody,
    subject: "{{storeName}} | Análise concluída", metaStatus: options.templateStatus ?? "approved", twilioContentSid: "zyon_return_rejected_v1",
    metaWabaId: options.wabaId ?? "123456789", metaLastCheckedAt: new Date(), metaLanguage: "pt_BR",
    metaVariableMap: { "1": "buyerName", "2": "orderId", "3": "productName", "4": "decisionReason", "5": "link" },
  }) };
  const email = { send: async (input: any) => { emailCalls.push(input); if (options.emailResult instanceof Error) throw options.emailResult;
    return options.emailResult ?? { status: "sent", messageId: "email_1" }; } };
  const whatsapp = { sendTemplate: async (input: any) => { whatsappCalls.push(input); if (options.whatsappResult instanceof Error) throw options.whatsappResult;
    return options.whatsappResult ?? { status: "sent", messageId: "wamid.1" }; } };
  const config = { findByMerchantId: async () => ({ merchantId: "merchant_1", enabled: true, status: "ACTIVE", provider: "META_CLOUD",
    whatsappNumber: "5511999990000", credentials: { accessToken: "test_meta_token", wabaId: "123456789", phoneNumberId: "987654321" } }) };
  const sender = new ReturnNoticeSender(prisma as any, email as any, templates as any, whatsapp as any, config as any, { ensure: async () => undefined } as any);
  return { sender, emailCalls, whatsappCalls };
}
test("return templates use transactional categories and contain the decision and conversation link", () => {
  for (const type of RETURN_NOTICE_TYPES) {
    const definition = buildCatalog()[type];
    assert.equal(definition.category, "UTILITY"); assert.equal(definition.hasCoupon, false);
    const prepared = prepareSalesWhatsApp(type, definition.freeformBody);
    assert.equal(prepared.category, "UTILITY");
    assert.ok(Object.values(prepared.variableMap).includes("decisionReason"));
    assert.ok(Object.values(prepared.variableMap).includes("link"));
    assert.ok(Object.values(prepared.sampleVariables).every(value => value.trim()));
  }
});
test("decision email escapes the human explanation, identifies items, and links to an authenticated conversation", () => {
  const rendered = renderReturnDecisionEmail({ ...claim().payload, explanation: '<img src=x onerror="alert(1)">\nMotivo completo.',
    items: [{ name: "Creme <avariado>", quantity: 1 }], type: "return_rejected", buyerName: "Ana <Cliente>",
    storeName: "Loja", link: "https://storefront.zyon-payments.com.br/store/loja?supportTicket=sup_1" });
  assert.ok(rendered.html.includes("Motivo informado pela loja")); assert.ok(rendered.html.includes("&lt;img"));
  assert.ok(!rendered.html.includes('<img src=x')); assert.ok(rendered.html.includes("1 un."));
  assert.ok(rendered.html.includes("supportTicket=sup_1")); assert.ok(!rendered.html.includes("5-7"));
  assert.throws(() => renderReturnDecisionEmail({ ...claim().payload, type: "return_approved", buyerName: "Ana", storeName: "Loja", link: "javascript:alert(1)" }), /invalid_support_link/);
});
test("WhatsApp connection registration includes all return templates and edits preserve transactional details", async () => {
  const initialized: string[] = [];
  const register = new SubmitTemplatePackageUseCase({ ensure: async (_merchant: string, type: string) => { initialized.push(type); },
    record: async () => ({ metaStatus: "draft" }) } as any);
  const result = await register.execute("merchant_1");
  assert.equal(result.failed, 0);
  for (const type of RETURN_NOTICE_TYPES) assert.ok(initialized.includes(type));
  const defaults = salesDefaults("return_rejected");
  assert.throws(() => validateSalesEdit("return_rejected", { email: defaults.email, whatsapp: { body: "Olá {{buyerName}}", revision: 1 } }), /return_template_variables_required/);
  assert.throws(() => prepareSalesWhatsApp("return_rejected", defaults.whatsapp.body + " {{couponBlock}}"), /transactional_template_required/);
});
test("email and WhatsApp are independent, require provider acknowledgement and use the exact selected items", async () => {
  const { sender, emailCalls, whatsappCalls } = setup();
  const email = await sender.prepare(claim()); assert.ok("send" in email);
  assert.deepEqual(await email.send(), { status: "accepted", providerMessageId: "email_1" });
  const whatsapp = await sender.prepare(claim("whatsapp")); assert.ok("send" in whatsapp);
  assert.deepEqual(await whatsapp.send(), { status: "accepted", providerMessageId: "wamid.1" });
  assert.equal(emailCalls.length, 1); assert.equal(whatsappCalls.length, 1);
  assert.equal(emailCalls[0].requireDelivery, true); assert.equal(emailCalls[0].idempotencyKey, "delivery_1:return-email");
  assert.equal(whatsappCalls[0].contentVariables["3"], "1 × Creme"); assert.ok(!whatsappCalls[0].contentVariables["4"].includes("\n"));
});
test("WhatsApp waits for current WABA approval and requires explicit buyer permission", async () => {
  const noConsent = setup({ preferences: { emailOptIn: true, whatsappOptIn: false } });
  assert.deepEqual(await noConsent.sender.prepare(claim("whatsapp")), { status: "skipped", reason: "whatsapp_permission_missing" });
  assert.equal(noConsent.whatsappCalls.length, 0);
  const pending = setup({ templateStatus: "pending" });
  assert.equal((await pending.sender.prepare(claim("whatsapp")) as any).status, "waiting_template"); assert.equal(pending.whatsappCalls.length, 0);
  const staleConnection = setup({ wabaId: "old_waba" });
  assert.equal((await staleConnection.sender.prepare(claim("whatsapp")) as any).status, "waiting_template");
  const missingPreferences = setup({ preferences: null });
  assert.equal((await missingPreferences.sender.prepare(claim("whatsapp")) as any).status, "skipped");
});
test("uncertain WhatsApp acceptance never sends an email fallback or another message", async () => {
  const { sender, emailCalls, whatsappCalls } = setup({ whatsappResult: new Error("timeout") });
  const prepared = await sender.prepare(claim("whatsapp")); assert.ok("send" in prepared);
  assert.deepEqual(await prepared.send(), { status: "unknown", reason: "whatsapp_acceptance_unknown" });
  assert.equal(emailCalls.length, 0); assert.equal(whatsappCalls.length, 1);
});
test("email configuration, definite rejection and ambiguous acceptance remain distinct", async () => {
  for (const [result, status] of [
    [{ status: "skipped", messageId: "" }, "waiting_configuration"],
    [new EmailProviderRejection("email_rate_limited", true, "rate limited"), "retryable_failed"],
    [new Error("lost provider response"), "unknown"],
  ] as const) {
    const prepared = await setup({ emailResult: result }).sender.prepare(claim()); assert.ok("send" in prepared);
    assert.equal((await prepared.send()).status, status);
  }
});
test("old approvals are superseded by the completed refund, and QA addresses cannot contact providers", async () => {
  const approved = { ...claim(), type: "return_approved" as const };
  assert.deepEqual(await setup({ returnStatus: "REFUND_COMPLETED" }).sender.prepare(approved), { status: "skipped", reason: "decision_superseded" });
  const qa = setup({ email: "buyer@example.test" });
  assert.deepEqual(await qa.sender.prepare(claim()), { status: "skipped", reason: "test_recipient" }); assert.equal(qa.emailCalls.length, 0);
});
test("worker persists an uncertain result after the send begins without retrying a provider", async () => {
  const transitions: string[] = []; let claimed = false;
  const repository = { expireSending: async () => 0, claim: async () => { if (claimed) return null; claimed = true; return claim(); },
    begin: async () => { transitions.push("sending"); return true; },
    finish: async (_claim: unknown, result: any) => { transitions.push(result.status); return true; } };
  const sender = { prepare: async () => ({ send: async () => { throw new Error("unconfirmed"); } }) };
  const job = new ReturnNoticeJob(repository as any, sender as any);
  await job.runOnce(); await job.runOnce();
  assert.deepEqual(transitions, ["sending", "unknown"]);
});
