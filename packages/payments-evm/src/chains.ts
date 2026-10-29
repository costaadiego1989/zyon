import type { Chain } from "viem";
import { mainnet, polygon, bsc } from "viem/chains";

/**
 * EVM chains supported out of the box. Adding a chain = adding it here + to
 * CHAINS, CHAIN_BY_ID and any token allow-list below.
 */
export type SupportedChainId =
  | typeof mainnet.id
  | typeof polygon.id
  | typeof bsc.id;

export const SUPPORTED_CHAIN_IDS: ReadonlyArray<SupportedChainId> = [
  mainnet.id,
  polygon.id,
  bsc.id,
] as const;

export const CHAINS: ReadonlyArray<Chain> = [mainnet, polygon, bsc];

export function getChain(chainId: number): Chain {
  const chain = CHAINS.find((c) => c.id === chainId);
  if (!chain) {
    throw new Error(`unsupported_chain_id:${chainId}`);
  }
  return chain;
}

export function isSupportedChainId(chainId: number): chainId is SupportedChainId {
  return SUPPORTED_CHAIN_IDS.includes(chainId as SupportedChainId);
}

/**
 * Well-known ERC-20 token contracts per chain.
 * Only the tokens we explicitly whitelist are accepted by `createPaymentIntent`.
 */
export interface Erc20Token {
  symbol: "USDT" | "USDC";
  decimals: number;
  /** lowercase checksummed address */
  address: `0x${string}`;
}

export const ERC20_TOKENS: Readonly<Record<SupportedChainId, ReadonlyArray<Erc20Token>>> = {
  [mainnet.id]: [
    // USDT (Tether) on Ethereum
    { symbol: "USDT", decimals: 6, address: "0xdAC17F958D2ee523a2206206994597C13D831ec7" },
    // USDC (Circle) on Ethereum
    { symbol: "USDC", decimals: 6, address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" },
  ],
  [polygon.id]: [
    // USDT on Polygon
    { symbol: "USDT", decimals: 6, address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F" },
    // USDC (native) on Polygon
    { symbol: "USDC", decimals: 6, address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359" },
  ],
  [bsc.id]: [
    // USDT on BSC (BEP-20, ERC-20 compatible)
    { symbol: "USDT", decimals: 18, address: "0x55d398326f99059fF775485246999027B3197955" },
    // USDC on BSC
    { symbol: "USDC", decimals: 18, address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d" },
  ],
} as const;

/** Resolve an ERC-20 token descriptor by chain + symbol. Throws if not whitelisted. */
export function getErc20Token(chainId: number, symbol: Erc20Token["symbol"]): Erc20Token {
  if (!isSupportedChainId(chainId)) {
    throw new Error(`unsupported_chain_id:${chainId}`);
  }
  const token = ERC20_TOKENS[chainId].find((t) => t.symbol === symbol);
  if (!token) {
    throw new Error(`unsupported_token:${symbol}_on_chain:${chainId}`);
  }
  return token;
}
