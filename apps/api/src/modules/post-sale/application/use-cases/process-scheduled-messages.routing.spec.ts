import test from "node:test";
import assert from "node:assert/strict";
import { ProcessScheduledMessagesUseCase } from "./process-scheduled-messages.use-case.js";
import { PostSaleAiCopywriterService } from "../services/post-sale-ai-copywriter.service.js";

function harness(result: any, overrides: any = {}, campaignConsent?: any) {
  const updates: any[] = []; const sent: any[] = []; const contexts: any[] = [];
  const msg = { id: "msg1", merchantId: "m1", type: "nps", channel: "whatsapp", buyerId: "b1", orderId: "o1",
    buyerPhone: "+5511999991111", buyerEmail: "buyer@example.test", buyerName: "Ana", metadata: { link: "https://store.example/order/1" }, ...overrides };
  const repo = { async findPendingDue() { return [msg]; }, async update(id: string, data: any) { updates.push({ id, ...data }); } } as any;
  const sender = { async execute(input: any) { sent.push(input); if (result instanceof Error) throw result; return result; } } as any;
  const config = { async getConfig() { return { npsEnabled: overrides.enabled !== false }; } } as any;
  const prisma = { completedOrder: { async findFirst() { return { status: overrides.orderStatus ?? "delivered" }; } }, merchant: { async findUnique() { return { name: "Loja Exemplo" }; } }, buyerAccount: { async findUnique({ where }: any) { assert.equal(where.globalUserId, "b1"); return { phone: "+5511999992222", email: "resolved@example.invalid", displayName: "Comprador" }; } } } as any;
  const context = { async setPostSaleContext(...args: any[]) { contexts.push(args); } } as any;
  return { updates, sent, contexts, uc: new ProcessScheduledMessagesUseCase(repo, sender, new PostSaleAiCopywriterService(), config, prisma, context, campaignConsent) };
}
test("email fallback records actual channel and provider ID without WhatsApp reply context", async () => {
  const h = harness({ status: "sent", channel: "email", messageId: "email1" });
  assert.equal((await h.uc.execute()).sent, 1);
  assert.equal(h.updates[0].channel, "email"); assert.equal(h.updates[0].providerMessageId, "email1");
  assert.equal(h.contexts.length, 0);
  assert.equal(h.sent[0].variables.link, "https://store.example/order/1");
  assert.equal(h.sent[0].variables.storeName, "Loja Exemplo");
});
test("official WhatsApp creates the response context", async () => {
  const h = harness({ status: "sent", channel: "whatsapp_template", messageId: "wamid.1" });
  assert.equal((await h.uc.execute()).sent, 1);assert.equal(h.contexts.length, 1);
});
for (const result of [{ status: "uncertain", channel: "whatsapp_template" }, { status: "sent", channel: "whatsapp_template", messageId: "" }, new Error("transport_failed ETIMEDOUT")]) test("uncertain acceptance is held without retry", async () => {
  const h = harness(result); assert.equal((await h.uc.execute()).sent, 0);assert.equal(h.updates[0].status, "unknown");
});
test("no channel ends the processing claim as skipped", async () => {
  const h = harness({ status: "skipped", channel: "none", reason: "email_not_configured" });
  assert.equal((await h.uc.execute()).sent, 0);assert.equal(h.updates[0].status, "skipped");
});
test("disabling a campaign after scheduling cancels its pending message", async () => {
  const h = harness({}, { enabled: false });await h.uc.execute();assert.equal(h.sent.length, 0);assert.equal(h.updates[0].status, "cancelled");
});

test("scanner messages resolve missing contacts before routing", async () => {
  const h = harness({ status: "sent", channel: "whatsapp_template", messageId: "wamid.contact" }, { buyerPhone: null, buyerEmail: null, buyerName: null });
  assert.equal((await h.uc.execute()).sent, 1);
  assert.equal(h.sent[0].toPhone, "+5511999992222");
  assert.equal(h.sent[0].fallbackEmail, "resolved@example.invalid");
  assert.equal(h.sent[0].variables.buyerName, "Comprador");
});

test("refund after scheduling cancels post-delivery dispatch", async () => {
  const h = harness({}, { orderStatus: "refunded" });
  await h.uc.execute();
  assert.equal(h.sent.length, 0);
  assert.equal(h.updates[0].failureReason, "order_no_longer_eligible");
});

test("dispatch cancels a scheduled campaign when the buyer did not authorize either reachable channel", async () => {
  const h = harness({ status: "sent", channel: "email", messageId: "unexpected" }, {}, { async canContact() { return false; } });
  await h.uc.execute();
  assert.equal(h.sent.length, 0);
  assert.equal(h.updates[0].status, "cancelled");
  assert.equal(h.updates[0].failureReason, "contact_consent_not_granted");
});

test("dispatch does not expose WhatsApp when only email remains authorized", async () => {
  const h = harness({ status: "sent", channel: "email", messageId: "email-authorized" }, {}, {
    async canContact(input: { channel: string }) { return input.channel === "email"; },
  });
  await h.uc.execute();
  assert.equal(h.sent[0].toPhone, undefined);
  assert.equal(h.sent[0].fallbackEmail, "buyer@example.test");
});
