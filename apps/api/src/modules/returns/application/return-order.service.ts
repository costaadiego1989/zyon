import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException, Optional } from "@nestjs/common";
import type { PrismaClient, Prisma } from "@prisma/client";
import type { SupportOrder, SupportOrderItem, SupportRefundPreview } from "@zyon/shared-types";
import { PRISMA_CLIENT } from "../../../shared/persistence/persistence.module.js";
import { RefundPaymentService } from "../../payment/application/services/refund-payment.service.js";

export const RESOLVED_RETURN_STATUSES = ["REFUND_COMPLETED", "EXCHANGE_COMPLETED", "REJECTED", "CANCELLED"];
export const RETURN_REASON_LABELS: Record<string, string> = {
  DEFECTIVE: "Produto com defeito", WRONG_ITEM: "Recebi outro produto",
  NOT_AS_DESCRIBED: "Diferente do anunciado", CHANGED_MIND: "Desistência da compra",
  DAMAGED_IN_TRANSIT: "Danificado no transporte", OTHER: "Outro motivo",
};
type Db = PrismaClient | Prisma.TransactionClient;

export function normalizeOrderItems(value: unknown): SupportOrderItem[] {
  if (!Array.isArray(value)) return [];
  const grouped = new Map<string, SupportOrderItem>();
  for (const raw of value) {
    const variantId = raw?.variantId || raw?.sku;
    const quantity = Number(raw?.quantity);
    const unitPriceCents = raw?.unitPriceCents ?? Math.round(Number(raw?.unitPrice ?? raw?.unit_price) * 100);
    if (typeof variantId !== "string" || !variantId || !Number.isSafeInteger(quantity) || quantity < 1 || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0) throw new ConflictException("order_items_unavailable");
    const previous = grouped.get(variantId);
    if (previous && previous.unitPriceCents !== unitPriceCents) throw new ConflictException("ambiguous_order_item_price");
    grouped.set(variantId, { variantId, sku: raw.sku, name: String(raw.name ?? raw.title ?? variantId), quantity: quantity + (previous?.quantity ?? 0), eligibleQuantity: quantity + (previous?.quantity ?? 0), unitPriceCents });
  }
  return [...grouped.values()];
}

export function validateReturnItems(order: SupportOrder, requested: Array<{ variantId: string; quantity: number }>) {
  if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw new BadRequestException("select_order_items");
  const seen = new Set<string>();
  return requested.map(item => {
    if (!item || typeof item.variantId !== "string") throw new BadRequestException("item_not_in_order");
    const line = order.items.find(it => it.variantId === item.variantId);
    if (!line || seen.has(item.variantId)) throw new BadRequestException("item_not_in_order");
    seen.add(item.variantId);
    if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > line.eligibleQuantity) throw new BadRequestException("invalid_return_quantity");
    return { variantId: line.variantId, quantity: item.quantity, name: line.name, unitPriceCents: line.unitPriceCents };
  });
}

export function calculateReturnAmount(order: SupportOrder, selected: ReturnType<typeof validateReturnItems>, captured: number, reserved: number): number {
  const available = captured - reserved;
  if (!Number.isSafeInteger(captured) || !Number.isSafeInteger(reserved) || reserved < 0 || available <= 0 || !Number.isSafeInteger(order.shippingCents) || order.shippingCents < 0) throw new ConflictException("no_refundable_balance");
  const remaining = order.items.filter(it => it.eligibleQuantity > 0);
  if (remaining.length === selected.length && remaining.every(it => selected.some(s => s.variantId === it.variantId && s.quantity === it.eligibleQuantity))) return available;
  const gross = order.items.reduce((sum, it) => sum + it.quantity * it.unitPriceCents, 0);
  const selectedGross = selected.reduce((sum, it) => sum + it.quantity * it.unitPriceCents, 0);
  const totalQty = order.items.reduce((sum, it) => sum + it.quantity, 0);
  const returnedQty = selected.reduce((sum, it) => sum + it.quantity, 0);
  if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(selectedGross) || gross <= 0 || totalQty <= 0) throw new ConflictException("refund_item_price_unavailable");
  // Allocate historical discounts. Buyer fees are returned with the final units.
  const merchandisePaid = Math.max(0, Math.min(gross, captured - order.shippingCents));
  const amount = Math.floor(merchandisePaid * selectedGross / gross) + Math.floor(order.shippingCents * returnedQty / totalQty);
  if (!Number.isSafeInteger(amount) || amount <= 0 || amount > available) throw new ConflictException("refund_exceeds_available_balance");
  return amount;
}

