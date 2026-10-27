import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { encryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";
import { normalizeCrmConfig } from "../../infrastructure/adapters/crm-provider-config.js";
import { publicCrmConnection } from "../../domain/ports/crm-connection-repository.port.js";

export interface ConnectCrmInput {
  merchantId: string;
  provider: string;
  accessToken: string;
  refreshToken?: string;
  config?: Record<string, unknown>;
}

@Injectable()
export class ConnectCrmUseCase {
  constructor(
    @Inject(CRM_CONNECTION_REPOSITORY) private readonly repo: CrmConnectionRepositoryPort,
    private readonly adapters: CrmAdapterFactory,
  ) {}

  async execute(input: ConnectCrmInput) {
    const provider = input.provider.trim().toLowerCase();
    if (provider === "hubspot") throw new BadRequestException("crm_oauth_required");
    const config = normalizeCrmConfig(provider, input.config);
    if (provider === "mailchimp" && !/-(us\d+)$/.test(input.accessToken)) {
      throw new BadRequestException("crm_mailchimp_key_invalid");
    }
    // Verify the token actually works against the provider before persisting a
    // "connected" status — otherwise a wrong token would look connected but
    // silently sync nothing (false positive).
    const adapter = this.adapters.create({
      provider,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
      config,
    });
    const valid = await adapter.validateCredentials();
    if (!valid) {
      throw new BadRequestException("crm_credentials_invalid");
    }

    const accessTokenCipher = encryptCrmSecret(input.accessToken);
    const refreshTokenCipher = input.refreshToken ? encryptCrmSecret(input.refreshToken) : undefined;

    const row = await this.repo.upsert(input.merchantId, provider, {
      status: "connected",
      accessTokenCipher,
      refreshTokenCipher,
      config,
    });
    return publicCrmConnection(row);
  }
}
