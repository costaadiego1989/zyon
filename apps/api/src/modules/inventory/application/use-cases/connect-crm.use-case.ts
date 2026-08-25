import { Injectable, Inject } from "@nestjs/common";
import { CRM_CONNECTION_REPOSITORY, type CrmConnectionRepositoryPort } from "../../domain/ports/crm-connection-repository.port.js";
import { encryptCrmSecret } from "../../infrastructure/adapters/crm-secret-cipher.js";

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
    @Inject(CRM_CONNECTION_REPOSITORY) private readonly repo: CrmConnectionRepositoryPort
  ) {}

  async execute(input: ConnectCrmInput) {
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
