import type { MerchantAuditEvent } from "../../domain/ports/audit-repository.port.js";

export function toAuditEventResponse(event: MerchantAuditEvent) {
  return {
    id: event.id,
    actor_type: event.actorType,
    actor_id: event.actorId,
    action: event.action,
    resource_type: event.resourceType,
    resource_id: event.resourceId ?? null,
    correlation_id: event.correlationId ?? null,
    ip_address: event.ipAddress ?? null,
    user_agent: event.userAgent ?? null,
    outcome: event.outcome,
    metadata: event.metadata,
    occurred_at: event.occurredAt,
  };
}
