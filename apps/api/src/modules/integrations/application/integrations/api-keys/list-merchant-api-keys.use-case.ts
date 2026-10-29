import { Inject, Injectable } from "@nestjs/common";
import type { MerchantApiKeyPublic } from "../../../domain/integrations.types.js";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { toApiKeyPublic } from "./api-key.helpers.js";

@Injectable()
export class ListMerchantApiKeysUseCase {
  constructor(@Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository) {}

  async execute(merchantId: string): Promise<MerchantApiKeyPublic[]> {
    return (await this.repo.listApiKeys(merchantId)).map(toApiKeyPublic);
  }
}
