import type { MerchantCryptoPayments } from "@aacp/shared-types";

const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;

export function normalizeMerchantCryptoPayments(
  input: MerchantCryptoPayments | undefined
): MerchantCryptoPayments | undefined {
  if (!input) return undefined;
  if (!input.enabled) {
    return { ...input, enabled: false };
  }
  const treasury = input.treasuryAddress?.trim() ?? "";
  if (!EVM_ADDRESS.test(treasury)) {
    throw new Error("crypto_treasury_address_invalid");
  }
  const brlPerUsdc = input.brlPerUsdc;
  if (brlPerUsdc == null || !Number.isFinite(brlPerUsdc) || brlPerUsdc <= 0) {
    throw new Error("crypto_brl_per_usdc_required");
  }
  const quoteTtlSeconds = input.quoteTtlSeconds ?? 900;
  if (quoteTtlSeconds < 60 || quoteTtlSeconds > 3600) {
    throw new Error("crypto_quote_ttl_invalid");
  }
  if (input.token !== "USDC") {
    throw new Error("crypto_token_unsupported");
  }
  if (input.chain !== "polygon" && input.chain !== "base") {
    throw new Error("crypto_chain_unsupported");
  }
  if (input.network !== "mainnet" && input.network !== "testnet") {
    throw new Error("crypto_network_unsupported");
  }
  return {
    enabled: true,
    chain: input.chain,
    network: input.network,
    treasuryAddress: treasury,
    token: "USDC",
    quoteTtlSeconds,
    brlPerUsdc
  };
}

export function isCryptoPaymentsEnabled(config?: MerchantCryptoPayments): boolean {
  return config?.enabled === true && Boolean(config.treasuryAddress?.trim());
}
