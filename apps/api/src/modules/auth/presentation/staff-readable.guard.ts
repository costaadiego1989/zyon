import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { currentTenantPrincipal, type TenantRole } from "../../../shared/auth/tenant-principal.js";
import { STAFF_READABLE_METADATA } from "./staff-readable.decorator.js";

const ALLOWED: readonly TenantRole[] = ["owner", "admin", "staff"];

@Injectable()
export class StaffReadableGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const flagged = this.reflector.getAllAndOverride<boolean>(STAFF_READABLE_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!flagged) return true; // not decorated — bypass; rely on @RequireTenantRoles if needed
    const principal = currentTenantPrincipal(context.switchToHttp().getRequest());
    // Service principals (API key) are governed by their own scopes (TenantAccessGuard).
    // Only human principals need the role check.
    if (principal.kind === "service") return true;
    if (!ALLOWED.includes(principal.role)) {
      throw new ForbiddenException("tenant_role_required");
    }
    return true;
  }
}
