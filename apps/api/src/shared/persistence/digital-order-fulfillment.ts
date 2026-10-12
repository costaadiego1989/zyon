import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { isDigitalContentReady } from "../../modules/catalog/domain/services/product-type-validation.js";
import { orderTotalCents, type PaymentAmountBreakdown } from "../../modules/payment/domain/payment-amount.js";
import type { DigitalPaymentContent } from "./digital-payment-content.js";

/** Called inside the completed-order transaction, before its outbox is committed. */
export async function createDigitalOrderFulfillment(tx: Prisma.TransactionClient, orderId: string, merchantId: string): Promise<void> {
  const order = await tx.completedOrder.findFirstOrThrow({ where: { id: orderId, merchantId }, include: { session: true } });
  const lines = Array.isArray(order.lineItemsJson) ? order.lineItemsJson as Array<{ sku?: string; variantId?: string; quantity?: number }> : [];
  const skus = lines.flatMap(line => typeof line.sku === "string" ? [line.sku] : []);
  if (!skus.length) return;
  const payment = await tx.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
  let contents: DigitalPaymentContent[];
  if (Array.isArray(payment?.digitalContent)) contents = payment.digitalContent as unknown as DigitalPaymentContent[];
  else {
    // Existing payments predate the private snapshot. Resolve their own merchant catalog.
    const variants = await tx.productVariant.findMany({ where: { sku: { in: skus }, product: { merchantId, type: "digital", deletedAt: null } }, include: { product: true } });
    contents = variants.map(variant => {
      const metadata = variant.product.metadata as Record<string, unknown> | null;
      if (!isDigitalContentReady(metadata)) throw new Error("digital_content_unavailable");
      return { variantId: variant.id, sku: variant.sku, productName: variant.product.name, downloadUrl: metadata!.downloadUrl as string,
        downloadExpiryDays: metadata!.downloadExpiryDays === undefined ? 30 : Number(metadata!.downloadExpiryDays) };
    });
  }
  if (!contents.length) return;
  if (!payment || payment.approvedAmountCents !== payment.amountCents || payment.currency !== order.currency ||
      Math.round(Number(order.orderTotal) * 100) !== orderTotalCents(payment.amountBreakdown as unknown as PaymentAmountBreakdown | undefined ?? undefined, payment.amountCents)) {
    throw new Error("digital_paid_approval_required");
  }
  const customer = order.session.customer && typeof order.session.customer === "object" && !Array.isArray(order.session.customer)
    ? order.session.customer as Record<string, unknown> : {};
  for (const content of contents) {
    if (contents.filter(c => c.sku === content.sku).length !== 1) throw new Error("digital_sku_ambiguous");
    const line = lines.find(l => l.sku === content.sku);
    if (!line || !Number.isSafeInteger(line.quantity) || Number(line.quantity) <= 0 ||
        (line.variantId && line.variantId !== content.sku && line.variantId !== content.variantId)) throw new Error("digital_order_line_invalid");
    if (!isDigitalContentReady(content)) {
      throw new Error("digital_content_unavailable");
    }
    const configuredDays = content.downloadExpiryDays;
    const days = Number.isSafeInteger(configuredDays) && Number(configuredDays) >= 1 && Number(configuredDays) <= 365 ? Number(configuredDays) : 30;
    const entitlement = await tx.digitalEntitlement.create({ data: {
      id: randomUUID(), merchantId, orderId, paymentIntentId: payment.id, variantId: content.variantId,
      sku: content.sku, productName: content.productName, downloadUrl: content.downloadUrl,
      expiresAt: new Date(order.completedAt.getTime() + days * 86_400_000),
    } });
    for (const [channel, contact] of [["email", customer.email], ["whatsapp", customer.phone]] as const) {
      if (typeof contact !== "string" || !contact.trim()) continue;
      const deliveryId = randomUUID();
      await tx.digitalDelivery.create({ data: { id: deliveryId, merchantId, entitlementId: entitlement.id, channel,
        destination: contact.trim(), buyerName: typeof customer.fullName === "string" ? customer.fullName : undefined } });
      const eventId = randomUUID();
      await tx.outboxMessage.create({ data: { eventId, merchantId, eventType: "digital.delivery.requested", status: "pending",
        schemaVersion: 1, producer: "checkout",
        correlationId: eventId, causationId: order.externalOrderId, occurredAt: new Date(),
        payload: { merchantId, deliveryId } } });
    }
  }
}
