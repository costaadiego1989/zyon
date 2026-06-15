import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { currentTenantPrincipal } from "../../../../shared/auth/tenant-principal.js";
import {
  TENANT_ACCESS_METADATA,
  type TenantAccessRequirement,
} from "./tenant-access.decorator.js";

@Injectable()
export class TenantAccessGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requirement =
      this.reflector.getAllAndOverride<TenantAccessRequirement>(
        TENANT_ACCESS_METADATA,
        [context.getHandler(), context.getClass()],
      );
    if (!requirement) return true;

    const principal = currentTenantPrincipal(
      context.switchToHttp().getRequest(),
    );
    if (principal.kind === "human") {
      const roles = requirement.humanRoles ?? ["owner", "admin"];
      if (roles.includes(principal.role)) return true;
      throw new ForbiddenException("tenant_role_required");
    }

    if (requirement.humanOnly) {
      throw new ForbiddenException("human_session_required");
    }

    const requiredScopes = requirement.serviceScopes ?? [];
    const missing = requiredScopes.filter(
      (scope) => !principal.scopes.includes(scope),
    );
    if (missing.length === 0) return true;
    throw new ForbiddenException("missing_api_key_scope");
  }
}
