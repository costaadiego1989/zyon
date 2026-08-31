import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import type { MerchantApiKeyPublic } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toApiKeyPublic } from "./api-key.helpers.js";

@Injectable()
export class RevokeMerchantApiKeyUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string, apiKeyId: string): Promise<MerchantApiKeyPublic> {
    const revoked = await this.repo.revokeApiKey(merchantId, apiKeyId, new Date().toISOString());
    if (!revoked) throw new NotFoundException("merchant_api_key_not_found");
    return toApiKeyPublic(revoked);
  }
}
