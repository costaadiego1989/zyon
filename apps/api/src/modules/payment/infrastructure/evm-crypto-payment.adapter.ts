import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { MerchantCryptoPayments } from "@zyon/shared-types";
import { MERCHANT_REPOSITORY, type MerchantRepository } from "../../merchant/domain/ports/merchant-repository.port.js";
import { isCryptoPaymentsEnabled } from "../../merchant/domain/services/merchant-crypto.validation.js";
import type {
  CreateProviderPaymentInput,
  CreateProviderPaymentOutput,
  PaymentProviderPort
} from "../domain/ports/payment-provider.port.js";
import {
  evmChainId,
  evmChainLabel,
  isCryptoQuoteEnabled,
  quoteExpiresAt,
  usdcContractAddress,
  walletConnectProjectId,
  type CryptoBuyerFacing
} from "./evm-crypto.constants.js";
import { quoteUsdcFromBrlCents } from "./evm-crypto-quote.service.js";

@Injectable()
export class EvmCryptoPaymentAdapter implements PaymentProviderPort {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository) {}

  async createPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> {
    if (input.method !== "crypto") {
      throw new BadRequestException("evm_crypto_method_required");
    }
    if (!isCryptoQuoteEnabled()) {
      throw new BadRequestException("crypto_payments_disabled");
    }

    const rules = await this.merchants.getRules(input.merchantId);
    const config = rules.cryptoPayments;
    if (!isCryptoPaymentsEnabled(config)) {
      throw new BadRequestException("crypto_payments_not_enabled_for_merchant");
    }

    const quote = buildCryptoQuote(input.amountCents, config!, input.intentId);
    const providerPaymentId = `crypto_${input.intentId}`;

    return {
      providerPaymentId,
      status: "requires_action",
      buyerFacingPayload: quote
    };
  }
}

export function buildCryptoQuote(
  amountCents: number,
  config: MerchantCryptoPayments,
  intentId?: string
): CryptoBuyerFacing {
  const brlPerUsdc = config.brlPerUsdc ?? 0;
  const { amountAtomic, amountDisplay } = quoteUsdcFromBrlCents(amountCents, brlPerUsdc, intentId);
  const ttl = config.quoteTtlSeconds ?? 900;
  const chain = config.chain;
  const network = config.network;

  return {
    chainId: evmChainId(chain, network),
    chain,
    evmNetwork: network,
    chainLabel: evmChainLabel(chain),
    tokenAddress: usdcContractAddress(chain, network),
    tokenSymbol: "USDC",
    amountAtomic,
    amountDisplay,
    destinationAddress: config.treasuryAddress,
    quoteExpiresAt: quoteExpiresAt(ttl),
    walletConnectProjectId: walletConnectProjectId()
  };
}
