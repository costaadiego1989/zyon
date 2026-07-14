import type { MerchantAuditEvent } from "../../domain/ports/audit-repository.port.js";

/**
 * AUD-M2: Shared camelCase-to-snake_case response mapper.
 * Single source of truth for audit event serialization.
 */
export function toAuditEventResponse(event: MerchantAuditEvent) {
  return {
    id: event.id,
    actor_type: event.actorType,
    actor_id: event.actorId,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId ?? null,
    correlation_id: event.correlationId ?? null,
    metadata: event.metadata,
    occurred_at: event.occurredAt,
  };
}
