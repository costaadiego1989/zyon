import "reflect-metadata";
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { MerchantAgentConfigurationService } from "../src/modules/agent-rules/application/merchant-agent-configuration.service.js";
import { PrismaStorefrontConfigQueryRepository } from "../src/modules/storefront/infrastructure/repositories/prisma-storefront-config-query.repository.js";
import { GetMerchantThemeUseCase } from "../src/modules/merchant/application/get-merchant-theme.use-case.js";
import { PrismaMerchantRepository } from "../src/modules/merchant/infrastructure/prisma-merchant.repository.js";
import { RegisterDomainUseCase } from "../src/modules/domains/application/use-cases/register-domain.use-case.js";
import { VerifyDomainUseCase } from "../src/modules/domains/application/use-cases/verify-domain.use-case.js";
import { ListDomainsUseCase } from "../src/modules/domains/application/use-cases/list-domains.use-case.js";
import { DomainCheckController } from "../src/modules/domains/presentation/http/domains.controller.js";
import { WhatsAppDeliveryService } from "../src/modules/whatsapp-channel/application/services/whatsapp-delivery.service.js";
import { SendWhatsAppResponseUseCase } from "../src/modules/whatsapp-channel/application/use-cases/send-whatsapp-response.use-case.js";
import { PrismaWhatsAppWebhookInbox } from "../src/modules/whatsapp-channel/infrastructure/repositories/prisma-whatsapp-webhook-inbox.repository.js";
import type { WhatsAppInboxClaim } from "../src/modules/whatsapp-channel/domain/ports/whatsapp-webhook-inbox.port.js";

const url = process.env.READY_PROD_TEST_DATABASE_URL;
if (!url || !["127.0.0.1", "localhost"].includes(new URL(url).hostname) || new URL(url).pathname !== "/ready_prod_test") throw new Error("local_test_database_required");
const prisma = new PrismaClient({ datasources: { db: { url } } });
after(() => prisma.$disconnect());
const merchantId = "channels_" + randomUUID();
const slug = "channel-test-" + randomUUID();
const configuration = new MerchantAgentConfigurationService(prisma);
const patch = { identity: { agentName: "Athom teste", tone: "friendly" as const, greeting: "Olá!" }, mode: "proactive" as const, quickReplies: { welcome: ["Ver Produtos"] } };

test("agent configuration commits once and storefront/theme read the same canonical identity and mode", async () => {
  await prisma.merchant.create({ data: { id: merchantId, name: "Test", storeSlug: slug } });
  const before = await configuration.get(merchantId);
  assert.equal((await configuration.get(merchantId)).revision, before.revision);
  const saved = await configuration.update(merchantId, { ...patch, revision: before.revision });
  const reloaded = await configuration.get(merchantId);
  assert.deepEqual(reloaded, saved);
  const store = await new PrismaStorefrontConfigQueryRepository(prisma).findPublicConfig(slug);
  assert.equal(store?.checkoutMode, "proactive");
  assert.equal((store?.agentRule as any)?.identity?.agentName, "Athom teste");
  await assert.rejects(configuration.update(merchantId, { ...patch, identity: { agentName: "Lost update" }, revision: before.revision }), /agent_configuration_changed/);
  assert.equal((await configuration.get(merchantId)).identity.agentName, "Athom teste");
  await assert.rejects(configuration.update("other-merchant", patch), /merchant_not_found/);
});

test("failure in the third write rolls back identity and checkout behavior in PostgreSQL", async () => {
  const before = await configuration.get(merchantId);
  const faultDb = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return (fn: any, options: any) => target.$transaction(tx => fn(new Proxy(tx, { get(db, prop) {
      if (prop === "merchantRule") return new Proxy(db.merchantRule, { get(repo, method) { if (method === "upsert") return async () => { throw new Error("injected_write_failure"); }; return Reflect.get(repo, method); } });
      return Reflect.get(db, prop);
    } })), options);
    return Reflect.get(target, key);
  } });
  await assert.rejects(new MerchantAgentConfigurationService(faultDb).update(merchantId, { ...patch, identity: { agentName: "Should rollback" }, mode: "manual_only" }), /injected_write_failure/);
  assert.deepEqual(await configuration.get(merchantId), before);
});

