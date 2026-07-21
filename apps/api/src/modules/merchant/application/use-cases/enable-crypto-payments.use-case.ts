import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import { normalizeMerchantCryptoPayments } from "../../domain/services/merchant-crypto.validation.js";
import {
  MERCHANT_RULES_REPOSITORY,
  type MerchantRulesRepository,
} from "../../domain/ports/merchant-rules.repository.port.js";

export interface EnableCryptoPaymentsInput {
  merchantId: string;
  enabled: boolean;
  chain: "polygon" | "base";
  network: "mainnet" | "testnet";
  treasuryAddress: string;
  token?: "USDC";
}

@Injectable()
export class EnableCryptoPaymentsUseCase {
  constructor(
    @Inject(MERCHANT_RULES_REPOSITORY)
    private readonly rulesRepository: MerchantRulesRepository,
  ) {}

  async execute(input: EnableCryptoPaymentsInput): Promise<{ success: boolean }> {
    try {
      const cryptoPayments = normalizeMerchantCryptoPayments({
        enabled: input.enabled,
        chain: input.chain,
        network: input.network,
        treasuryAddress: input.treasuryAddress,
        token: input.token ?? "USDC",
        quoteTtlSeconds: 900,
      });
      await this.rulesRepository.updateRules(input.merchantId, { cryptoPayments });
      return { success: true };
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : "crypto_payments_invalid");
    }
  }
}
