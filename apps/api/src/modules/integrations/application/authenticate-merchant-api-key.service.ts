import {
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiKeyAccessPolicy } from "../domain/api-key-access-policy.js";
import { ApiKeyService } from "../domain/api-key.service.js";
import type { MerchantApiKeyContext } from "../domain/integrations.types.js";
import {
  INTEGRATIONS_REPOSITORY,
  type IntegrationsRepository,
} from "../domain/ports/integrations.repository.port.js";

@Injectable()
export class AuthenticateMerchantApiKeyService {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY)
    private readonly repository: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService,
    private readonly accessPolicy: ApiKeyAccessPolicy,
  ) {}

  async execute(rawKey: string, clientIp?: string): Promise<MerchantApiKeyContext> {
    const keyEnvironment = this.apiKeys.environment(rawKey);
    if (!keyEnvironment) {
      throw new UnauthorizedException("invalid_api_key");
    }

    const now = new Date().toISOString();
    const apiKey = await this.repository.findActiveApiKeyByHash(
      this.apiKeys.hash(rawKey),
      now,
    );
    if (!apiKey) {
      throw new UnauthorizedException("invalid_api_key");
    }
    if (keyEnvironment !== "legacy" && keyEnvironment !== apiKey.environment) {
      throw new UnauthorizedException("invalid_api_key_environment");
    }

    this.accessPolicy.assertClientIpAllowed(apiKey.allowedCidrs, clientIp);
    await this.repository.touchApiKeyLastUsed(apiKey.id, now);

    return {
      id: apiKey.id,
      merchantId: apiKey.merchantId,
      scopes: apiKey.scopes,
      environment: apiKey.environment,
      allowedCidrs: apiKey.allowedCidrs,
      expiresAt: apiKey.expiresAt,
    };
  }
}
