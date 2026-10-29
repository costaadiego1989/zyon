import type { ReturnEntity } from '../../../../returns/domain/entities/return.entity.js';

export class ReturnEntityMapper {
  static toReturnResponse(returnEntity: ReturnEntity) {
    return {
      id: returnEntity.id,
      merchant_id: returnEntity.merchantId,
      order_id: returnEntity.orderId,
      buyer_id: returnEntity.buyerId,
      reason: returnEntity.reason,
      notes: returnEntity.notes ?? null,
      status: returnEntity.status,
      items: returnEntity.items.map((item) => ({
        id: item.id,
        variant_id: item.variantId,
        quantity: item.quantity,
        reason: item.reason ?? null,
      })),
      label: returnEntity.label
        ? {
            id: returnEntity.label.id,
            carrier: returnEntity.label.carrier,
            tracking_number: returnEntity.label.trackingNumber,
            label_url: returnEntity.label.labelUrl ?? null,
            expires_at: returnEntity.label.expiresAt,
            created_at: returnEntity.label.createdAt,
          }
        : null,
      inspection: returnEntity.inspection
        ? {
            id: returnEntity.inspection.id,
            inspected_by: returnEntity.inspection.inspectedBy,
            item_condition: returnEntity.inspection.itemCondition,
            verdict: returnEntity.inspection.verdict,
            notes: returnEntity.inspection.notes ?? null,
            inspected_at: returnEntity.inspection.inspectedAt,
          }
        : null,
      refund: returnEntity.refund
        ? {
            id: returnEntity.refund.id,
            amount_in_cents: returnEntity.refund.amountInCents,
            status: returnEntity.refund.status,
            payment_intent_id: returnEntity.refund.paymentIntentId ?? null,
            processed_at: returnEntity.refund.processedAt ?? null,
            created_at: returnEntity.refund.createdAt,
          }
        : null,
      created_at: returnEntity.createdAt,
      updated_at: returnEntity.updatedAt,
    };
  }
}
