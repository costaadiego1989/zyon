import assert from "node:assert/strict";
import test from "node:test";
import { OrderQuotaNoticeSenderAdapter } from "./order-quota-notice.sender.js";

const notice = {
  id: "notice_1",
  merchantId: "merchant_1",
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  episodeKey: "episode_1",
  milestone: "limit",
  title: "Limite atingido",
  body: "A loja continuará recebendo pedidos por 72 horas.",
  metadata: {},
  createdAt: new Date("2026-09-10T12:00:00.000Z"),
};

test("quota WhatsApp notification is sent only with an active Meta connection, approved template and merchant recipient", async () => {
  const calls: unknown[] = [];
  const prisma = {
    merchant: { findUnique: async () => ({ name: "Loja Azul", budgetWhatsapp: "+5511999999999", storeSettings: {} }) },
    merchantUser: { findFirst: async () => ({ email: "owner@example.test" }) },
    whatsAppChannelConfig: { findUnique: async () => ({ enabled: true, status: "ACTIVE", provider: "META_CLOUD" }) },
    postSaleMessageTemplate: { findUnique: async () => ({ isActive: true, metaStatus: "approved", twilioContentSid: "HX_QUOTA", metaLanguage: "pt_BR" }) },
  };
  const sender = new OrderQuotaNoticeSenderAdapter(
    prisma as any,
    { send: async () => ({ status: "sent", messageId: "email_1" }) } as any,
    { sendTemplate: async (input: unknown) => { calls.push(input); return { status: "queued", messageId: "wa_1" }; } } as any,
  );

  const prepared = await sender.prepare(notice, "whatsapp");
  assert.ok("send" in prepared);
  assert.deepEqual(await prepared.send(), { status: "accepted", providerMessageId: "wa_1" });
  assert.deepEqual(calls, [{
    merchantId: "merchant_1", type: "order_quota", toNumber: "+5511999999999",
    contentSid: "HX_QUOTA", language: "pt_BR",
    contentVariables: {
      "1": "Loja Azul", "2": "Limite atingido", "3": "A loja continuará recebendo pedidos por 72 horas.",
    },
  }]);
});

test("quota WhatsApp notification is skipped when the merchant has no active integration", async () => {
  const sender = new OrderQuotaNoticeSenderAdapter(
    {
      merchant: { findUnique: async () => ({ name: "Loja Azul", budgetWhatsapp: "+5511999999999", storeSettings: {} }) },
      merchantUser: { findFirst: async () => ({ email: "owner@example.test" }) },
      whatsAppChannelConfig: { findUnique: async () => null },
      postSaleMessageTemplate: { findUnique: async () => null },
    } as any,
    { send: async () => ({ status: "sent", messageId: "email_1" }) } as any,
    { sendTemplate: async () => { throw new Error("must_not_send"); } } as any,
  );

  assert.deepEqual(await sender.prepare(notice, "whatsapp"), {
    status: "skipped", reason: "merchant_whatsapp_not_integrated",
  });
});

test("quota email targets the active merchant owner and requires provider delivery", async () => {
  const calls: unknown[] = [];
  const sender = new OrderQuotaNoticeSenderAdapter(
    {
      merchant: { findUnique: async () => ({ name: "Loja Azul", budgetWhatsapp: null, storeSettings: {} }) },
      merchantUser: { findFirst: async () => ({ email: "owner@example.test" }) },
      whatsAppChannelConfig: { findUnique: async () => null },
      postSaleMessageTemplate: { findUnique: async () => null },
    } as any,
    { send: async (input: unknown) => { calls.push(input); return { status: "sent", messageId: "email_1" }; } } as any,
    { sendTemplate: async () => ({ status: "skipped", messageId: "" }) } as any,
  );

  const prepared = await sender.prepare(notice, "email");
  assert.ok("send" in prepared);
  assert.deepEqual(await prepared.send(), { status: "accepted", providerMessageId: "email_1" });
  assert.equal((calls[0] as { to: string; requireDelivery: boolean }).to, "owner@example.test");
  assert.equal((calls[0] as { to: string; requireDelivery: boolean }).requireDelivery, true);
});
