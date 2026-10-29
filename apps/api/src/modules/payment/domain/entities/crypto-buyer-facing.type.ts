export type CryptoTransferQuote = {
  kind: "merchant" | "platform_fee";
  destinationAddress: string;
  amountAtomic: string;
  amountDisplay: string;
};

export type CryptoBuyerFacing = {
  chainId: number;
  chain: string;
  evmNetwork: string;
  chainLabel: string;
  tokenAddress: string;
  tokenSymbol: "USDC";
  amountAtomic: string;
  amountDisplay: string;
  destinationAddress: string;
  transfers?: CryptoTransferQuote[];
  quoteExpiresAt: string;
  walletConnectProjectId?: string;
};
