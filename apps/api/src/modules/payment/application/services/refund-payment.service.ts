import { Inject, Injectable, Logger, Optional } from "@nestjs/common";
import { paymentProviderRoute } from "../../domain/payment-provider-route.js";
import { PAYMENT_REPOSITORY } from "../../domain/ports/payment-repository.port.js";
import type { PaymentRepository } from "../../domain/ports/payment-repository.port.js";
import { PAYMENT_PROVIDER_PORT } from "../../domain/ports/payment-provider.port.js";
import type { PaymentProviderPort } from "../../domain/ports/payment-provider.port.js";
import { ORDER_REPOSITORY } from "../../../checkout/domain/ports/order.repository.port.js";
import type { OrderRepository } from "../../../checkout/domain/ports/order.repository.port.js";
import { CROSS_STORE_ORDER_REPOSITORY } from "../../../marketplace/domain/ports/cross-store-order-repository.port.js";
import type { CrossStoreOrderRepository } from "../../../marketplace/domain/ports/cross-store-order-repository.port.js";
import type { CompletedOrder } from "@zyon/shared-types";
import { refundShippingCents } from "../../../../shared/commerce/refund-shipping.js";
import { assertPaymentAmount, type PaymentAmountBreakdown } from "../../domain/payment-amount.js";

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
   * that snapshot, from the cross_store_line_items. Unpriced or invalid items
   * cannot authorize a refund of the entire order.
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

export interface PreparedOrderRefund extends RefundOrderPaymentResult {
  fullOrderReturn?: boolean;
  providerRequest?: Parameters<NonNullable<PaymentProviderPort["refundPayment"]>>[0];
}

export interface RefundReconciliationResult {
  state: "succeeded" | "pending" | "failed" | "unknown";
  paymentIntentId?: string;
  reason?: string;
}

