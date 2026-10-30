import test from "node:test";
import assert from "node:assert/strict";
import { PrismaMerchantNotificationInboxRepository } from "../../infrastructure/repositories/prisma-merchant-notification-inbox.repository.js";
import { SendOrderConfirmationUseCase } from "./send-order-confirmation.use-case.js";
import { SendMerchantOrderNotificationUseCase } from "./send-merchant-order-notification.use-case.js";
import { SendOrderShippedUseCase } from "./send-order-shipped.use-case.js";
import { SendOrderDeliveredUseCase } from "./send-order-delivered.use-case.js";

const event = { type: "ORDER_CONFIRMATION" as const, merchantId: "merchant-a", merchantName: "Loja A",
  orderId: "order-1", orderNumber: "1001", buyerEmail: "buyer@example.test", buyerName: "Buyer",
  buyerPhone: "5521993001883", items: [{ name: "Produto", price: "3.00", quantity: 1 }], total: "3.00" };
const rawMerchant = (phone = "21993001883", budgetWhatsapp: string | null = null) => ({ id: "merchant-a", name: "Loja A",
  budgetEmail: null, budgetWhatsapp, storeSettings: { company: { phone } }, users: [{ email: "owner@example.test" }],
  whatsappChannelConfig: { enabled: true, status: "ACTIVE", whatsappNumber: "5521971191446", phoneNumber: null } });
const contact = (merchant: unknown) => new PrismaMerchantNotificationInboxRepository({ merchant: { findUnique: async () => merchant } } as any).getContact("merchant-a");

test("merchant order routing uses the operational company contact instead of the connected sender", async () => {
  assert.equal((await contact(rawMerchant()))?.whatsappPhone, "+5521993001883");
  assert.equal((await contact(rawMerchant("21993001883", "+5511988887777")))?.whatsappPhone, "+5511988887777");
});

test("merchant operational contact cannot fall back to or target its own connected sender", async () => {
  assert.equal((await contact(rawMerchant("+5521971191446")))?.whatsappPhone, undefined);
  assert.equal((await contact(rawMerchant("")))?.whatsappPhone, undefined);
});

test("buyer approved-template dispatch remains independent of an email failure", async () => {
  const inputs: any[] = [];
  const useCase = new SendOrderConfirmationUseCase({ send: async () => { throw Error("email_rejected"); } },
    { send: async () => { throw Error("legacy_transport_forbidden"); } },
    { execute: async input => { inputs.push(input); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid.buyer" }; } });
  await assert.rejects(useCase.execute(event), /email_rejected/);
  assert.equal(inputs.length, 1);
});

test("buyer template receives canonical store branding and an order-scoped replay key", async () => {
  const inputs: any[] = [], emails: any[] = [];
  const useCase = new SendOrderConfirmationUseCase({ send: async input => { emails.push(input); return { status: "sent", messageId: "email-1" }; } },
    { send: async () => { throw Error("legacy_transport_forbidden"); } },
    { execute: async input => { inputs.push(input); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid.buyer" }; } });
  await useCase.execute(event);
  assert.equal(inputs[0].variables.storeName, "Loja A");
  assert.equal(inputs[0].idempotencyKey, "order-1");
  assert.ok(emails[0].idempotencyKey);
});

test("a nonphysical buyer order selects its approved notification type", async () => {
  const inputs: any[] = [];
  const useCase = new SendOrderConfirmationUseCase({ send: async () => ({ status: "sent", messageId: "email-1" }) },
    { send: async () => { throw Error("legacy_transport_forbidden"); } },
    { execute: async input => { inputs.push(input); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid.buyer" }; } });
  await useCase.execute({ ...event, items: [{ ...event.items[0], productType: "digital" }] });
  assert.equal(inputs[0].type, "order_nonphysical_confirmation");
});

test("merchant checkout notifications use the scoped port and preserve dashboard and email when WhatsApp skips", async () => {
  const requests: any[] = [], dashboard: any[] = [], emails: any[] = [];
  const inbox: any = { getContact: async () => ({ merchantName: "Loja A", supportEmail: "ops@example.test", whatsappPhone: "+5521993001883", whatsappConnected: true }),
    create: async (request: any) => { dashboard.push(request); } };
  const useCase = new SendMerchantOrderNotificationUseCase(inbox, { send: async request => { emails.push(request); return { status: "sent", messageId: "email-1" }; } },
    { execute: async request => { requests.push(request); return { status: "skipped", channel: "none", reason: "merchant_approved_template_required" }; } });
  await useCase.execute(event);
  assert.equal(requests[0].type, "merchant_order_paid");
  assert.equal(requests[0].orderId, "order-1");
  assert.equal(requests[0].toPhone, "+5521993001883");
  assert.equal(dashboard[0].type, "order_paid");
  assert.equal(emails[0].to, "ops@example.test");
  assert.ok(emails[0].idempotencyKey);
});

test("shipped WhatsApp remains independent of an email failure", async () => {
  const inputs: any[] = [];
  const useCase = new SendOrderShippedUseCase({ send: async () => { throw Error("email_rejected"); } },
    { send: async () => { throw Error("legacy_transport_forbidden"); } },
    { execute: async input => { inputs.push(input); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid.shipped" }; } });
  await assert.rejects(useCase.execute({ type: "ORDER_SHIPPED", merchantId: event.merchantId, orderId: event.orderId,
    buyerPhone: event.buyerPhone, buyerEmail: event.buyerEmail, trackingNumber: "BR123456789AA" }), /email_rejected/);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].type, "order_shipped");
  assert.equal(inputs[0].idempotencyKey, "order-1:BR123456789AA");
});

test("delivered WhatsApp remains independent of an email failure", async () => {
  const inputs: any[] = [];
  const useCase = new SendOrderDeliveredUseCase({ send: async () => { throw Error("email_rejected"); } },
    { send: async () => { throw Error("legacy_transport_forbidden"); } },
    { execute: async input => { inputs.push(input); return { status: "accepted", channel: "whatsapp_template", messageId: "wamid.delivered" }; } });
  await assert.rejects(useCase.execute({ type: "ORDER_DELIVERED", merchantId: event.merchantId, orderId: event.orderId,
    buyerPhone: event.buyerPhone, buyerEmail: event.buyerEmail }), /email_rejected/);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].type, "order_delivered");
  assert.equal(inputs[0].idempotencyKey, "order-1");
});
