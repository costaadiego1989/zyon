import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Logger } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { currentTenantPrincipal, type TenantRole } from "../../../shared/auth/tenant-principal.js";
import { TENANT_ROLES_METADATA } from "./tenant-role.decorator.js";

const logger = new Logger("TenantRoleGuard");

/**
 * L15: Warn when invoked with no @RequireTenantRoles decorator.
 * This makes accidental RBAC misuse visible.
 */
@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<TenantRole[]>(
      TENANT_ROLES_METADATA,
      [context.getHandler(), context.getClass()]
    );
    if (!roles?.length) {
      // L15: No decorator — log warning to alert developer
      const handler = context.getHandler();
      const className = context.getClass().name;
      const handlerName = handler?.name ?? "unknown";
      logger.warn(
        `TenantRoleGuard invoked without @RequireTenantRoles decorator on ${className}.${handlerName} — route is not RBAC-protected`
      );
      return true;
    }

    const principal = currentTenantPrincipal(context.switchToHttp().getRequest());
    if (principal.kind !== "human" || !roles.includes(principal.role)) {
      throw new ForbiddenException("tenant_role_required");
    }
    return true;
  }
}