/**
 * Ordinary-order refund path. Marketplace captures require their own immutable
 * allocation and operation journal for submission and reconciliation.
 *
 * Resolution chain: externalOrderId → CompletedOrder.sessionId → the approved
 * PaymentIntent for that session → its providerPaymentId → provider.refundPayment
 * (Asaas /payments/{id}/refund or Stripe refunds.create, chosen by the routing
 * adapter). The PSP moves the money; we only instruct and record.
 *
 * An unresolved original payment or unsupported provider cannot authorize an
 * automatic refund. The caller receives the reason before claiming a request.
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
   * the cross-store line items. An unproven item cannot authorize money movement.
   */
  private async computeReturnedItemsAmount(
    order: CompletedOrder,
    externalOrderId: string,
    merchantId: string,
    returnedItems: Array<{ variantId: string; quantity: number }>,
    breakdown?: PaymentAmountBreakdown,
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

    if (!returnedItems.length || new Set(returnedItems.map(row => row.variantId)).size !== returnedItems.length) return null;
    let itemsCents = 0;
    for (const it of returnedItems) {
      const unit = priceByVariant.get(it.variantId);
      const ordered = (order.lineItems ?? []).filter(row => row.variantId === it.variantId || row.sku === it.variantId)
        .reduce((sum, row) => sum + row.quantity, 0);
      if (unit == null || !Number.isSafeInteger(unit) || unit < 0 || !Number.isSafeInteger(it.quantity) ||
        it.quantity < 1 || it.quantity > ordered) return null;
      itemsCents += unit * it.quantity;
    }

    // Proportional shipping: returnedQty / totalOrderedQty × shipping. Full
    // shipping when every ordered unit is being returned.
    if (breakdown) {
      const snapshotSubtotal = (order.lineItems ?? []).reduce((sum, row) => sum + row.unitPriceCents * row.quantity, 0);
      if (snapshotSubtotal !== breakdown.itemsSubtotalCents || snapshotSubtotal < 0 ||
          breakdown.shippingCents !== (order.shippingCents ?? 0)) return null;
      // Refund what was paid for the returned goods, including their share of
      // the original discount. A catalog price cannot erase a checkout discount.
      itemsCents = snapshotSubtotal === 0 ? 0 : Number(BigInt(itemsCents) * BigInt(breakdown.itemsSubtotalCents - breakdown.discountCents) / BigInt(snapshotSubtotal));
    }
    const shippingCents = breakdown?.shippingCents ?? order.shippingCents ?? 0;
    let shippingPortion = 0;
    if (shippingCents > 0) {
      const totalOrderedQty = (order.lineItems ?? []).reduce((s, li) => s + li.quantity, 0);
      const returnedQty = returnedItems.reduce((s, it) => s + it.quantity, 0);
      try {
        shippingPortion = refundShippingCents({ originalCents: shippingCents, orderedQuantity: totalOrderedQty, returnedQuantity: returnedQty });
      } catch { return null; }
    }
    return itemsCents + shippingPortion;
  }

  /**
   * A return that covers every line of the completed order is a full reversal
   * of the buyer's charge. The captured amount includes the buyer service fee,
   * so it must be returned as well. Partial returns keep the item-and-shipping
   * calculation below, because the order remains partially fulfilled.
   */
  private isFullOrderReturn(
    order: CompletedOrder,
    returnedItems: Array<{ variantId: string; quantity: number }>,
  ): boolean {
    const ordered = new Map<string, number>();
    for (const lineItem of order.lineItems ?? []) {
      if (!lineItem.variantId || lineItem.quantity <= 0) continue;
      ordered.set(lineItem.variantId, (ordered.get(lineItem.variantId) ?? 0) + lineItem.quantity);
    }
    if (ordered.size === 0) return false;
    if ((order.lineItems ?? []).some(row => !row.variantId || !Number.isSafeInteger(row.quantity) || row.quantity < 1)) return false;

    const returned = new Map<string, number>();
    for (const item of returnedItems) {
      if (!item.variantId || item.quantity <= 0) continue;
      returned.set(item.variantId, (returned.get(item.variantId) ?? 0) + item.quantity);
    }
    if (returned.size !== ordered.size) return false;
    return [...ordered].every(([variantId, quantity]) => returned.get(variantId) === quantity);
  }

  async refundOrderPayment(
    input: RefundOrderPaymentInput,
  ): Promise<RefundOrderPaymentResult> {
    return this.refundPreparedPayment(await this.prepareOrderRefund(input));
  }

  /** Resolve the original payment and amount before recording the durable claim.
   * No PSP request is sent by preparation. */
  async prepareOrderRefund(input: RefundOrderPaymentInput): Promise<PreparedOrderRefund> {
    if (!this.orders) {
      return { refunded: false, amountCents: 0, reason: "order_repository_unavailable" };
    }

    const order = await this.originalOrder(input.merchantId, input.externalOrderId);
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
    // Marketplace returns require allocation reversals and payout holds in the
    // same workflow. The single-merchant amount fallback cannot authorize them.
    if (snap.creation?.input.marketplaceFunding) {
      return { refunded: false, amountCents: 0, paymentIntentId: snap.id, reason: "marketplace_refund_allocation_required" };
    }
    if (!snap.providerPaymentId) {
      return { refunded: false, amountCents: 0, reason: "no_provider_payment_id" };
    }

    // Resolve the amount: explicit > per-item partial > full captured. A return
    // that covers every order line is a full buyer refund, including the
    // service fee present in the captured amount.
    const captured = snap.approvedAmountCents ?? snap.amountCents;
    if (!Number.isSafeInteger(captured) || captured <= 0 || captured > 2_147_483_647) {
      return { refunded: false, amountCents: 0, reason: "refund_amount_invalid" };
    }
    if (snap.amountBreakdown) {
      try { assertPaymentAmount(snap.amountBreakdown, captured, snap.currency); }
      catch { return { refunded: false, amountCents: 0, paymentIntentId: snap.id, reason: "refund_amount_invalid" }; }
    }
    let requested: number;
    if (input.returnedItems !== undefined && (!input.returnedItems.length ||
        new Set(input.returnedItems.map(row => row.variantId)).size !== input.returnedItems.length ||
        input.returnedItems.some(row => !row.variantId?.trim() || !Number.isSafeInteger(row.quantity) || row.quantity < 1))) {
      return { refunded: false, amountCents: 0, paymentIntentId: snap.id, reason: "refund_items_unproven" };
    }
    if (input.amountCents !== undefined) {
      requested = input.amountCents;
    } else if (input.returnedItems && input.returnedItems.length > 0) {
      if (this.isFullOrderReturn(order, input.returnedItems)) {
        requested = captured;
      } else {
        const partial = await this.computeReturnedItemsAmount(
          order,
          input.externalOrderId,
          input.merchantId,
          input.returnedItems,
          snap.amountBreakdown,
        );
        if (partial === null) return { refunded: false, amountCents: 0, paymentIntentId: snap.id, reason: "refund_items_unproven" };
        requested = partial;
      }
    } else {
      requested = captured;
    }
    const amountCents = requested;
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > captured) {
      return { refunded: false, amountCents: 0, reason: "refund_amount_invalid" };
    }

    if (typeof this.provider.refundPayment !== "function") {
      return { refunded: false, amountCents, paymentIntentId: snap.id, reason: "provider_refund_unsupported" };
    }

    return { refunded: false, amountCents, paymentIntentId: snap.id,
      fullOrderReturn: input.returnedItems !== undefined && this.isFullOrderReturn(order, input.returnedItems), providerRequest: {
      ...paymentProviderRoute(snap.creation?.input), merchantId: input.merchantId,
      providerPaymentId: snap.providerPaymentId, amountCents, reason: input.reason, idempotencyKey: input.idempotencyKey,
    } };
  }

  /** Only call after the return owns its durable one-time submission marker. */
  async refundPreparedPayment(prepared: PreparedOrderRefund): Promise<RefundOrderPaymentResult> {
    const { providerRequest, fullOrderReturn: _fullOrderReturn, ...resultMetadata } = prepared;
    if (!providerRequest || !this.provider.refundPayment) return resultMetadata;
    const { amountCents, paymentIntentId } = prepared;
    try {
      const result = await this.provider.refundPayment(providerRequest);
      this.logger.log(
        `Refund issued: payment ${paymentIntentId} amount ${amountCents} refundId ${result.refundId} status ${result.status}`,
      );
      // A PSP accepting the refund request is not evidence that funds were
      // returned. Only a terminal success can complete the return locally;
      // pending and manual refunds must remain operationally visible.
      const refunded = result.status === "succeeded";
      return {
        refunded,
        amountCents,
        paymentIntentId,
        providerRefundId: result.refundId,
        reason: refunded ? undefined : `provider_refund_${result.status}`,
      };
    } catch (err) {
      this.logger.error(`Refund outcome unknown for payment ${paymentIntentId}`);
      return { refunded: false, amountCents, paymentIntentId, reason: "provider_refund_unknown" };
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
    const order = await this.originalOrder(input.merchantId, input.externalOrderId);
    if (!order) return { state: "unknown", reason: "completed_order_not_found" };
    // A provider webhook may already have marked this intent as refunded while
    // the local return is PENDING. Prefer its durable id in that situation;
    // querying only `approved` would make reconciliation impossible.
    const intent = input.paymentIntentId
      ? await this.payments.getIntentById(input.merchantId, input.paymentIntentId)
      : await this.payments.findApprovedBySessionId(input.merchantId, order.sessionId);
    if (!intent) return { state: "unknown", reason: "approved_payment_not_found" };
    const snap = intent.snapshot();
    // The generic return worker must not complete a marketplace return while
    // its allocation/operation journal is still pending. The dedicated refund
    // reconciler commits the provider proof and both records atomically.
    if (snap.creation?.input.marketplaceFunding) {
      return { state: "unknown", paymentIntentId: snap.id, reason: "marketplace_refund_allocation_required" };
    }
    if (!snap.providerPaymentId) {
      return { state: "unknown", paymentIntentId: snap.id, reason: "no_provider_payment_id" };
    }

    try {
      const result = await this.provider.fetchRefundStatus({
        merchantId: input.merchantId,
        providerPaymentId: snap.providerPaymentId,
        providerRefundId: input.providerRefundId,
        refundReference: input.refundReference,
        ...paymentProviderRoute(snap.creation?.input),
      });
      return { state: result.state, paymentIntentId: snap.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Refund reconciliation failed for order ${input.externalOrderId}: ${message}`);
      return { state: "unknown", paymentIntentId: snap.id, reason: `provider_error: ${message}` };
    }
  }

  private async originalOrder(merchantId: string, orderId: string) {
    return await this.orders?.findCompletedOrderByExternalOrderId(merchantId, orderId)
      ?? await this.orders?.findCompletedOrderById?.(merchantId, orderId);
  }
}
