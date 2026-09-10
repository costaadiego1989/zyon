import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { PAYMENT_REPOSITORY } from "../../domain/ports/payment-repository.port.js";
import type { PaymentRepository } from "../../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "../../domain/ports/payment-provider.port.js";
import type { PaymentProviderPort } from "../../domain/ports/payment-provider.port.js";
import { ORDER_REPOSITORY } from "../../../checkout/domain/ports/order.repository.port.js";
import type { OrderRepository } from "../../../checkout/domain/ports/order.repository.port.js";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../../marketplace/domain/ports/cross-store-order-repository.port.js";
import type { CrossStoreOrderRepository } from "../../../marketplace/domain/ports/cross-store-order-repository.port.js";
import type { CompletedOrder } from "@zyon/shared-types";

export interface RefundOrderPaymentInput {
  merchantId: string;
  /** external order id (Return.orderId) whose payment must be reversed */
  externalOrderId: string;
  /** amount to refund in cents; when omitted, computed from returnedItems or full */
  amountCents?: number;
  /**
   * Items being returned. When provided, the refund is PARTIAL: sum of each
   * item's unit price × quantity, plus the proportional shipping. Prices come
   * from the completed order's line-item snapshot; for marketplace items not in
   * that snapshot, from the cross_store_line_items. When omitted (or none
   * match), the full captured amount is refunded.
   */
  returnedItems?: Array<{ variantId: string; quantity: number }>;
  reason?: string;
  /** Stable per-return key, propagated to PSPs that support request dedupe. */
  idempotencyKey?: string;
}

export interface RefundOrderPaymentResult {
  refunded: boolean;
  amountCents: number;
  paymentIntentId?: string;
  providerRefundId?: string;
  reason?: string;
}

export interface RefundReconciliationResult {
  state: "succeeded" | "pending" | "failed" | "unknown";
  paymentIntentId?: string;
  reason?: string;
}

/**
 * THE single money-back-to-buyer refund path, shared by BOTH return policies
 * (own-store returns via ProcessRefund, and marketplace returns via the return
 * accept flow). It must not be duplicated per policy — the marketplace-specific
 * concern (cancelling the seller repasse) lives elsewhere; the actual reversal
 * of the buyer's charge at the PSP lives here.
 *
 * Resolution chain: externalOrderId → CompletedOrder.sessionId → the approved
 * PaymentIntent for that session → its providerPaymentId → provider.refundPayment
 * (Asaas /payments/{id}/refund or Stripe refunds.create, chosen by the routing
 * adapter). The PSP moves the money; we only instruct and record.
 *
 * Degrades safely: if the order/payment can't be resolved or the provider has no
 * refund capability (e.g. crypto → manual), it returns refunded:false with a
 * reason instead of throwing, so the return flow is never blocked by a refund
 * that must be handled out-of-band.
 */
@Injectable()
export class RefundPaymentService {
  private readonly logger = new Logger(RefundPaymentService.name);

