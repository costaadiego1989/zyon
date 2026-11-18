import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  currentTenantPrincipal,
  type TenantPrincipalRequest,
} from "../../../shared/auth/tenant-principal.js";
export function fiscalHttpActor(
  req: TenantPrincipalRequest,
  environment: unknown
) {
  const p = currentTenantPrincipal(req);
  if (p.kind !== "human" || !["owner", "admin"].includes(p.role))
    throw new ForbiddenException("tenant_role_required");
  if (environment !== "homologation" && environment !== "production")
    throw new BadRequestException("fiscal_environment_required");
  return {
    scope: {
      merchantId: p.tenantId,
      environment: environment as "homologation" | "production",
    },
    actor: { actorKind: "merchant", actorId: p.userId },
    principal: p,
  };
}
export async function fiscalHttp<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (e) {
    const code =
      e instanceof Error && /^fiscal_[a-z0-9_]{1,100}$/.test(e.message)
        ? e.message
        : "fiscal_operation_unavailable";
    if (code.endsWith("not_found")) throw new NotFoundException(code);
    if (
      code === "fiscal_olist_authorization_expired_or_used" || code === "fiscal_olist_connection_changed" ||
      code.includes("not_allowed") ||
      code.includes("not_ready") ||
      code.includes("required") ||
      code.includes("immutable") || code.endsWith("_pending") || code.endsWith("_busy")
    )
      throw new ConflictException({
        code,
        ...(e && typeof e === "object" && "pending" in e
          ? { pending: e.pending }
          : {}),
      });
    if (
      code === "fiscal_olist_issuer_mismatch" || code.includes("invalid") ||
      code.includes("unsupported") ||
      code.includes("unconfirmed")
    )
      throw new BadRequestException(code);
    throw new ServiceUnavailableException(code);
  }
}
