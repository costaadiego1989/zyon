import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  currentTenantPrincipal,
  type TenantRole,
} from "../../../shared/auth/tenant-principal.js";
import { TENANT_ROLES_METADATA } from "./tenant-role.decorator.js";

@Injectable()
export class TenantRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<TenantRole[]>(
      TENANT_ROLES_METADATA,
      [context.getHandler(), context.getClass()],
    );
    if (!roles?.length) {
      return true;
    }

    const principal = currentTenantPrincipal(
      context.switchToHttp().getRequest(),
    );
    if (principal.kind !== "human" || !roles.includes(principal.role)) {
      throw new ForbiddenException("tenant_role_required");
    }
    return true;
  }
}
