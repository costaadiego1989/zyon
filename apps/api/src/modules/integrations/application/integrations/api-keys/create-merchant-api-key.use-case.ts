import {
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { ApiKeyService } from "../../../domain/api-key.service.js";
import { ApiKeyAccessPolicy } from "../../../domain/api-key-access-policy.js";
import {
  DEFAULT_MERCHANT_API_KEY_SCOPES,
  type MerchantApiKeyEnvironment,
  type MerchantApiKeyScope,
} from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { sanitizeName } from "../shared.js";
import { toApiKeyPublic, sanitizeScopes, parseFutureExpiry } from "./api-key.helpers.js";

@Injectable()
export class CreateMerchantApiKeyUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly apiKeys: ApiKeyService,
    private readonly accessPolicy: ApiKeyAccessPolicy,
  ) {}

  async execute(input: {
    merchantId: string;
    name?: string;
    scopes?: MerchantApiKeyScope[];
    environment?: MerchantApiKeyEnvironment;
    expiresAt?: string;
    allowedCidrs?: string[];
    rotatedFromId?: string;
  }) {
    const environment = input.environment ?? "test";
    const generated = this.apiKeys.generate(environment);
    const now = new Date().toISOString();
    const scopes = sanitizeScopes(input.scopes ?? DEFAULT_MERCHANT_API_KEY_SCOPES);
    const apiKey = await this.repo.createApiKey({
      id: `mak_${randomUUID()}`,
      merchantId: input.merchantId,
      name: sanitizeName(input.name, "Backend integration"),
      keyHash: generated.keyHash,
      keyPrefix: generated.keyPrefix,
      scopes,
      environment,
      allowedCidrs: this.accessPolicy.normalizeCidrs(input.allowedCidrs),
      createdAt: now,
      expiresAt: parseFutureExpiry(input.expiresAt, now),
      rotatedFromId: input.rotatedFromId,
    });

    return {
      api_key: toApiKeyPublic(apiKey),
      secret_key: generated.rawKey
    };
  }
}
