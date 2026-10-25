export type PlatformAuditEvent = {
  id: string;
  actorOperatorId?: string;
  action: string;
  permission: string;
  environment: string;
  targetType: string;
  targetId?: string;
  correlationId: string;
  outcome: string;
  details?: unknown;
  occurredAt: Date;
  actor?: {
    email: string;
    role: string;
  };
};

export type PlatformAuditCursor = {
  occurredAt: Date;
  id: string;
};

const ALLOWED_DETAIL_KEYS = new Set([
  "source",
  "channel",
  "component",
  "executionStatus",
  "timezone",
  "status",
  "provider",
  "previousStatus",
  "previousPriority",
  "previousAssignedOperatorId",
  "priority",
  "assignedOperatorId",
  "itemCount",
  "returnedItems",
  "totalRecords",
  "limit",
  "noteAdded",
  "actionFilterApplied",
  "actorFilterApplied",
  "dateRangeApplied",
  "cursorApplied",
  "searchApplied",
  "roleFilterApplied",
  "statusFilterApplied",
  "previousRole",
  "role",
  "sessionsRevoked",
]);

export function presentPlatformAuditEvent(event: PlatformAuditEvent) {
  const details = sanitizePlatformAuditDetails(event.details);
  return {
    id: event.id,
    occurred_at: event.occurredAt.toISOString(),
    action: event.action,
    outcome: event.outcome,
    ...(event.actorOperatorId ? { actor_operator_id: event.actorOperatorId } : {}),
    ...(event.actor?.email ? { actor_operator_email: event.actor.email } : {}),
    ...(event.actor?.role ? { actor_operator_role: event.actor.role } : {}),
    permission: event.permission,
    environment: event.environment,
    target_type: event.targetType,
    ...(event.targetId ? { target_id: event.targetId } : {}),
    correlation_id: event.correlationId,
    ...(Object.keys(details).length > 0 ? { details } : {}),
  };
}

export function sanitizePlatformAuditDetails(value: unknown): Record<string, string | number | boolean> {
  if (!isRecord(value)) return {};
  const sanitized: Record<string, string | number | boolean> = {};
  for (const key of ALLOWED_DETAIL_KEYS) {
    const candidate = value[key];
    if (typeof candidate === "boolean") {
      sanitized[key] = candidate;
      continue;
    }
    if (typeof candidate === "number" && Number.isSafeInteger(candidate) && candidate >= 0) {
      sanitized[key] = candidate;
      continue;
    }
    if (typeof candidate === "string" && isSafeOperationalText(candidate)) {
      sanitized[key] = candidate;
    }
  }
  return sanitized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeOperationalText(value: string): boolean {
  return value.length > 0 && value.length <= 160 && !/[\u0000-\u001F\u007F]/.test(value);
}
