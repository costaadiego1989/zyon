import { BadRequestException, Inject, Injectable } from "@nestjs/common";
import type { MerchantCryptoPayments } from "@zyon/shared-types";
import { isAddress } from "viem";
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
  type CryptoBuyerFacing,
  type CryptoTransferQuote
} from "./evm-crypto.constants.js";
import { quoteUsdcFromBrlCents } from "./evm-crypto-quote.service.js";

@Injectable()
export class EvmCryptoPaymentAdapter implements PaymentProviderPort {
  constructor(@Inject(MERCHANT_REPOSITORY) private readonly merchants: MerchantRepository) {}

  // Quote construction has no external financial effect; retry before its first
  // persistence cannot duplicate an on-chain transfer.
  async recoverPayment(input: CreateProviderPaymentInput): Promise<CreateProviderPaymentOutput> { return this.createPayment(input); }

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

    const quote = buildCryptoQuote(input.amountCents, config!, input.intentId, input.platformFeeCents ?? 0);
    const providerPaymentId = `crypto_${input.intentId}`;

    return {
      providerPaymentId,
      status: "requires_action",
      buyerFacingPayload: quote
    };
  }

  async refundPayment(_input: { merchantId: string; providerPaymentId: string; amountCents: number; reason?: string }) {
    return { refundId: "manual", status: "manual_required" as const };
  }
}

export function buildCryptoQuote(
  amountCents: number,
  config: MerchantCryptoPayments,
  intentId?: string,
  platformFeeCents = 0
): CryptoBuyerFacing {
  const brlPerUsdc = config.brlPerUsdc ?? 0;
  const feeCents = Math.max(0, Math.min(Math.trunc(platformFeeCents), Math.trunc(amountCents)));
  const merchantCents = amountCents - feeCents;
  const total = quoteUsdcFromBrlCents(amountCents, brlPerUsdc, intentId);
  const merchant = quoteUsdcFromBrlCents(merchantCents, brlPerUsdc, intentId ? `${intentId}_merchant` : undefined);
  const transfers: CryptoTransferQuote[] = [
    {
      kind: "merchant",
      destinationAddress: config.treasuryAddress,
      amountAtomic: merchant.amountAtomic,
      amountDisplay: merchant.amountDisplay,
    }
  ];
  const feeTreasury = process.env.ZYON_CRYPTO_TREASURY_ADDRESS?.trim();
  if (feeCents > 0) {
    if (!feeTreasury) {
      throw new Error("zyon_crypto_treasury_required");
    }
    if (!isAddress(feeTreasury)) {
      throw new Error("zyon_crypto_treasury_invalid");
    }
    const fee = quoteUsdcFromBrlCents(feeCents, brlPerUsdc, intentId ? `${intentId}_platform_fee` : undefined);
    transfers.push({
      kind: "platform_fee",
      destinationAddress: feeTreasury,
      amountAtomic: fee.amountAtomic,
      amountDisplay: fee.amountDisplay,
    });
  }
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
    amountAtomic: total.amountAtomic,
    amountDisplay: total.amountDisplay,
    destinationAddress: config.treasuryAddress,
    transfers,
    quoteExpiresAt: quoteExpiresAt(ttl),
    walletConnectProjectId: walletConnectProjectId()
  };
}
