import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { melhorEnvioBaseUrl, MELHOR_ENVIO_USER_AGENT } from "../infrastructure/melhor-envio-config.js";
import {
  encryptCommerceSecret,
  decryptCommerceSecret,
} from "../../commerce/infrastructure/commerce-secret-cipher.js";

/**
 * Exchanges a merchant's stored Melhor Envio refresh_token for a fresh access
 * token (grant_type=refresh_token), persists the rotated credentials encrypted,
 * and returns the new access token. Scoped strictly to the calling merchant —
 * never touches another tenant's credentials (ADR-004, ADR-005).
 *
 * On any failure it returns undefined so the caller degrades to flat-rate /
 * own delivery rather than calling the carrier with a dead credential.
 */
export class MelhorEnvioTokenRefresher {
  private readonly logger = new Logger(MelhorEnvioTokenRefresher.name);

  constructor(private readonly prisma: PrismaClient) {}

  private get baseUrl(): string {
    return melhorEnvioBaseUrl();
  }

  async refresh(merchantId: string): Promise<string | undefined> {
    if (!merchantId) return undefined;

    const clientId = process.env.MELHOR_ENVIO_CLIENT_ID?.trim();
    const clientSecret = process.env.MELHOR_ENVIO_SECRET?.trim();
    if (!clientId || !clientSecret) {
      this.logger.warn("melhor_envio.refresh_skipped_no_client_credentials");
      return undefined;
    }

    let row: { melhorEnvioRefreshToken: string | null } | null = null;
    try {
      row = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { melhorEnvioRefreshToken: true },
      });
    } catch (error) {
      this.logger.warn(
        `melhor_envio.refresh_lookup_failed merchantId=${merchantId}: ${(error as Error).message}`,
      );
      return undefined;
    }

    const encryptedRefresh = row?.melhorEnvioRefreshToken?.trim();
    if (!encryptedRefresh) return undefined;

    let refreshToken: string;
    try {
      refreshToken = decryptCommerceSecret(encryptedRefresh).trim();
    } catch (error) {
      this.logger.warn(
        `melhor_envio.refresh_decrypt_failed merchantId=${merchantId}: ${(error as Error).message}`,
      );
      return undefined;
    }
    if (!refreshToken) return undefined;

    let tokenRes: Response;
    try {
      tokenRes = await fetch(`${this.baseUrl}/oauth/token`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", "User-Agent": MELHOR_ENVIO_USER_AGENT },
        signal: AbortSignal.timeout(15000),
        body: JSON.stringify({
          grant_type: "refresh_token",
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
        }),
      });
    } catch (error) {
      this.logger.warn(
        `melhor_envio.refresh_network_failed merchantId=${merchantId}: ${(error as Error).message}`,
      );
      return undefined;
    }

    if (!tokenRes.ok) {
      const body = await tokenRes.text().catch(() => "");
      this.logger.warn(
        `melhor_envio.refresh_rejected merchantId=${merchantId} status=${tokenRes.status} body=${body.slice(0, 200)}`,
      );
      return undefined;
    }

    const tokenData = (await tokenRes.json().catch(() => null)) as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
    } | null;

    const newAccess = tokenData?.access_token?.trim();
    if (!newAccess) {
      this.logger.warn(`melhor_envio.refresh_no_access_token merchantId=${merchantId}`);
      return undefined;
    }

    const expiresAt = new Date(Date.now() + (tokenData?.expires_in ?? 2592000) * 1000);
    // Melhor Envio rotates the refresh token; persist the new one when present,
    // otherwise keep the current refresh token so future refreshes still work.
    const data: {
      melhorEnvioAccessToken: string;
      melhorEnvioExpiresAt: Date;
      melhorEnvioRefreshToken?: string;
    } = {
      melhorEnvioAccessToken: encryptCommerceSecret(newAccess),
      melhorEnvioExpiresAt: expiresAt,
    };
    if (tokenData?.refresh_token?.trim()) {
      data.melhorEnvioRefreshToken = encryptCommerceSecret(tokenData.refresh_token.trim());
    }

    try {
      await this.prisma.merchant.update({ where: { id: merchantId }, data });
    } catch (error) {
      this.logger.warn(
        `melhor_envio.refresh_persist_failed merchantId=${merchantId}: ${(error as Error).message}`,
      );
      // The token itself is valid even if persistence failed; return it so this
      // request succeeds. A later request will retry the refresh.
      return newAccess;
    }

    this.logger.log("melhor_envio.token_refreshed", {
      merchantId,
      expiresAt: expiresAt.toISOString(),
    });
    return newAccess;
  }
}
