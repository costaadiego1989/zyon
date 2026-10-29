/**
 * Domain model for the actor performing an audit event.
 * Decouples audit from auth/tenant-principal types.
 * (AUD-H4: Decouple from TenantPrincipal)
 */
export interface AuditActor {
  type: "human" | "service";
  id: string;
}

/**
 * Convert TenantPrincipal to AuditActor.
 * Caller is responsible for this mapping; audit doesn't depend on auth types.
 */
export function principalToAuditActor(principal: {
  kind: "human" | "service";
  userId?: string;
  credentialId?: string;
}): AuditActor {
  return {
    type: principal.kind,
    id: principal.kind === "human" ? principal.userId! : principal.credentialId!,
  };
}
