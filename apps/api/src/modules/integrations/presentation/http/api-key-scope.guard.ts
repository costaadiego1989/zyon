import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { TenantApiScope } from "../../../../shared/auth/tenant-principal.js";
import { hasApiKeyScope } from "../../domain/api-key-scope.js";
import { API_KEY_SCOPES_METADATA } from "./api-key-scope.decorator.js";
import { currentApiKey } from "./merchant-api-key.guard.js";

@Injectable()
export class ApiKeyScopeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndMerge<TenantApiScope[]>(
      API_KEY_SCOPES_METADATA,
      [context.getClass(), context.getHandler()],
    );
    if (!required?.length) {
      return true;
    }

    const apiKey = currentApiKey(context.switchToHttp().getRequest());
    const missing = required.filter((scope) => !hasApiKeyScope(apiKey.scopes, scope));
    if (missing.length) {
      throw new ForbiddenException("missing_api_key_scope");
    }
    return true;
  }
}