test("concurrent agent saves from one revision accept one and reject the stale write", async () => {
  const before = await configuration.get(merchantId);
  const results = await Promise.allSettled(["One", "Two"].map(agentName => configuration.update(merchantId, { ...patch, revision: before.revision, identity: { agentName } })));
  assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(results.filter(r => r.status === "rejected").length, 1);
});

test("a matching shared CNAME cannot authorize another shop without its unique TXT proof", async () => {
  const domain = "test-" + randomUUID() + ".example.com";
  const registered = await new RegisterDomainUseCase(prisma).execute({ merchant_id: merchantId, domain });
  const checker = new DomainCheckController(prisma);
  const query = new PrismaStorefrontConfigQueryRepository(prisma);
  const withoutTxt = new VerifyDomainUseCase(prisma, { verifyCname: async () => true, verifyTxt: async () => false } as any);
  assert.equal((await withoutTxt.execute({ merchant_id: merchantId, domain_id: registered.domain_id })).verified, false);
  await assert.rejects(checker.check(domain), /domain_not_verified/);
  assert.equal(await query.findPublicConfig(domain), null);
  const valid = new VerifyDomainUseCase(prisma, { verifyCname: async () => true, verifyTxt: async (name: string, value: string) => name === registered.txt_name && value === registered.txt_value } as any);
  assert.equal((await valid.execute({ merchant_id: merchantId, domain_id: registered.domain_id })).verified, true);
  await assert.rejects(valid.execute({ merchant_id: "other", domain_id: registered.domain_id }), /domain_not_found/);
  const listed = await new ListDomainsUseCase(prisma).execute(merchantId);
  assert.equal(listed.find(d => d.id === registered.domain_id)?.txt_value, registered.txt_value);
  await prisma.merchantDomain.delete({ where: { id: registered.domain_id } });
  const again = await new RegisterDomainUseCase(prisma).execute({ merchant_id: merchantId, domain });
  assert.notEqual(again.txt_value, registered.txt_value);
});

function claim(): WhatsAppInboxClaim {
  const id = randomUUID();
  return { id, leaseToken: randomUUID(), merchantId, configId: "config-test", deviceId: "META_CLOUD:config-test", streamKey: id, kind: "message", attempts: 1, dedupKey: id, eventId: id, payloadHash: id, payload: {} as any };
}
const reply = { merchantId, deviceId: "META_CLOUD:config-test", provider: "META_CLOUD", toNumber: "+5511999999999", text: "Pedido de teste" };

test("confirmed rejection retries only the persisted response after service restart", async () => {
  const event = claim(); let engine = 0, sends = 0;
  const sender = { sendText: async () => { sends++; return { status: sends === 1 ? "failed" as const : "sent" as const, messageId: sends === 1 ? "" : "provider-1" }; } };
  const delivery = new WhatsAppDeliveryService(prisma, sender);
  const send = new SendWhatsAppResponseUseCase(sender, delivery);
  await assert.rejects(delivery.process(event, async () => { engine++; await send.execute(reply); }, async () => true), /whatsapp_send_rejected/);
  const restarted = new WhatsAppDeliveryService(prisma, sender);
  await restarted.process(event, async () => { engine++; }, async () => true);
  await restarted.process(event, async () => { engine++; }, async () => true);
  assert.equal(engine, 1); assert.equal(sends, 2);
});

