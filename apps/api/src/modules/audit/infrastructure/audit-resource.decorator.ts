import { SetMetadata } from "@nestjs/common";

/**
 * Decorator to explicitly specify resource name for audit events.
 * Interceptor reads this metadata and uses it instead of deriving from URL path.
 * (AUD-H2: Add @AuditResource decorator for explicit resource naming)
 */
export const AUDIT_RESOURCE_KEY = "audit:resource";
export const AUDIT_RESOURCE_ID_KEY = "audit:resource-id";

export function AuditResource(resourceType: string) {
  return SetMetadata(AUDIT_RESOURCE_KEY, resourceType);
}

export function AuditResourceId(paramName: string) {
  return SetMetadata(AUDIT_RESOURCE_ID_KEY, paramName);
}
