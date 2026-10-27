/**
 * Pure mapper functions: operations domain → v1 API response shape.
 * No side effects, no business logic.
 */
export class OrderEntityMapper {
  /**
   * OrderSummary → v1 list item response
   */
  static toOrderSummaryResponse(order: any) {
    return {
      id: order.id,
      external_order_id: order.externalOrderId ?? order.external_order_id ?? null,
      status: order.status,
      total_minor: order.totalMinor ?? order.total ?? null,
      currency: order.currency ?? 'BRL',
      customer_email: order.customerEmail ?? order.customer_email ?? null,
      items_count: order.itemsCount ?? order.items?.length ?? 0,
      created_at: order.createdAt ?? order.created_at ?? null,
      updated_at: order.updatedAt ?? order.updated_at ?? null,
    };
  }

  /**
   * OrderDetail → v1 single order response
   */
  static toOrderDetailResponse(order: any) {
    return {
      id: order.id,
      external_order_id: order.externalOrderId ?? order.external_order_id ?? null,
      session_id: order.sessionId ?? order.session_id ?? null,
      status: order.status,
      total_minor: order.totalMinor ?? order.total ?? null,
      currency: order.currency ?? 'BRL',
      customer: order.customer ?? null,
      items: order.items ?? [],
      shipping: order.shipping ?? null,
      tracking: order.tracking
        ? {
            code: order.tracking.code ?? order.tracking.tracking_code ?? null,
            carrier: order.tracking.carrier ?? null,
            url: order.tracking.url ?? null,
            status: order.tracking.status ?? null,
          }
        : null,
      accepted_offer_id: order.acceptedOfferId ?? order.accepted_offer_id ?? null,
      payment_intent_id: order.paymentIntentId ?? order.payment_intent_id ?? null,
      created_at: order.createdAt ?? order.created_at ?? null,
      updated_at: order.updatedAt ?? order.updated_at ?? null,
    };
  }

  /**
   * Order → v1 tracking response
   */
  static toTrackingResponse(order: any) {
    return {
      order_id: order.id,
      tracking_code: order.tracking?.code ?? order.tracking?.tracking_code ?? null,
      carrier: order.tracking?.carrier ?? null,
      tracking_url: order.tracking?.url ?? null,
      status: order.tracking?.status ?? order.status ?? null,
      events: order.tracking?.events ?? [],
      updated_at: order.tracking?.updatedAt ?? order.updated_at ?? null,
    };
  }

  /**
   * Cancel result → v1 response
   */
  static toCancelOrderResponse(result: any) {
    return {
      cancelled: true,
      order_id: result.orderId ?? result.order_id ?? result.id,
      status: result.status ?? 'cancelled',
    };
  }

  /**
   * Update tracking result → v1 response
   */
  static toUpdateTrackingResponse(result: any) {
    return {
      updated: true,
      order_id: result.orderId ?? result.order_id ?? result.id,
      status: result.status,
      tracking_code: result.trackingCode ?? result.tracking_code ?? null,
    };
  }
}
