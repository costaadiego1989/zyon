import { createHash } from "node:crypto";

interface ReceivingQuote {
  chainId: number;
  chain: string;
  evmNetwork: string;
  tokenAddress: string;
  destinationAddress: string;
  transfers?: Array<{ kind: string; destinationAddress: string }>;
}

/** Server-derived account classification. The full original quote remains immutable payment evidence. */
export function fiscalCryptoAccountFingerprint(quote: ReceivingQuote): string {
  const address = (value: string) => {
    if (!/^0x[0-9a-fA-F]{40}$/.test(value))
      throw new Error("fiscal_crypto_account_binding_required");
    return value.toLowerCase();
  };
  if (
    !Number.isSafeInteger(quote.chainId) ||
    quote.chainId <= 0 ||
    !quote.chain?.trim() ||
    !["testnet", "mainnet"].includes(quote.evmNetwork)
  )
    throw new Error("fiscal_crypto_account_binding_required");
  const receivers = (
    quote.transfers?.length
      ? quote.transfers
      : [{ kind: "merchant", destinationAddress: quote.destinationAddress }]
  )
    .map((row) => {
      if (!["merchant", "platform_fee"].includes(row.kind))
        throw new Error("fiscal_crypto_account_binding_required");
      return [row.kind, address(row.destinationAddress)];
    })
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return createHash("sha256")
    .update(
      JSON.stringify([
        "fiscal-evm-account-v1",
        quote.chainId,
        quote.chain.toLowerCase(),
        quote.evmNetwork,
        address(quote.tokenAddress),
        address(quote.destinationAddress),
        receivers,
      ])
    )
    .digest("hex");
}
