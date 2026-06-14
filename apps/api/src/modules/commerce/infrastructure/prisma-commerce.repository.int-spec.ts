import test from "node:test";
import assert from "node:assert/strict";
import { createPrismaClient } from "../../../shared/persistence/prisma-client.js";
import { createCommerceEventEnvelope } from "../domain/events/commerce-domain-event.js";
import { PrismaPendingCommerceOrderIndex } from "./prisma-pending-commerce-order-index.repository.js";
import { PrismaCommercePaidWebhookDedup } from "./prisma-commerce-paid-webhook-dedup.repository.js";
import { PrismaCommerceConnectionRepository } from "./prisma-commerce-connection.repository.js";

const runPrisma = process.env.AACP_RUN_PRISMA_TESTS === "1" && Boolean(process.env.DATABASE_URL);

test(
  "commerce durable index/dedup/connection persist per tenant with atomic outbox emission",
  { skip: runPrisma ? false : "Set AACP_RUN_PRISMA_TESTS=1 and DATABASE_URL to run Prisma integration tests." },
  async () => {
    process.env.AACP_COMMERCE_ENC_KEY = process.env.AACP_COMMERCE_ENC_KEY ?? "int-test-commerce-key";
    const prisma = createPrismaClient();
    const merchantId = `mrc_com_${crypto.randomUUID().replace(/-/g, "")}`;
    const otherMerchantId = `mrc_com_${crypto.randomUUID().replace(/-/g, "")}`;

    const index = new PrismaPendingCommerceOrderIndex(prisma);
    const dedup = new PrismaCommercePaidWebhookDedup(prisma);
    const connections = new PrismaCommerceConnectionRepository(prisma);

    try {
      await prisma.merchant.createMany({
        data: [
          { id: merchantId, name: "Commerce Tenant" },
          { id: otherMerchantId, name: "Other Commerce Tenant" }
        ]
      });

      // Durable pending-order index: idempotent per (merchant, session) + atomic outbox.
      const pendingEvent = createCommerceEventEnvelope({
        eventType: "commerce.order.pending",
        merchantId,
        payload: { commerce_order_id: "draft_1", session_id: "s1" }
      });
      assert.equal(await index.find(merchantId, "s1"), undefined);
      await index.remember(merchantId, "s1", "draft_1", pendingEvent);
      await index.remember(merchantId, "s1", "draft_should_be_ignored");
      assert.equal(await index.find(merchantId, "s1"), "draft_1");

      const pendingOutbox = await prisma.outboxMessage.findUnique({ where: { eventId: pendingEvent.event_id } });
      assert.ok(pendingOutbox, "pending event must be in outbox");
      assert.equal(pendingOutbox?.producer, "commerce");
      assert.equal(pendingOutbox?.eventType, "commerce.order.pending");

      // Cross-tenant isolation: same session string, different merchant.
      assert.equal(await index.find(otherMerchantId, "s1"), undefined);

      // Durable paid dedup + atomic outbox.
      const paidEvent = createCommerceEventEnvelope({
        eventType: "commerce.order.paid",
        merchantId,
        payload: { commerce_order_id: "draft_1", payment_reference: "pay_1" }
      });
      assert.equal(await dedup.isProcessed(merchantId, "pay_1"), false);
      await dedup.markProcessed(merchantId, "pay_1", "draft_1", paidEvent);
      await dedup.markProcessed(merchantId, "pay_1", "draft_1");
      assert.equal(await dedup.isProcessed(merchantId, "pay_1"), true);
      assert.equal(await dedup.isProcessed(otherMerchantId, "pay_1"), false);

      const paidOutbox = await prisma.outboxMessage.findUnique({ where: { eventId: paidEvent.event_id } });
      assert.ok(paidOutbox, "paid event must be in outbox");

      // Per-tenant Shopify credentials: ciphered at rest, decrypted on read.
      await connections.saveCredentials({
        merchantId,
        shopDomain: "tenant-one.myshopify.com",
        adminAccessToken: "shpat_secret_token",
        apiVersion: "2025-10"
      });
      const stored = await prisma.merchantCommerceConnection.findUnique({ where: { merchantId } });
      assert.ok(stored);
      assert.notEqual(stored?.adminTokenCipher, "shpat_secret_token");

      const creds = await connections.getCredentials(merchantId);
      assert.equal(creds?.shopDomain, "tenant-one.myshopify.com");
      assert.equal(creds?.adminAccessToken, "shpat_secret_token");
      assert.equal(await connections.getCredentials(otherMerchantId), undefined);
    } finally {
      await prisma.outboxMessage.deleteMany({ where: { merchantId: { in: [merchantId, otherMerchantId] } } });
      await prisma.merchant.deleteMany({ where: { id: { in: [merchantId, otherMerchantId] } } });
      await prisma.$disconnect();
    }
  }
);
