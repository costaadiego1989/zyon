import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { decryptCommerceSecret } from "../../../commerce/infrastructure/commerce-secret-cipher.js";
import type { MelhorEnvioTokenResolver } from "../../domain/ports/melhor-envio-token-resolver.port.js";
import type { MelhorEnvioTokenRefresher } from "../../application/melhor-envio-token-refresher.js";

/** Refresh a token this many ms before it actually expires, so a token that is
 * valid now but about to lapse is renewed before the outbound carrier call. */
const EXPIRY_SKEW_MS = 120_000;

/**
 * Resolves the per-merchant Melhor Envio access token from the merchant record
 * (encrypted at rest via the commerce secret cipher). Falls back to the global
 * MELHOR_ENVIO_TOKEN env var only when the merchant has not connected its own
 * account — this keeps local/dev single-tenant testing working while giving
 * production correct per-tenant isolation.
 *
 * When a merchant's token is expired (or within the skew window) and a refresher
 * is wired, it attempts an OAuth refresh before degrading (ADR-005).
 */
export class PrismaMelhorEnvioTokenResolver implements MelhorEnvioTokenResolver {
  private readonly logger = new Logger(PrismaMelhorEnvioTokenResolver.name);

  constructor(
    private readonly prisma: PrismaClient,
    private readonly refresher?: MelhorEnvioTokenRefresher,
  ) {}

  async resolveToken(merchantId: string): Promise<string | undefined> {
    // The global MELHOR_ENVIO_TOKEN belongs to the platform owner. Using it for a
    // merchant that has not connected its own OAuth account would quote and label
    // freight against the wrong (owner's) account — a cross-tenant credential leak
    // with financial impact. Allow the fallback for local/dev single-tenant
    // testing only; in production a merchant without its own token gets no token
    // (carrier degrades to flat-rate / own delivery). See ADR-004.
    const envFallback =
      process.env.NODE_ENV !== "production"
        ? process.env.MELHOR_ENVIO_TOKEN?.trim() || undefined
        : undefined;

    if (!merchantId) return envFallback;

    let row:
      | { melhorEnvioAccessToken: string | null; melhorEnvioExpiresAt: Date | null }
      | null = null;
    try {
      row = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { melhorEnvioAccessToken: true, melhorEnvioExpiresAt: true }
      });
    } catch (error) {
      this.logger.warn(
        `melhor_envio.token_lookup_failed merchantId=${merchantId}: ${(error as Error).message}`
      );
      return envFallback;
    }

    const encrypted = row?.melhorEnvioAccessToken?.trim();
    if (!encrypted) {
      // Merchant has not connected its own account. Try a refresh in case a
      // refresh token exists without a usable access token, then fall back.
      const refreshed = await this.tryRefresh(merchantId);
      return refreshed ?? envFallback;
    }

    // Expired (or about to expire): refresh via the stored refresh_token before
    // degrading, so an active merchant never loses carrier quotes (ADR-005).
    const expiresAt = row?.melhorEnvioExpiresAt ? new Date(row.melhorEnvioExpiresAt).getTime() : null;
    const nearExpiry = expiresAt !== null && expiresAt - Date.now() < EXPIRY_SKEW_MS;
    if (nearExpiry) {
      this.logger.warn(`melhor_envio.token_expired_or_expiring merchantId=${merchantId}`);
      const refreshed = await this.tryRefresh(merchantId);
      return refreshed ?? envFallback;
    }

    try {
      const decrypted = decryptCommerceSecret(encrypted).trim();
      return decrypted || envFallback;
    } catch (error) {
      this.logger.warn(
        `melhor_envio.token_decrypt_failed merchantId=${merchantId}: ${(error as Error).message}`
      );
      return envFallback;
    }
  }

  private async tryRefresh(merchantId: string): Promise<string | undefined> {
    if (!this.refresher) return undefined;
    try {
      return await this.refresher.refresh(merchantId);
    } catch (error) {
      this.logger.warn(
        `melhor_envio.refresh_threw merchantId=${merchantId}: ${(error as Error).message}`
      );
      return undefined;
    }
  }
}
