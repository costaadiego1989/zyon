export type CryptoTransferQuote = {
  kind: "merchant" | "platform_fee";
  destinationAddress: string;
  amountAtomic: string;
  amountDisplay: string;
};

export type CryptoBuyerFacingQuote = {
  chainId: number;
  chain: string;
  evmNetwork: string;
  chainLabel: string;
  tokenAddress: string;
  tokenSymbol: string;
  amountAtomic: string;
  amountDisplay: string;
  destinationAddress: string;
  transfers?: CryptoTransferQuote[];
  quoteExpiresAt: string;
  walletConnectProjectId?: string;
};

export type CryptoPaymentState = {
  intentId: string;
  quote: CryptoBuyerFacingQuote;
  amountCents?: number;
  currency?: string;
};
