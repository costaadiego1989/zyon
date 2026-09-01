import { Logger } from "@nestjs/common";
import type { PrismaClient } from "@prisma/client";
import { decryptCommerceSecret } from "../../../commerce/infrastructure/commerce-secret-cipher.js";
import type { MelhorEnvioTokenResolver } from "../../domain/ports/melhor-envio-token-resolver.port.js";

/**
 * Resolves the per-merchant Melhor Envio access token from the merchant record
 * (encrypted at rest via the commerce secret cipher). Falls back to the global
 * MELHOR_ENVIO_TOKEN env var only when the merchant has not connected its own
 * account — this keeps local/dev single-tenant testing working while giving
 * production correct per-tenant isolation.
 */
export class PrismaMelhorEnvioTokenResolver implements MelhorEnvioTokenResolver {
  private readonly logger = new Logger(PrismaMelhorEnvioTokenResolver.name);

  constructor(private readonly prisma: PrismaClient) {}

  async resolveToken(merchantId: string): Promise<string | undefined> {
    const envFallback = process.env.MELHOR_ENVIO_TOKEN?.trim() || undefined;

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
      // Merchant has not connected its own account — use env fallback if present.
      return envFallback;
    }

    // Expired token: degrade to fallback (or undefined) rather than calling the
    // API with a dead credential.
    if (row?.melhorEnvioExpiresAt && new Date(row.melhorEnvioExpiresAt) < new Date()) {
      this.logger.warn(`melhor_envio.token_expired merchantId=${merchantId}`);
      return envFallback;
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
}
