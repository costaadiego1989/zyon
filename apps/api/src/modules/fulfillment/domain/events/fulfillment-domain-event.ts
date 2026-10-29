import type { FulfillmentDomainEventType, DomainEventEnvelope } from "@zyon/shared-types";

export function createFulfillmentEventEnvelope<TPayload extends Record<string, unknown>>(input: {
  eventType: FulfillmentDomainEventType;
  merchantId: string;
  payload: TPayload;
  causationId?: string;
  eventId?: string;
  correlationId?: string;
  occurredAt?: string;
}): DomainEventEnvelope<TPayload> {
  return {
    event_id: input.eventId ?? `evt_${crypto.randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: input.occurredAt ?? new Date().toISOString(),
    correlation_id: input.correlationId ?? `corr_${crypto.randomUUID()}`,
    causation_id: input.causationId ?? input.eventType,
    producer: "fulfillment",
    payload: input.payload
  };
}
