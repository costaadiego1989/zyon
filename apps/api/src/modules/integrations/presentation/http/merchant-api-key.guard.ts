import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from "@nestjs/common";
import { ApiKeyService } from "../../domain/api-key.service.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../domain/ports/integrations.repository.port.js";
import type { MerchantApiKeyContext } from "../../domain/integrations.types.js";

@Injectable()
export class MerchantApiKeyGuard implements CanActivate {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const rawKey = readApiKey(request.headers ?? {});
    if (!rawKey) throw new UnauthorizedException("missing_api_key");

    const apiKey = await this.repo.findActiveApiKeyByHash(this.apiKeys.hash(rawKey));
    if (!apiKey) throw new UnauthorizedException("invalid_api_key");
    await this.repo.touchApiKeyLastUsed(apiKey.id, new Date().toISOString());
    request.apiKey = {
      id: apiKey.id,
      merchantId: apiKey.merchantId,
      scopes: apiKey.scopes
    } satisfies MerchantApiKeyContext;
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
