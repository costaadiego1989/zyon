import type { MerchantAuditEvent } from '../../../../audit/domain/ports/audit-repository.port.js';
import type { AuditEventResponse } from '../../presentation/http/dtos/audit.dtos.js';

export class AuditEntityMapper {
  static toResponse(event: MerchantAuditEvent): AuditEventResponse {
    return {
      id: event.id,
      action: event.action,
      actor_type: event.actorType,
      actor_id: event.actorId,
      resource_type: event.resourceType,
      resource_id: event.resourceId,
      outcome: event.outcome,
      metadata: event.metadata,
      created_at: event.occurredAt,
    };
  }

  static toListResponse(
    data: MerchantAuditEvent[],
    nextCursor: string | null,
  ) {
    return {
      data: data.map(AuditEntityMapper.toResponse),
      next_cursor: nextCursor,
    };
  }
}
