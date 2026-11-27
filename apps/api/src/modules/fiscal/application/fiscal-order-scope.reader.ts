import type { Prisma, PrismaClient } from "@prisma/client";
import { orderTotalCents, type PaymentAmountBreakdown } from "../../payment/domain/payment-amount.js";
import { isFiscalOrderScope } from "../domain/fiscal-order-scope.js";
import { readFiscalSnapshotEnvelope, type FiscalSnapshotRecord } from "../domain/fiscal-sale-snapshot.port.js";

/** Admission uses the immutable completed sale, never the buyer's current cart or catalog. */
export async function supportsFiscalOrderScope(db: PrismaClient | Prisma.TransactionClient, snapshot: FiscalSnapshotRecord): Promise<boolean> {
  if (!isFiscalOrderScope(snapshot.orderMerchantId, [snapshot.merchantId])) return false;
  const envelope = readFiscalSnapshotEnvelope(snapshot.items);
  if (!isFiscalOrderScope(snapshot.orderMerchantId, envelope.commercialLines.map(line => line.sellerMerchantId))) return false;
  const order = await db.completedOrder.findFirst({ where: { id: snapshot.completedOrderId, merchantId: snapshot.orderMerchantId },
    include: { fiscalSaleSnapshots: { select: { merchantId: true, orderMerchantId: true } } } });
  if (!order || order.externalOrderId !== snapshot.orderId || order.currency !== snapshot.currency
    || Math.round(Number(order.orderTotal) * 100) !== snapshot.totalCents || (order.shippingCents ?? 0) !== snapshot.shippingCents
    || order.fiscalSaleSnapshots.some(row => !isFiscalOrderScope(order.merchantId, [row.merchantId, row.orderMerchantId]))) return false;
  const lines = order.lineItemsJson;
  if (!Array.isArray(lines) || lines.length !== envelope.commercialLines.length) return false;
  const remaining = [...envelope.commercialLines];
  for (const value of lines) {
    const line = value as Record<string, unknown> | null;
    const index = remaining.findIndex(item => line && item.lineId === line.lineId && item.sku === line.sku
      && (item.variantId ?? item.sku) === (line.variantId ?? line.sku) && item.quantity === line.quantity && item.unitPriceCents === line.unitPriceCents
      && item.productType === (line.productType ?? "unknown"));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  const subtotal = envelope.commercialLines.reduce((sum, line) => sum + line.quantity * line.unitPriceCents, 0);
  if (subtotal !== snapshot.subtotalCents || subtotal - snapshot.discountCents + snapshot.shippingCents !== snapshot.totalCents) return false;
  const events = await db.outboxMessage.findMany({ where: { merchantId: order.merchantId, eventType: "order.completed", payload: { path: ["external_order_id"], equals: order.externalOrderId } }, select: { payload: true } });
  const aliases = [order.sessionId, envelope.sessionId, ...events.flatMap(event => {
    const payload = event.payload as Record<string, unknown>;
    return payload.external_order_id === order.externalOrderId && typeof payload.marketplace_checkout_session_id === "string" ? [payload.marketplace_checkout_session_id] : [];
  })];
  if (await db.crossStoreLineItem.count({ where: { hostMerchantId: order.merchantId, sellerMerchantId: { not: order.merchantId },
    OR: [{ checkoutSessionId: { in: aliases } }, { orderId: order.externalOrderId }] } })) return false;
  if (snapshot.paymentProofRef) {
    const payment = await db.paymentIntent.findFirst({ where: { id: snapshot.paymentProofRef, merchantId: order.merchantId } });
    if (payment) {
      const input = (payment.creation as { input?: { marketplaceFunding?: unknown } } | null)?.input;
      if (input?.marketplaceFunding || await db.marketplaceFundingPlan.count({ where: { paymentIntentId: payment.id } })) return false;
      if (payment.sessionId !== order.sessionId || orderTotalCents((payment.amountBreakdown ?? undefined) as PaymentAmountBreakdown | undefined, payment.amountCents) !== snapshot.totalCents) return false;
    }
  }
  return true;
}
