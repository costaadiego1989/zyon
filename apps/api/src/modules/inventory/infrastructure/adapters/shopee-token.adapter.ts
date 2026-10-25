import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { ShopeeTokenPort } from "../../domain/ports/shopee-token.port.js";
import { decryptErpSecret, encryptErpSecret } from "./erp-secret-cipher.js";
import { refreshShopeeToken, shopeeShopId } from "./shopee-api.js";
@Injectable()
export class ShopeeTokenAdapter implements ShopeeTokenPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}
  async getValidAccessToken(merchantId: string, connectionId: string): Promise<string> {
    const where = { id: connectionId, merchantId, provider: "shopee", status: "connected" };
    const current = await this.prisma.erpConnection.findFirst({ where });
    if (!current?.accessTokenCipher) throw new Error("shopee_connection_missing");
    if (current.tokenExpiresAt && current.tokenExpiresAt.getTime() > Date.now() + 60000) return decryptErpSecret(current.accessTokenCipher);
    // Refresh tokens are single-use. Serialize refresh and reconnect writes per tenant's connection.
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${connectionId} AND merchant_id = ${merchantId} AND provider = 'shopee' FOR UPDATE`;
      const latest = await tx.erpConnection.findFirst({ where });
      if (!latest?.accessTokenCipher) throw new Error("shopee_connection_missing");
      if (latest.tokenExpiresAt && latest.tokenExpiresAt.getTime() > Date.now() + 60000) return decryptErpSecret(latest.accessTokenCipher);
      if (!latest.refreshTokenCipher) throw new Error("shopee_reauthorization_required");
      const config = latest.config && typeof latest.config === "object" && !Array.isArray(latest.config) ? latest.config : {};
      if (typeof config.shopeeRefreshExpiresAt === "string" && Date.parse(config.shopeeRefreshExpiresAt) <= Date.now()) throw new Error("shopee_reauthorization_required");
      const result = await refreshShopeeToken(decryptErpSecret(latest.refreshTokenCipher), shopeeShopId(config.shopeeShopId));
      await tx.erpConnection.update({ where: { id: latest.id }, data: {
        accessTokenCipher: encryptErpSecret(result.accessToken), refreshTokenCipher: encryptErpSecret(result.refreshToken), tokenExpiresAt: result.expiresAt,
        config: { ...config, shopeeRefreshExpiresAt: result.refreshExpiresAt.toISOString() },
      } });
      return result.accessToken;
    }, { maxWait: 5000, timeout: 30000 });
  }
}