test("lost provider result is never resent and signed Meta receipt reconciles only its tenant and config", async () => {
  const event = claim(); let sends = 0;
  const sender = { sendText: async () => { sends++; throw new Error("connection_reset_after_acceptance"); } };
  const delivery = new WhatsAppDeliveryService(prisma, sender);
  const send = new SendWhatsAppResponseUseCase(sender, delivery);
  await assert.rejects(delivery.process(event, () => send.execute(reply), async () => true), /requires_reconciliation/);
  await assert.rejects(delivery.process(event, async () => { assert.fail("must not rerun checkout"); }, async () => true), /requires_reconciliation/);
  assert.equal(sends, 1);
  const receipt = { id: "wamid-accepted", status: "delivered", biz_opaque_callback_data: event.id };
  await delivery.reconcileMeta("other", event.configId, receipt);
  await delivery.reconcileMeta(merchantId, "other", receipt);
  assert.equal((await prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id: event.id } })).state, "submission_unknown");
  await delivery.reconcileMeta(merchantId, event.configId, receipt);
  await delivery.process(event, async () => { assert.fail("must not rerun checkout"); }, async () => true);
  assert.equal((await prisma.whatsAppDelivery.findUniqueOrThrow({ where: { id: event.id } })).state, "sent");
  assert.equal(sends, 1);
});

test("crash after a checkout side effect requires review instead of replaying the engine", async () => {
  const event = claim(); let engine = 0;
  const delivery = new WhatsAppDeliveryService(prisma, { sendText: async () => { assert.fail("must not send"); } });
  await assert.rejects(delivery.process(event, async () => { engine++; throw new Error("crash_after_effect"); }, async () => true), /requires_reconciliation/);
  await assert.rejects(delivery.process(event, async () => { engine++; }, async () => true), /requires_reconciliation/);
  assert.equal(engine, 1);
});

test("uncertain inbox event blocks later messages in the same stream until reconciliation", async () => {
  await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId: { startsWith: "channels_" } } });
  const inbox = new PrismaWhatsAppWebhookInbox(prisma);
  const first = claim(), second = claim(); second.streamKey = first.streamKey;
  await inbox.accept([first]);
  const claimed = await inbox.claimNext(); assert.equal(claimed?.id !== undefined, true);
  assert.equal(claimed?.eventId, first.eventId);
  await inbox.fail(claimed!, "whatsapp_delivery_requires_reconciliation");
  await inbox.accept([second]);
  assert.equal(await inbox.claimNext(), null);
  await prisma.whatsAppWebhookInbox.deleteMany({ where: { merchantId } });
});

test("marketplace order subscriber rolls back a partial failure and converges on one settlement per item", async () => {
  const { MarketplaceOrderCompletedHandler } = await import("../src/modules/marketplace/application/handlers/marketplace-order-completed.handler.js");
  const sessionId = "session_" + randomUUID(), orderId = "order_" + randomUUID();
  await prisma.marketplaceConfig.create({ data: { merchantId, enabled: true } });
  await prisma.checkoutSession.create({ data: { merchantId, sessionId, globalUserId: "buyer-test", conversationId: "conversation-test", cart: { items: [], total: 10 }, createdAt: new Date(), updatedAt: new Date() } });
  await prisma.completedOrder.create({ data: { merchantId, sessionId, externalOrderId: orderId, orderTotal: 10, currency: "BRL", completedAt: new Date() } });
  const line = await prisma.crossStoreLineItem.create({ data: { checkoutSessionId: sessionId, hostMerchantId: merchantId, sellerMerchantId: "seller-test", federatedProductId: "product-test", quantity: 1, unitPriceCents: 1000, commissionRateBps: 1500, commissionCents: 150, sellerNetCents: 850 } });
  const event = { eventType: "order.completed", merchantId, payload: { session_id: sessionId, external_order_id: orderId } };
  const faultDb = new Proxy(prisma, { get(target, key) {
    if (key === "$transaction") return (fn: any, options: any) => target.$transaction(tx => fn(new Proxy(tx, { get(db, prop) {
      if (prop === "marketplaceSettlement") return new Proxy(db.marketplaceSettlement, { get(repo, method) { if (method === "upsert") return async () => { throw new Error("settlement_storage_unavailable"); }; return Reflect.get(repo, method); } });
      return Reflect.get(db, prop);
    } })), options);
    return Reflect.get(target, key);
  } });
  await assert.rejects(new MarketplaceOrderCompletedHandler({} as any, faultDb).handle(event), /settlement_storage_unavailable/);
  assert.equal((await prisma.crossStoreLineItem.findUniqueOrThrow({ where: { id: line.id } })).orderId, null);
  const handler = new MarketplaceOrderCompletedHandler({} as any, prisma);
  const attempts = await Promise.allSettled(Array.from({ length: 6 }, () => handler.handle(event)));
  assert.ok(attempts.some(r => r.status === "fulfilled"));
  // The real outbox retries transaction conflicts; replay every failed attempt.
  for (const result of attempts) if (result.status === "rejected") await handler.handle(event);
  await handler.handle(event);
  assert.equal(await prisma.marketplaceSettlement.count({ where: { lineItemId: line.id } }), 1);
  await assert.rejects(handler.handle({ ...event, merchantId: "other" }), /marketplace_completed_order_missing/);
});


