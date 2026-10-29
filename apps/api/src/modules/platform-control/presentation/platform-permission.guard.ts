import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { hasPlatformPermission, type PlatformPermission } from "../domain/platform-operator.js";
import { PLATFORM_PERMISSIONS_METADATA } from "./platform-permission.decorator.js";
import { currentPlatformPrincipal, type PlatformPrincipalRequest } from "./platform-principal.js";

@Injectable()
export class PlatformPermissionGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const permissions = this.reflector.getAllAndOverride<PlatformPermission[]>(PLATFORM_PERMISSIONS_METADATA, [
      context.getHandler(),
      context.getClass(),
    ]) ?? [];
    const request = context.switchToHttp().getRequest<PlatformPrincipalRequest>();
    const principal = currentPlatformPrincipal(request);
    if (permissions.every(permission => hasPlatformPermission(principal.role, permission))) return true;
    throw new ForbiddenException("platform_permission_denied");
  }
}
