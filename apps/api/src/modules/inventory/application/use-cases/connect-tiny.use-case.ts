import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { ERP_REPOSITORY, type ErpRepositoryPort } from "../../domain/ports/erp-repository.port.js";
import { encryptErpSecret } from "../../infrastructure/adapters/erp-secret-cipher.js";

@Injectable()
export class ConnectTinyUseCase {
  constructor(@Inject(ERP_REPOSITORY) private readonly repo: ErpRepositoryPort) {}

  async execute(input: { merchantId: string; apiToken: string }) {
    const token = input.apiToken.trim();
    if (!token) throw new BadRequestException("tiny_api_token_required");

    // The official Tiny/Olist API uses the merchant API token. Code 20 means a
    // valid account with no matching product; code 2 means an invalid token.
    const response = await fetch("https://api.tiny.com.br/api2/produtos.pesquisa.php", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token, formato: "JSON", pesquisa: "a" }).toString(),
    });
    if (!response.ok) throw new BadRequestException("tiny_validation_failed");
    const body = await response.json() as any;
    const result = body.retorno ?? body;
    if (result.status !== "OK" && Number(result.codigo_erro) !== 20) throw new BadRequestException("tiny_validation_failed");

    return this.repo.upsert(input.merchantId, "tiny", {
      status: "connected",
      directionMode: "bidirectional",
      accessTokenCipher: encryptErpSecret(token),
      config: { auth: "api_token" },
    });
  }
}
