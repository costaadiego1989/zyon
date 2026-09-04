import type { MerchantCryptoPayments } from "@zyon/shared-types";

export type EvmChain = MerchantCryptoPayments["chain"];
export type EvmNetwork = MerchantCryptoPayments["network"];

export const ERC20_TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export const USDC_DECIMALS = 6;

const USDC_BY_CHAIN_NETWORK: Record<EvmChain, Record<EvmNetwork, `0x${string}`>> = {
  polygon: {
    testnet: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    mainnet: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359"
  },
  base: {
    testnet: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    mainnet: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"
  }
};

const CHAIN_ID: Record<EvmChain, Record<EvmNetwork, number>> = {
  polygon: { testnet: 80002, mainnet: 137 },
  base: { testnet: 84532, mainnet: 8453 }
};

const CHAIN_LABEL: Record<EvmChain, string> = {
  polygon: "Polygon",
  base: "Base"
};

export function usdcContractAddress(chain: EvmChain, network: EvmNetwork): `0x${string}` {
  return USDC_BY_CHAIN_NETWORK[chain][network];
}

export function evmChainId(chain: EvmChain, network: EvmNetwork): number {
  return CHAIN_ID[chain][network];
}

export function evmChainLabel(chain: EvmChain): string {
  return CHAIN_LABEL[chain];
}

export function resolveRpcUrl(chain: EvmChain, network: EvmNetwork): string | undefined {
  if (chain === "polygon") {
    return network === "testnet"
      ? process.env.POLYGON_AMOY_RPC_URL?.trim()
      : process.env.POLYGON_RPC_URL?.trim();
  }
  return network === "testnet"
    ? process.env.BASE_SEPOLIA_RPC_URL?.trim()
    : process.env.BASE_RPC_URL?.trim();
}

function envRpcPrefix(chain: EvmChain, network: EvmNetwork): string {
  return `${chain.toUpperCase()}_${network === "testnet" ? "TESTNET" : "MAINNET"}`;
}

/**
 * Ordered RPC URL list for fallback: Alchemy → Infura → Public.
 * First available URL that responds wins; rate-limited URLs are skipped.
 */
export function resolveRpcUrls(chain: EvmChain, network: EvmNetwork): string[] {
  const prefix = envRpcPrefix(chain, network);
  const urls: string[] = [];
  const alchemy = process.env[`${prefix}_ALCHEMY_RPC_URL`]?.trim();
  if (alchemy) urls.push(alchemy);
  const infura = process.env[`${prefix}_INFURA_RPC_URL`]?.trim();
  if (infura) urls.push(infura);
  const pub = resolveRpcUrl(chain, network);
  if (pub) urls.push(pub);
  return urls;
}

// Default public RPC per chain/network (used only if no private RPC configured).
const PUBLIC_RPC: Record<EvmChain, Record<EvmNetwork, string>> = {
  polygon: {
    testnet: "https://rpc-amoy.polygon.technology",
    mainnet: "https://polygon-rpc.com"
  },
  base: {
    testnet: "https://sepolia.base.org",
    mainnet: "https://mainnet.base.org"
  }
};

const NATIVE_CURRENCY: Record<EvmChain, { name: string; symbol: string; decimals: number }> = {
  polygon: { name: "POL", symbol: "POL", decimals: 18 },
  base: { name: "Ether", symbol: "ETH", decimals: 18 }
};

const BLOCK_EXPLORER: Record<EvmChain, Record<EvmNetwork, string>> = {
  polygon: {
    testnet: "https://amoy.polygonscan.com",
    mainnet: "https://polygonscan.com"
  },
  base: {
    testnet: "https://sepolia.basescan.org",
    mainnet: "https://basescan.org"
  }
};

/**
 * Buyer-facing wallet RPC: prefers Alchemy (no rate limit), falls back to the
 * correct public RPC for the chain. Safe to expose — Alchemy app RPCs are
 * embeddable read endpoints. This is what the widget passes to MetaMask's
 * wallet_addEthereumChain so the wallet does not use its own rate-limited RPC.
 */
export function walletRpcUrl(chain: EvmChain, network: EvmNetwork): string {
  const prefix = envRpcPrefix(chain, network);
  return (
    process.env[`${prefix}_ALCHEMY_RPC_URL`]?.trim() ||
    resolveRpcUrl(chain, network) ||
    PUBLIC_RPC[chain][network]
  );
}

export function nativeCurrency(chain: EvmChain) {
  return NATIVE_CURRENCY[chain];
}

export function blockExplorerUrl(chain: EvmChain, network: EvmNetwork): string {
  return BLOCK_EXPLORER[chain][network];
}

export function minConfirmations(network: EvmNetwork): number {
  // Mainnet uses a finality-safe depth (Polygon/Base reorg window exceeds a few
  // blocks); 3 confirmations is within reorg range and unsafe for money
  // (ADR 0001 #13). Testnet stays shallow for fast local/CI feedback.
  return network === "testnet" ? 1 : 64;
}

export function walletConnectProjectId(): string | undefined {
  return process.env.WALLETCONNECT_PROJECT_ID?.trim() || undefined;
}

export function isCryptoQuoteEnabled(): boolean {
  return process.env.CRYPTO_QUOTE_ENABLED !== "false";
}

export type CryptoTransferQuote = {
  kind: "merchant" | "platform_fee";
  destinationAddress: string;
  amountAtomic: string;
  amountDisplay: string;
};

export type CryptoBuyerFacing = {
  chainId: number;
  chain: EvmChain;
  evmNetwork: EvmNetwork;
  chainLabel: string;
  tokenAddress: string;
  tokenSymbol: "USDC";
  amountAtomic: string;
  amountDisplay: string;
  destinationAddress: string;
  transfers?: CryptoTransferQuote[];
  quoteExpiresAt: string;
  walletConnectProjectId?: string;
  rpcUrl?: string;
  blockExplorerUrl?: string;
  nativeCurrency?: { name: string; symbol: string; decimals: number };
};

export function quoteExpiresAt(ttlSeconds: number): string {
  return new Date(Date.now() + ttlSeconds * 1000).toISOString();
}

export function isQuoteExpired(quoteExpiresAtIso: string | undefined): boolean {
  if (!quoteExpiresAtIso) return true;
  return Date.parse(quoteExpiresAtIso) <= Date.now();
}