  constructor(
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_PROVIDER_PORT) private readonly provider: PaymentProviderPort,
    @Optional() @Inject(ORDER_REPOSITORY) private readonly orders?: OrderRepository,
    @Optional() @Inject(CROSS_STORE_ORDER_REPOSITORY) private readonly crossStore?: CrossStoreOrderRepository,
  ) {}

  /**
   * Partial-refund amount for the returned items: Σ(unitPrice × qty) + a
   * proportional slice of the shipping the buyer paid. Prices are resolved from
   * the order's own line-item snapshot first, then (for marketplace items) from
   * the cross-store line items. Returns null when nothing could be priced, so
   * the caller falls back to a full refund.
   */
  private async computeReturnedItemsAmount(
    order: CompletedOrder,
    externalOrderId: string,
    merchantId: string,
    returnedItems: Array<{ variantId: string; quantity: number }>,
  ): Promise<number | null> {
    const priceByVariant = new Map<string, number>();
    for (const li of order.lineItems ?? []) {
      if (li.variantId) priceByVariant.set(li.variantId, li.unitPriceCents);
      if (li.sku) priceByVariant.set(li.sku, li.unitPriceCents);
    }
    // Marketplace items are ALSO present in order.lineItems (a federated product
    // added to the storefront cart is snapshotted like any other line, with its
    // unit price), so the map above already covers them. The cross-store repo is
    // consulted only as a fallback for legacy orders whose lineItems snapshot is
    // missing (pre-migration) but which do have cross_store_line_items.
    if (this.crossStore && priceByVariant.size === 0) {
      try {
        const cs = await this.crossStore.findByOrderId(externalOrderId);
        for (const li of cs) {
          priceByVariant.set(li.federatedProductId, li.unitPriceCents);
        }
      } catch { /* non-fatal */ }
    }

    let itemsCents = 0;
    let priced = 0;
    for (const it of returnedItems) {
      const unit = priceByVariant.get(it.variantId);
      if (unit != null) {
        itemsCents += unit * it.quantity;
        priced += 1;
      }
    }
    if (priced === 0) return null;

    // Proportional shipping: returnedQty / totalOrderedQty × shipping. Full
    // shipping when every ordered unit is being returned.
    const shippingCents = order.shippingCents ?? 0;
    let shippingPortion = 0;
    if (shippingCents > 0) {
      const totalOrderedQty = (order.lineItems ?? []).reduce((s, li) => s + li.quantity, 0);
      const returnedQty = returnedItems.reduce((s, it) => s + it.quantity, 0);
      shippingPortion = totalOrderedQty > 0
        ? Math.floor((shippingCents * Math.min(returnedQty, totalOrderedQty)) / totalOrderedQty)
        : shippingCents;
    }
    return itemsCents + shippingPortion;
  }

  async refundOrderPayment(
    input: RefundOrderPaymentInput,
  ): Promise<RefundOrderPaymentResult> {
    if (!this.orders) {
      return { refunded: false, amountCents: 0, reason: "order_repository_unavailable" };
    }

    const order = await this.orders.findCompletedOrderByExternalOrderId(
      input.merchantId,
      input.externalOrderId,
    );
    if (!order) {
      return { refunded: false, amountCents: 0, reason: "completed_order_not_found" };
    }

    const intent = await this.payments.findApprovedBySessionId(
      input.merchantId,
      order.sessionId,
    );
    if (!intent) {
      return { refunded: false, amountCents: 0, reason: "approved_payment_not_found" };
    }

    const snap = intent.snapshot();
    if (!snap.providerPaymentId) {
      return { refunded: false, amountCents: 0, reason: "no_provider_payment_id" };
    }

    // Resolve the amount: explicit > per-item partial > full captured.
    const captured = snap.approvedAmountCents ?? snap.amountCents;
    let requested: number;
    if (input.amountCents && input.amountCents > 0) {
      requested = input.amountCents;
    } else if (input.returnedItems && input.returnedItems.length > 0) {
      const partial = await this.computeReturnedItemsAmount(
        order,
        input.externalOrderId,
        input.merchantId,
        input.returnedItems,
      );
      requested = partial ?? captured; // fall back to full when items can't be priced
    } else {
      requested = captured;
    }
    // Never refund more than what was captured.
    const amountCents = Math.min(requested, captured);
    if (amountCents <= 0) {
      return { refunded: false, amountCents: 0, reason: "refund_amount_invalid" };
    }

    if (typeof this.provider.refundPayment !== "function") {
      return { refunded: false, amountCents, paymentIntentId: snap.id, reason: "provider_refund_unsupported" };
    }

    try {
      const result = await this.provider.refundPayment({
        merchantId: input.merchantId,
        providerPaymentId: snap.providerPaymentId,
        amountCents,
        reason: input.reason,
        idempotencyKey: input.idempotencyKey,
      });
      this.logger.log(
        `Refund issued: order ${input.externalOrderId} session ${order.sessionId} amount ${amountCents} refundId ${result.refundId} status ${result.status}`,
      );
      // A PSP accepting the refund request is not evidence that funds were
      // returned. Only a terminal success can complete the return locally;
      // pending and manual refunds must remain operationally visible.
      const refunded = result.status === "succeeded";
      return {
        refunded,
        amountCents,
        paymentIntentId: snap.id,
        providerRefundId: result.refundId,
        reason: refunded ? undefined : `provider_refund_${result.status}`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Refund failed for order ${input.externalOrderId}: ${msg}`);
      return { refunded: false, amountCents, paymentIntentId: snap.id, reason: `provider_error: ${msg}` };
    }
  }

  /**
   * Query an already-created provider refund. There is deliberately no fallback
   * POST: unknown provider state must retain the durable PENDING marker.
   */
  async reconcileRefundPayment(input: {
    merchantId: string;
    externalOrderId: string;
    providerRefundId: string;
    paymentIntentId?: string;
    refundReference?: string;
  }): Promise<RefundReconciliationResult> {
    if (!this.orders || typeof this.provider.fetchRefundStatus !== "function") {
      return { state: "unknown", reason: "provider_refund_status_unsupported" };
    }
    const order = await this.orders.findCompletedOrderByExternalOrderId(input.merchantId, input.externalOrderId);
    if (!order) return { state: "unknown", reason: "completed_order_not_found" };
    // A provider webhook may already have marked this intent as refunded while
    // the local return is PENDING. Prefer its durable id in that situation;
    // querying only `approved` would make reconciliation impossible.
    const intent = input.paymentIntentId
      ? await this.payments.getIntentById(input.merchantId, input.paymentIntentId)
      : await this.payments.findApprovedBySessionId(input.merchantId, order.sessionId);
    if (!intent) return { state: "unknown", reason: "approved_payment_not_found" };
    const snap = intent.snapshot();
    if (!snap.providerPaymentId) {
      return { state: "unknown", paymentIntentId: snap.id, reason: "no_provider_payment_id" };
    }

    try {
      const result = await this.provider.fetchRefundStatus({
        merchantId: input.merchantId,
        providerPaymentId: snap.providerPaymentId,
        providerRefundId: input.providerRefundId,
        refundReference: input.refundReference,
        provider: snap.creation?.input.provider,
        providerAccountFingerprint: snap.creation?.input.providerAccountFingerprint,
      });
      return { state: result.state, paymentIntentId: snap.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Refund reconciliation failed for order ${input.externalOrderId}: ${message}`);
      return { state: "unknown", paymentIntentId: snap.id, reason: `provider_error: ${message}` };
    }
  }
}
