import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { isAddress } from "viem";
import {
  MERCHANT_REPOSITORY,
  type MerchantRepository
} from "../../domain/ports/merchant-repository.port.js";
import { EVM_PAYMENTS_CONFIG, type EvmPaymentsConfig } from "../../domain/services/evm-payments-config.js";

export interface EnableCryptoPaymentsInput {
  merchantId: string;
  /** EIP-55 checksummed address (0x...) the merchant controls. */
  merchantAddress: `0x${string}`;
}

/**
 * Enables EVM-based crypto payments for a merchant.
 *
 * Validates that the provided merchant address is a valid EVM address and
 * then marks the merchant as crypto-enabled. Per-order payment intents are
 * built later via @zyon/payments-evm's createPaymentIntent when checkout
 * finalises.
 */
@Injectable()
export class EnableCryptoPaymentsUseCase {
  constructor(
    @Inject(MERCHANT_REPOSITORY) private readonly repository: MerchantRepository,
    @Inject(EVM_PAYMENTS_CONFIG) private readonly config: EvmPaymentsConfig,
  ) {}

  async execute(input: EnableCryptoPaymentsInput): Promise<{ success: boolean }> {
    if (!this.config.enabled) {
      throw new BadRequestException("crypto_payments_not_configured");
    }

    if (!isAddress(input.merchantAddress)) {
      throw new BadRequestException("invalid_merchant_address");
    }

    await this.repository.enableCrypto(input.merchantId, input.merchantAddress);

    return { success: true };
  }
}
