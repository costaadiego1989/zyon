import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { PaidOrderReceiptReader } from "../../application/ports/paid-order-receipt-reader.port.js";
import type { OrderConfirmationEvent } from "../../domain/events/notification.events.js";
import { projectPaidOrderReceipt } from "../../domain/paid-order-receipt.js";

@Injectable()
export class PrismaPaidOrderReceiptReader implements PaidOrderReceiptReader {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async read(input: { merchantId: string; externalOrderId: string }): Promise<OrderConfirmationEvent | null> {
    if (!input.merchantId?.trim() || !input.externalOrderId?.trim()) return null;
    // Historical notification contacts, lines and prices are immutable outbox snapshots,
    // never a later catalog/cart/customer edit. No event is republished here.
    const order = await this.prisma.completedOrder.findFirst({ where: { merchantId: input.merchantId,
      externalOrderId: input.externalOrderId, status: "approved" } });
    if (!order || order.merchantId !== input.merchantId || order.externalOrderId !== input.externalOrderId || order.status !== "approved") return null;
    const notification = await this.prisma.outboxMessage.findFirst({ where: { merchantId: input.merchantId,
      eventType: "order.confirmed", causationId: input.externalOrderId,
      payload: { path: ["orderId"], equals: input.externalOrderId } }, orderBy: { createdAt: "asc" }, select: { payload: true } });
    const original = notification?.payload as unknown as OrderConfirmationEvent | undefined;
    if (!original || original.type !== "ORDER_CONFIRMATION" || original.merchantId !== input.merchantId
      || original.orderId !== input.externalOrderId || original.orderNumber !== input.externalOrderId
      || (original.buyerPhone !== undefined && typeof original.buyerPhone !== "string")
      || (original.buyerName !== undefined && typeof original.buyerName !== "string")
      || typeof original.buyerEmail !== "string" || !Array.isArray(original.items)
      || original.items.some(item => !item || typeof item.name !== "string" || typeof item.price !== "string"
        || !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) return null;
    const payment = await this.prisma.paymentIntent.findFirst({ where: { merchantId: order.merchantId,
      sessionId: order.sessionId, providerPaymentId: order.externalOrderId, status: "approved" } });
    const paidReceipt = payment ? projectPaidOrderReceipt(order, payment) : null;
    const items = paidReceipt?.status === "itemized" ? (order.lineItemsJson as Array<{
      name?: string; quantity: number; unitPriceCents: number; productType?: "physical" | "digital" | "service" | "food";
    }>).map(line => ({ name: typeof line.name === "string" ? line.name : "Item do pedido", quantity: line.quantity,
      price: (line.unitPriceCents / 100).toFixed(2),
      ...(["physical", "digital", "service", "food"].includes(line.productType ?? "") ? { productType: line.productType } : {}) })) : original.items;
    // Explicit projection prevents forged/transient receipt data in the old payload.
    const event: OrderConfirmationEvent = { type: "ORDER_CONFIRMATION", merchantId: order.merchantId,
      merchantName: original.merchantName, orderId: order.externalOrderId, orderNumber: order.externalOrderId,
      buyerEmail: original.buyerEmail, buyerName: original.buyerName, buyerPhone: original.buyerPhone,
      items, total: String(order.orderTotal), currency: order.currency };
    if (paidReceipt) event.paidReceipt = paidReceipt;
    return event;
  }
}