@Injectable()
export class ReturnOrderService {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient,
    @Optional() private readonly refundPayment?: RefundPaymentService) {}

  async load(merchantId: string, orderRef: string, buyerId?: string, db: Db = this.prisma, excludeReturnId?: string): Promise<SupportOrder> {
    const purchase = await db.buyerPurchaseRecord.findFirst({ where: { merchantId, ...(buyerId ? { globalUserId: buyerId } : {}), OR: [{ orderId: orderRef }, { id: orderRef }] } });
    if (!purchase) throw new NotFoundException("buyer_order_not_found");
    const order = await db.completedOrder.findFirst({ where: { merchantId, externalOrderId: purchase.orderId } });
    const payment = order ? await db.paymentIntent.findFirst({ where: { merchantId, sessionId: order.sessionId, status: { in: ["approved", "refunded"] } }, orderBy: { updatedAt: "desc" } }) : null;
    const lines = normalizeOrderItems(order?.lineItemsJson ?? purchase.items);
    if (!lines.length) throw new ConflictException("order_items_unavailable");
    const resolved = await db.return.findMany({ where: { merchantId, orderId: purchase.orderId, ...(excludeReturnId ? { id: { not: excludeReturnId } } : {}), status: { in: ["REFUND_COMPLETED", "EXCHANGE_COMPLETED"] } }, include: { items: true } });
    for (const ret of resolved) for (const item of ret.items) {
      const line = lines.find(it => it.variantId === item.variantId || it.sku === item.variantId);
      if (line) line.eligibleQuantity = Math.max(0, line.eligibleQuantity - item.quantity);
      // Historical full-order marker must never make an already refunded order eligible again.
      if (item.variantId === "all") for (const it of lines) it.eligibleQuantity = 0;
    }
    return {
      merchantId, orderId: purchase.orderId, completedAt: purchase.completedAt.toISOString(),
      currency: payment?.currency ?? purchase.currency, totalCents: payment?.approvedAmountCents ?? payment?.amountCents ?? Math.round(Number(purchase.totalAmount) * 100),
      shippingCents: order?.shippingCents ?? 0, paymentStatus: payment?.status ?? order?.status ?? "unavailable",
      paymentMethod: payment?.method, trackingCode: order?.trackingCode, items: lines,
    };
  }

  async preview(merchantId: string, returnId: string, db: Db = this.prisma): Promise<SupportRefundPreview> {
    const ret = await db.return.findFirst({ where: { id: returnId, merchantId }, include: { items: true, refund: true } });
    if (!ret) throw new NotFoundException("return_not_found");
    if (ret.kind !== "refund") throw new ConflictException("exchange_requires_own_resolution");
    const order = await this.load(merchantId, ret.orderId, ret.buyerId, db, returnId);
    const selected = validateReturnItems(order, ret.items);
    const completed = await db.completedOrder.findFirst({ where: { merchantId, externalOrderId: order.orderId } });
    if (!completed) throw new ConflictException("completed_order_not_found");
    const payment = await db.paymentIntent.findFirst({ where: { merchantId, sessionId: completed.sessionId, status: "approved" }, orderBy: { updatedAt: "desc" } });
    if (!payment?.providerPaymentId) throw new ConflictException("approved_payment_not_found");
    const previous = await db.returnRefund.findMany({ where: { return: { merchantId, orderId: order.orderId }, returnId: { not: returnId }, status: { in: ["PENDING", "FAILED", "COMPLETED"] } } });
    if (previous.some(r => r.amountInCents <= 0)) throw new ConflictException("previous_refund_requires_reconciliation");
    const capturedCents = payment.approvedAmountCents ?? payment.amountCents;
    const reservedCents = previous.reduce((sum, row) => sum + row.amountInCents, 0);
    const creation = payment.creation as { input?: { provider?: string } } | null;
    const provider = creation?.input?.provider ?? "unknown";
    const partnerItems = await db.crossStoreLineItem.count({ where: { hostMerchantId: merchantId, checkoutSessionId: completed.sessionId, federatedProductId: { in: selected.map(item => item.variantId) } } });
    const prepared = this.refundPayment ? await this.refundPayment.prepareOrderRefund({
      merchantId, externalOrderId: ret.orderId, returnedItems: selected,
      reason: `return:${returnId}`, idempotencyKey: `return:${returnId}`,
    }) : undefined;
    if (prepared && (!prepared.providerRequest || !prepared.paymentIntentId || prepared.amountCents <= 0))
      throw new ConflictException(prepared.reason ?? "return_refund_payment_unavailable");
    const amountCents = prepared?.amountCents ?? calculateReturnAmount(order, selected, capturedCents, reservedCents);
    if (amountCents > capturedCents - reservedCents) throw new ConflictException("refund_exceeds_available_balance");
    return { amountCents, capturedCents, reservedCents,
      availableCents: capturedCents - reservedCents, currency: payment.currency, paymentIntentId: payment.id,
      paymentMethod: payment.method, items: selected, provider, automatic: !partnerItems && ["stripe", "asaas", "mercadopago"].includes(provider) };
  }
}
