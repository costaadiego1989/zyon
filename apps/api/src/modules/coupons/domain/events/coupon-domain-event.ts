import type { CouponsDomainEventType, DomainEventEnvelope } from "@zyon/shared-types";

export function createCouponEventEnvelope<TPayload extends Record<string, unknown>>(input: {
  eventType: CouponsDomainEventType;
  merchantId: string;
  payload: TPayload;
  causationId?: string;
}): DomainEventEnvelope<TPayload> {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: new Date().toISOString(),
    correlation_id: `corr_${crypto.randomUUID()}`,
    causation_id: input.causationId ?? input.eventType,
    producer: "coupons",
    payload: input.payload
  };
}
