import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { activateMerchantStellarAccount } from "@zyon/payments-stellar";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../domain/ports/merchant-repository.port.js";
import { STELLAR_CONFIG, type StellarConfig } from "../../domain/services/stellar-config.js";

export interface EnableCryptoPaymentsInput {
  merchantId: string;
  merchantPublicKey: string;
  merchantSecretKey: string;
}

/**
 * MERC-C1: StellarConfig is injected — validated at module startup.
 * If crypto is not configured, returns a clear 400 instead of crashing at runtime.
 */
@Injectable()
export class EnableCryptoPaymentsUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository,
    @Inject(STELLAR_CONFIG) private readonly stellarConfig: StellarConfig,
  ) {}

  async execute(input: EnableCryptoPaymentsInput): Promise<{ success: boolean }> {
    if (!this.stellarConfig.enabled) {
      throw new BadRequestException("crypto_payments_not_configured");
    }

    await activateMerchantStellarAccount({
      merchantPublicKey: input.merchantPublicKey,
      merchantSecretKey: input.merchantSecretKey,
      platformSecretKey: this.stellarConfig.platformSecretKey,
    });

    await this.repository.enableCrypto(input.merchantId, input.merchantPublicKey);

    return { success: true };
  }
}
