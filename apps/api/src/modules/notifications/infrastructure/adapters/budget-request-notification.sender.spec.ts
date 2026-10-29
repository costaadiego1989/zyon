import test from "node:test";
import assert from "node:assert/strict";
import { BudgetRequestNotificationSender } from "./budget-request-notification.sender.js";
import type { MerchantNotificationInboxPort } from "../../domain/ports/merchant-notification-inbox.port.js";
import type { EmailSenderPort, SendEmailInput } from "../../domain/ports/email-sender.port.js";
import type { WhatsAppSenderPort } from "../../domain/ports/whatsapp-sender.port.js";

const request = {
  id: "budget-1", merchantId: "merchant-1", merchantName: "Loja teste", customerName: "Ana",
  customerEmail: "ana@example.test", customerPhone: "11999999999", total: 125.5,
  items: [{ productName: "Produto <especial>", quantity: 2, price: 62.75 }], note: "Preciso para sexta-feira",
};

function contact(overrides: Partial<Awaited<ReturnType<MerchantNotificationInboxPort["getContact"]>> & object> = {}): MerchantNotificationInboxPort {
  return {
    list: async () => [], create: async () => undefined, markRead: async () => undefined, markAllRead: async () => undefined,
    getContact: async () => ({
      merchantId: "merchant-1", merchantName: "Loja teste", ownerEmail: "owner@example.test",
      budgetEmail: "quotes@example.test", budgetWhatsapp: "11988887777", whatsappConnected: true,
      ...overrides,
    }),
  };
}

test("budget request email uses the configured quote address and requires provider acceptance", async () => {
  const emails: SendEmailInput[] = [];
  const email: EmailSenderPort = { async send(input) { emails.push(input); return { status: "sent", messageId: "resend-1" }; } };
  const whatsapp: WhatsAppSenderPort = { async send() { return { status: "accepted" }; } };
  const sender = new BudgetRequestNotificationSender(contact(), email, whatsapp);
  const prepared = await sender.prepare(request, "email");
  assert.ok("send" in prepared);
  assert.deepEqual(await prepared.send(), { status: "accepted", providerMessageId: "resend-1" });
  assert.equal(emails[0]?.to, "quotes@example.test");
  assert.equal(emails[0]?.requireDelivery, true);
  assert.equal(emails[0]?.idempotencyKey, "budget-1:budget-email");
  assert.match(emails[0]?.html ?? "", /Produto &lt;especial&gt;/);
});

test("budget request WhatsApp uses its configured recipient only when the merchant channel is connected", async () => {
  const sent: Array<{ phone: string; message: string }> = [];
  const whatsapp: WhatsAppSenderPort = { async send(message) { sent.push(message); return { status: "accepted" }; } };
  const email: EmailSenderPort = { async send() { return { status: "sent", messageId: "resend-1" }; } };
  const sender = new BudgetRequestNotificationSender(contact(), email, whatsapp);
  const prepared = await sender.prepare(request, "whatsapp");
  assert.ok("send" in prepared);
  assert.deepEqual(await prepared.send(), { status: "accepted" });
  assert.equal(sent[0]?.phone, "11988887777");
  assert.match(sent[0]?.message ?? "", /Nova solicitação de orçamento/);

  const unavailable = new BudgetRequestNotificationSender(contact({ whatsappConnected: false }), email, whatsapp);
  assert.deepEqual(await unavailable.prepare(request, "whatsapp"), { status: "skipped", reason: "merchant_whatsapp_not_connected" });
});
