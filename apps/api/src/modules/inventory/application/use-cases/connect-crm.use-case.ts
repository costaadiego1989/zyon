import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { encryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";
import { CrmAdapterFactory } from "../../infrastructure/adapters/crm-adapter.factory.js";

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
    // Verify the token actually works against the provider before persisting a
    // "connected" status — otherwise a wrong token would look connected but
    // silently sync nothing (false positive).
    const adapter = this.adapters.create({
      provider: input.provider,
      accessToken: input.accessToken,
      refreshToken: input.refreshToken,
    });
    const valid = await adapter.validateCredentials();
    if (!valid) {
      throw new BadRequestException("crm_credentials_invalid");
    }

    const accessTokenCipher = encryptCrmSecret(input.accessToken);
    const refreshTokenCipher = input.refreshToken ? encryptCrmSecret(input.refreshToken) : undefined;

    return this.repo.upsert(input.merchantId, input.provider, {
      status: "connected",
      accessTokenCipher,
      refreshTokenCipher,
      config: input.config,
    });
  }
}