test("legacy agent edits invalidate a configuration revision before canonical migration", async () => {
  const legacyMerchant = "channels_legacy_" + randomUUID();
  await prisma.merchant.create({ data: { id: legacyMerchant, name: "Legacy" } });
  await configuration.update(legacyMerchant, patch);
  await prisma.agentRule.update({ where: { merchantId_agentId: { merchantId: legacyMerchant, agentId: "default" } }, data: { agentId: "agt_legacy", scope: "user_agent" } });
  const before = await configuration.get(legacyMerchant);
  await prisma.agentRule.update({ where: { merchantId_agentId: { merchantId: legacyMerchant, agentId: "agt_legacy" } }, data: { identity: { ...patch.identity, agentName: "Changed legacy" }, updatedAt: new Date(Date.now() + 1000) } });
  await assert.rejects(configuration.update(legacyMerchant, { ...patch, revision: before.revision }), /agent_configuration_changed/);
  assert.equal((await configuration.get(legacyMerchant)).identity.agentName, "Changed legacy");
});

test("marketplace eligibility is applied before pagination and returns real seller terms", async () => {
  const { PrismaFederatedProductRepository } = await import("../src/modules/marketplace/infrastructure/repositories/prisma-federated-product.repository.js");
  const query = "channels-search-" + randomUUID();
  const sellers = ["disabled", "seller-blocked", "host-blocked", "not-partner", "eligible"].map(name => ({ name, id: query + name }));
  for (const seller of sellers) {
    await prisma.merchant.create({ data: { id: seller.id, name: seller.name } });
    await prisma.marketplaceConfig.create({ data: { merchantId: seller.id, enabled: seller.name !== "disabled", commissionRateBps: 2300, blockedMerchants: seller.name === "seller-blocked" ? [merchantId] : [] } });
    await prisma.federatedProduct.create({ data: { sourceMerchantId: seller.id, sourceProductId: "sku-1", name: query, searchableText: query, priceCents: 1000, currency: "BRL", stockAvailable: true } });
  }
  const repo = new PrismaFederatedProductRepository(prisma);
  const filters = { hostMerchantId: merchantId, includeMerchants: sellers.filter(s => s.name !== "not-partner").map(s => s.id), excludeMerchants: sellers.filter(s => s.name === "host-blocked").map(s => s.id) };
  const result = await repo.searchByQuery(query, undefined, 1, filters);
  assert.equal(result.length, 1);
  assert.equal(result[0].sellerName, "eligible");
  assert.equal(result[0].commissionRateBps, 2300);
  await prisma.federatedProduct.updateMany({ where: { sourceMerchantId: sellers[4].id }, data: { stockAvailable: false } });
  assert.deepEqual(await repo.searchByQuery(query, undefined, 1, filters), []);
});
