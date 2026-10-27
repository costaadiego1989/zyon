import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { decryptErpSecret, encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";
import { ErpProviderError, readOmieResponse } from "../../infrastructure/adapters/erp-provider-error.js";

export interface ConnectOmieInput {
  merchantId: string;
  appKey: string;
  appSecret: string;
}

@Injectable()
export class ConnectOmieUseCase {
  constructor(
    @Inject(ERP_REPOSITORY) private readonly repo: ErpRepositoryPort
  ) {}

  async execute(input: ConnectOmieInput) {
    const appKey = typeof input.appKey === "string" ? input.appKey.trim() : "", appSecret = typeof input.appSecret === "string" ? input.appSecret.trim() : "";
    if (!appKey || !appSecret) throw new BadRequestException("omie_credentials_required");
    // Validate by calling Omie test endpoint
    const testRes = await fetch("https://app.omie.com.br/api/v1/geral/produtos/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ListarProdutos",
        app_key: appKey,
        app_secret: appSecret,
        param: [{ pagina: 1, registros_por_pagina: 1 }],
      }),
      signal: AbortSignal.timeout(20_000),
    });
    try { await readOmieResponse(testRes); }
    catch (error) { throw new BadRequestException(error instanceof ErpProviderError ? error.message : "omie_validation_failed"); }
    const previous = await this.repo.findByProvider(input.merchantId, "omie");
    if (previous?.accessTokenCipher && decryptErpSecret(previous.accessTokenCipher) !== appKey) throw new BadRequestException("omie_application_change_requires_disconnect");

    // Encrypt credentials
    const appKeyCipher = encryptErpSecret(appKey);
    const appSecretCipher = encryptErpSecret(appSecret);

    // Persist as ERP connection
    return this.repo.upsert(input.merchantId, "omie", {
      status: "connected",
      directionMode: previous?.directionMode ?? "bidirectional",
      accessTokenCipher: appKeyCipher,
      refreshTokenCipher: appSecretCipher,
      config: {},
    });
  }
}
