import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { INTEGRATIONS_REPOSITORY, type IntegrationsRepository } from "../../../domain/ports/integrations.repository.port.js";
import { CreateMerchantApiKeyUseCase } from "./create-merchant-api-key.use-case.js";

@Injectable()
export class RotateMerchantApiKeyUseCase {
  constructor(
    @Inject(INTEGRATIONS_REPOSITORY) private readonly repo: IntegrationsRepository,
    private readonly createApiKey: CreateMerchantApiKeyUseCase,
  ) {}

  async execute(input: {
    merchantId: string;
    apiKeyId: string;
    overlapSeconds?: number;
  }) {
    const existing = await this.repo.getApiKey(input.merchantId, input.apiKeyId);
    if (!existing || existing.revokedAt) {
      throw new NotFoundException("merchant_api_key_not_found");
    }

    const now = new Date().toISOString();
    if (existing.expiresAt && existing.expiresAt <= now) {
      throw new NotFoundException("merchant_api_key_not_found");
    }
    const overlapSeconds = Math.max(
      0,
      Math.min(input.overlapSeconds ?? 300, 86_400),
    );
    const requestedOverlapEnd = new Date(
      Date.now() + overlapSeconds * 1000,
    ).toISOString();
    const oldKeyExpiresAt = existing.expiresAt
      && existing.expiresAt < requestedOverlapEnd
      ? existing.expiresAt
      : requestedOverlapEnd;

    const rotated = await this.createApiKey.execute({
      merchantId: input.merchantId,
      name: `${existing.name} (rotated)`,
      scopes: existing.scopes.map((scope) =>
        scope === "orders:tracking:write" ? "tracking:write" : scope),
      environment: existing.environment,
      expiresAt: existing.expiresAt,
      allowedCidrs: existing.allowedCidrs,
      rotatedFromId: existing.id,
    });
    const updatedPrevious = await this.repo.setApiKeyExpiry(
      input.merchantId,
      input.apiKeyId,
      oldKeyExpiresAt,
    );
    if (!updatedPrevious) {
      await this.repo.revokeApiKey(
        input.merchantId,
        rotated.api_key.id,
        new Date().toISOString(),
      );
      throw new NotFoundException("merchant_api_key_not_found");
    }

    return {
      ...rotated,
      previous_api_key_id: existing.id,
      previous_key_expires_at: oldKeyExpiresAt,
    };
  }
}
