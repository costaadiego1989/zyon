import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createHmac } from "node:crypto";
import type { Request } from "express";
import { InMemoryDomainEventBus } from "../../../shared/events/in-memory-domain-event-bus.js";
import type { PaidOrderFact, MetaAccess } from "../domain/types.js";
import { applicationFixture } from "../application/__tests__/fixture.js";
import { AttributionService } from "../application/attribution.service.js";
import { CheckoutPurchaseBridge } from "./checkout-purchase.bridge.js";
import { WhatsAppWebhookController } from "../../whatsapp-channel/presentation/http/whatsapp-webhook.controller.js";
import { AcceptBubbleWhatsWebhookUseCase } from "../../whatsapp-channel/application/use-cases/accept-bubblewhats-webhook.use-case.js";
import { HandleIncomingMessageUseCase, type IncomingMessageInput } from "../../whatsapp-channel/application/use-cases/handle-incoming-message.use-case.js";
import type { RouteToSessionUseCase } from "../../whatsapp-channel/application/use-cases/route-to-session.use-case.js";
import type { SendWhatsAppResponseUseCase } from "../../whatsapp-channel/application/use-cases/send-whatsapp-response.use-case.js";
import type { WhatsAppConfigRepository, WhatsAppChannelConfigEntity } from "../../whatsapp-channel/domain/ports/whatsapp-config-repository.port.js";
import type { WhatsAppWebhookInbox, WhatsAppInboxEvent } from "../../whatsapp-channel/domain/ports/whatsapp-webhook-inbox.port.js";
import type { WhatsAppSessionRepository } from "../../whatsapp-channel/domain/ports/whatsapp-session-repository.port.js";
async function fixture() {
  const f = await applicationFixture(); const bus = new InMemoryDomainEventBus(); let sent = 0;
  await f.repo.mutate("store-a", [], state => { state.campaigns["campaign-a"] = { id: "campaign-a", draft: { name: "Campanha", destination: "whatsapp", priority: "paid_sales", variantIds: [], mediaIds: [], budget: null, country: "BR", headline: "", primaryText: "" }, products: [], createdByAgent: true, managed: true, remoteCampaignId: "200", remoteAdSetId: "300", remoteAdIds: ["500"], remoteAccountId: "100", status: "active_unconfirmed", createdAt: "2026-11-01T00:00:00Z", updatedAt: f.clock().toISOString() }; return { result: null, records: [{ key: "campaign-origin:campaign-a", kind: "audit", payload: { source: "agent", campaignId: "campaign-a" }, createdAt: f.clock().toISOString() }] }; });
  let fact: PaidOrderFact = { merchantId: "store-a", orderId: "canonical-a", sessionId: "session-wa", paid: true, paidAt: "2026-11-14T12:00:00Z", currency: "BRL", paidCents: 10000, refundedCents: 0, costCents: null, costCoverage: "unavailable" };
  f.commerce.paidOrder = async (merchantId, orderId) => merchantId === "store-a" && ["canonical-a", "external-a"].includes(orderId) ? { ...fact } : null;
  f.commerce.paidOrders = async merchantId => merchantId === "store-a" ? [{ ...fact }] : [];
  const attribution = new AttributionService(f.repo, f.commerce, { access: async () => ({ accountId: "100" } as MetaAccess) }, { send: async () => { sent++; return { status: "sent", error: null }; } }, Buffer.alloc(32, 9).toString("base64"), f.clock);
  const bridge = new CheckoutPurchaseBridge(f.repo, f.commerce, attribution, bus, false, f.clock);
  return { ...f, bus, bridge, attribution, sent: () => sent, setFact: (patch: Partial<PaidOrderFact>) => { fact = { ...fact, ...patch }; } };
}
test("canonical completion and periodic refund reconciliation ignore event amounts and keep one purchase identity", async () => {
  const f = await fixture(); try { await f.attribution.captureWhatsapp("store-a", { adId: "500", sessionId: "session-wa", consent: false, consentVersion: "no-ad-consent" });
    await f.bridge.completed({ eventType: "order.completed", merchantId: "store-a", payload: { external_order_id: "external-a", order_total: 999999, currency: "USD" } }); const first = (await f.repo.read("store-a")).purchases!["canonical-a"]; assert.equal(first.netRevenueCents, 10000); assert.equal(first.fact.currency, "BRL"); assert.equal(first.campaignId, "campaign-a");
    f.setFact({ refundedCents: 3000 }); await f.bridge.drain(); const refund = (await f.repo.read("store-a")).purchases!["canonical-a"]; assert.equal(refund.netRevenueCents, 7000); assert.equal(refund.eventId, first.eventId); assert.equal(f.sent(), 0); assert.equal(Object.keys((await f.repo.read("store-b")).purchases ?? {}).length, 0); await f.bridge.onModuleDestroy();
  } finally { await f.close(); }
});
test("only authenticated Meta ad referral survives the durable inbox and binds the routed checkout without inferring consent", async () => {
  const f = await fixture(); const previousSecret = process.env.META_APP_SECRET; process.env.META_APP_SECRET = "local-hmac-test";
  try {
    const accepted: WhatsAppInboxEvent[] = [];
    const config = { id: "config-a", merchantId: "store-a", enabled: true, provider: "META_CLOUD", status: "ACTIVE", credentials: {}, createdAt: f.clock(), updatedAt: f.clock() } as WhatsAppChannelConfigEntity;
    const configs = { findByMetaPhoneNumberId: async () => config } as unknown as WhatsAppConfigRepository;
    const accept = new AcceptBubbleWhatsWebhookUseCase(configs, { accept: async (events: WhatsAppInboxEvent[]) => { accepted.push(...events); } } as unknown as WhatsAppWebhookInbox);
    const controller = new WhatsAppWebhookController(configs, accept);
    const payload = { entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "12345" }, messages: [{ id: "wamid-1", from: "5511999999999", timestamp: "1794657600", type: "text", text: { body: "Quero comprar" }, referral: { source_type: "ad", source_id: "500", ctwa_clid: "private-click" } }] } }] }] };
    const rawBody = Buffer.from(JSON.stringify(payload)); await assert.rejects(controller.receiveMetaWebhook("invalid", payload, { rawBody } as unknown as Request), /invalid_meta_signature/); assert.equal(accepted.length, 0);
    await controller.receiveMetaWebhook(`sha256=${createHmac("sha256", "local-hmac-test").update(rawBody).digest("hex")}`, payload, { rawBody } as unknown as Request);
    const incoming = accepted[0].payload as IncomingMessageInput; assert.deepEqual(incoming.adReferral, { adId: "500" }); assert.equal(JSON.stringify(incoming.adReferral).includes("private-click"), false);
    const routed = { whatsappSession: { id: "wa-session", merchantId: "store-a", checkoutSessionId: "session-wa", currentOptions: [], previousOptions: [], currentPage: 0 }, checkoutSessionId: "session-wa" };
    f.bus.subscribe("whatsapp.ad_referral", event => f.bridge.referral(event), "test.referral");
    const handle = new HandleIncomingMessageUseCase({ execute: async () => routed } as unknown as RouteToSessionUseCase, { execute: async () => undefined } as unknown as SendWhatsAppResponseUseCase, { updateMenuState: async () => undefined } as unknown as WhatsAppSessionRepository, { respond: async () => ({ agentMessage: "Pedido", quickReplies: [] }) } as never, undefined, { execute: async () => undefined } as never, f.bus);
    await handle.execute(incoming); const receipt = await f.repo.getRecord<{ campaignId: string; consent: boolean; ctwaClid: null }>("store-a", "attribution-session:session-wa"); assert.equal(receipt!.payload.campaignId, "campaign-a"); assert.equal(receipt!.payload.consent, false); assert.equal(receipt!.payload.ctwaClid, null); assert.equal(f.sent(), 0);
    await f.bridge.completed({ eventType: "order.completed", merchantId: "store-a", payload: { external_order_id: "external-a" } }); assert.equal((await f.repo.read("store-a")).purchases!["canonical-a"].campaignId, "campaign-a");
  } finally { if (previousSecret === undefined) delete process.env.META_APP_SECRET; else process.env.META_APP_SECRET = previousSecret; await f.close(); }
});
test("server completion binds a storefront conversation receipt before the buyer returns from checkout", async () => {
  const f = await fixture(); try {
    await f.attribution.captureStore("store-a", { token: f.attribution.trackingToken("store-a", "campaign-a"), sessionId: "conversation-a", consent: false, consentVersion: "no-ad-consent" });
    const bridge = new CheckoutPurchaseBridge(f.repo, f.commerce, f.attribution, f.bus, false, f.clock, { parent: async (_merchantId, sessionId) => sessionId === "session-wa" ? "conversation-a" : null });
    await bridge.completed({ eventType: "order.completed", merchantId: "store-a", payload: { external_order_id: "external-a" } });
    const state = await f.repo.read("store-a"); assert.equal(state.purchases!["canonical-a"].campaignId, "campaign-a"); assert.equal(state.purchases!["canonical-a"].source, "store"); assert.equal((await f.repo.getRecord<{ originSessionId: string }>("store-a", "attribution-session:session-wa"))!.payload.originSessionId, "conversation-a"); assert.equal(f.sent(), 0);
  } finally { await f.close(); }
});
