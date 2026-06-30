import type {
  CommerceDomainEventType,
  DomainEventEnvelope
} from "@zyon/shared-types";

export function createCommerceEventEnvelope<TPayload extends Record<string, unknown>>(input: {
  eventType: CommerceDomainEventType;
  merchantId: string;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
}): DomainEventEnvelope<TPayload> {
  return {
    event_id: `evt_${crypto.randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    correlation_id: input.correlationId ?? `corr_${crypto.randomUUID()}`,
    causation_id: input.causationId ?? input.eventType,
    producer: "commerce",
    payload: input.payload
  };
}
