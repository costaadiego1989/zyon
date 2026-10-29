import { randomUUID } from "node:crypto";
import type { DomainEventEnvelope, ShippingDomainEventType } from "@zyon/shared-types";

export function createShippingEventEnvelope<TPayload extends Record<string, unknown>>(input: {
  eventType: ShippingDomainEventType;
  merchantId: string;
  payload: TPayload;
  correlationId?: string;
  causationId?: string;
  occurredAt?: Date;
}): DomainEventEnvelope<TPayload> {
  return {
    event_id: `evt_${randomUUID()}`,
    event_type: input.eventType,
    schema_version: 1,
    merchant_id: input.merchantId,
    occurred_at: (input.occurredAt ?? new Date()).toISOString(),
    correlation_id: input.correlationId ?? `corr_${randomUUID()}`,
    causation_id: input.causationId ?? input.eventType,
    producer: "shipping",
    payload: input.payload
  };
}
