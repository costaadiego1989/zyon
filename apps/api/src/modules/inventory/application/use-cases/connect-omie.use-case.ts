import { Injectable, Inject, BadRequestException } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

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
    // Validate by calling Omie test endpoint
    const testRes = await fetch("https://app.omie.com.br/api/v1/geral/produtos/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        call: "ListarProdutos",
        app_key: input.appKey,
        app_secret: input.appSecret,
        param: [{ pagina: 1, registros_por_pagina: 1 }],
      }),
    });

    if (!testRes.ok) {
      throw new BadRequestException("omie_validation_failed");
    }

    const testData = await testRes.json();
    if (testData.status && testData.status !== "OK") {
      throw new BadRequestException(`omie_error:${testData.status}`);
    }

    // Encrypt credentials
    const appKeyCipher = encryptErpSecret(input.appKey);
    const appSecretCipher = encryptErpSecret(input.appSecret);

    // Persist as ERP connection
    return this.repo.upsert(input.merchantId, "omie", {
      status: "connected",
      accessTokenCipher: appKeyCipher,
      refreshTokenCipher: appSecretCipher,
      config: {},
    });
  }
}
