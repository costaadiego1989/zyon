import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from "@nestjs/common";
import {
  setTenantPrincipal,
  type TenantPrincipalRequest,
} from "../../../../shared/auth/tenant-principal.js";
import { AuthenticateMerchantApiKeyService } from "../../application/authenticate-merchant-api-key.service.js";
import type { MerchantApiKeyContext } from "../../domain/integrations.types.js";

@Injectable()
export class MerchantApiKeyGuard implements CanActivate {
  constructor(private readonly authenticate: AuthenticateMerchantApiKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = readApiKey(request.headers ?? {});
    if (!rawKey) throw new UnauthorizedException("missing_api_key");

    const apiKey = await this.authenticate.execute(rawKey, request.ip);
    request.apiKey = apiKey;
    setTenantPrincipal(request as TenantPrincipalRequest, {
      kind: "service",
      tenantId: apiKey.merchantId,
      credentialId: apiKey.id,
      environment: apiKey.environment,
      scopes: apiKey.scopes,
    });
    return true;
  }
}

export function currentApiKey(request: { apiKey?: unknown }): MerchantApiKeyContext {
  if (!request.apiKey) throw new UnauthorizedException("missing_api_key_context");
  return request.apiKey as MerchantApiKeyContext;
}

function readApiKey(headers: Record<string, unknown>): string | undefined {
  const explicit = headers["x-aacp-api-key"];
  if (typeof explicit === "string" && explicit.trim()) return explicit.trim();
  const authorization = headers.authorization;
  if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim();
  }
  return undefined;
}
