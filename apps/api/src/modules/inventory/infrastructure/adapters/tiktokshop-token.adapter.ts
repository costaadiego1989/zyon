import { Inject, Injectable } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { PRISMA_CLIENT } from "../../../../shared/persistence/persistence.module.js";
import type { TikTokShopTokenPort } from "../../domain/ports/tiktokshop-token.port.js";
import { decryptErpSecret, encryptErpSecret } from "./erp-secret-cipher.js";
import { refreshTikTokShopToken } from "./tiktokshop-api.js";

@Injectable()
export class TikTokShopTokenAdapter implements TikTokShopTokenPort {
  constructor(@Inject(PRISMA_CLIENT) private readonly prisma: PrismaClient) {}

  async getValidAccessToken(merchantId: string, connectionId: string): Promise<string> {
    const where = { id: connectionId, merchantId, provider: "tiktokshop" };
    const current = await this.prisma.erpConnection.findFirst({ where });
    if (!current?.accessTokenCipher) throw new Error("tiktokshop_connection_missing");
    if (current.tokenExpiresAt && current.tokenExpiresAt.getTime() > Date.now() + 60000) {
      return decryptErpSecret(current.accessTokenCipher);
    }
    // Lock the connection row so renewals, reconnects and config writes serialize.
    return this.prisma.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM erp_connections WHERE id = ${connectionId} AND merchant_id = ${merchantId} AND provider = 'tiktokshop' FOR UPDATE`;
      const latest = await tx.erpConnection.findFirst({ where });
      if (!latest?.accessTokenCipher) throw new Error("tiktokshop_connection_missing");
      if (latest.tokenExpiresAt && latest.tokenExpiresAt.getTime() > Date.now() + 60000) return decryptErpSecret(latest.accessTokenCipher);
      if (!latest.refreshTokenCipher) throw new Error("tiktokshop_reauthorization_required");
      const config = latest.config && typeof latest.config === "object" && !Array.isArray(latest.config) ? latest.config : {};
      if (typeof config.tiktokRefreshExpiresAt === "string" && Date.parse(config.tiktokRefreshExpiresAt) <= Date.now()) {
        throw new Error("tiktokshop_reauthorization_required");
      }
      const tokens = await refreshTikTokShopToken(decryptErpSecret(latest.refreshTokenCipher));
      await tx.erpConnection.update({ where: { id: latest.id }, data: {
        accessTokenCipher: encryptErpSecret(tokens.accessToken), refreshTokenCipher: encryptErpSecret(tokens.refreshToken),
        tokenExpiresAt: tokens.expiresAt,
        config: { ...config, tiktokRefreshExpiresAt: tokens.refreshExpiresAt.toISOString() },
      } });
      return tokens.accessToken;
    }, { maxWait: 5000, timeout: 30000 });
  }
}
