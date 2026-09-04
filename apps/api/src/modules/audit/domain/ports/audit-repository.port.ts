export const AUDIT_REPOSITORY = Symbol("AUDIT_REPOSITORY");

export interface MerchantAuditEvent {
  id: string;
  merchantId: string;
  actorType: "human" | "service";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
  ipAddress?: string;
  userAgent?: string;
  outcome: "success" | "failed";
  metadata: Record<string, unknown>;
  occurredAt: string;
}

export interface AuditCursor {
  occurredAt: string;
  id: string;
}

export interface AuditRepository {
  record(
    event: Omit<MerchantAuditEvent, "id" | "occurredAt">,
  ): Promise<MerchantAuditEvent>;
  list(input: {
    merchantId: string;
    limit: number;
    cursor?: AuditCursor;
    action?: string;
    resourceType?: string;
    actorId?: string;
    since?: string;
    until?: string;
  }): Promise<MerchantAuditEvent[]>;
}
