import { Inject, Injectable } from "@nestjs/common";
import { activateMerchantStellarAccount } from "@zyon/payments-stellar";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../domain/ports/merchant-repository.port.js";

export interface EnableCryptoPaymentsInput {
  merchantId: string;
  merchantPublicKey: string;
  merchantSecretKey: string;
}

@Injectable()
export class EnableCryptoPaymentsUseCase {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository) {}

  async execute(input: EnableCryptoPaymentsInput): Promise<{ success: boolean }> {
    const platformSecretKey = process.env["STELLAR_PLATFORM_SECRET"];
    if (!platformSecretKey) {
      throw new Error("STELLAR_PLATFORM_SECRET not configured");
    }

    await activateMerchantStellarAccount({
      merchantPublicKey: input.merchantPublicKey,
      merchantSecretKey: input.merchantSecretKey,
      platformSecretKey,
    });

    await this.repository.enableCrypto(input.merchantId, input.merchantPublicKey);

    return { success: true };
  }
}
