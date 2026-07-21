import { useState } from "react";
import { createWalletClient, custom, parseUnits, type Chain } from "viem";
import { base, polygon, polygonAmoy, baseSepolia } from "viem/chains";

// Chain-specific CCTP contracts and USDC addresses
const CHAIN_CONFIG: Record<string, { chain: Chain; cctpTokenMessenger: `0x${string}`; usdc: `0x${string}`; stellarDomain: number; explorer: string }> = {
  // Base mainnet (chain 8453)
  'base:mainnet': {
    chain: base,
    cctpTokenMessenger: '0xbd3fa81b58ba92a82136038b25adec7066af3155',
    usdc: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    stellarDomain: 6,
    explorer: 'https://basescan.org',
  },
  // Base Sepolia testnet (chain 84532)
  'base:testnet': {
    chain: baseSepolia,
    cctpTokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    usdc: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    stellarDomain: 6,
    explorer: 'https://sepolia.basescan.org',
  },
  // Polygon mainnet (chain 137)
  'polygon:mainnet': {
    chain: polygon,
    cctpTokenMessenger: '0x9daF8c91AEFAE50b9c0E69629D3F6Ca40cA3B3FE',
    usdc: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    stellarDomain: 6,
    explorer: 'https://polygonscan.com',
  },
  // Polygon Amoy testnet (chain 80002)
  'polygon:testnet': {
    chain: polygonAmoy,
    cctpTokenMessenger: '0x9f3B8679c73C2Fef8b59B4f3444d4e156fb70AA5',
    usdc: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    stellarDomain: 6,
    explorer: 'https://amoy.polygonscan.com',
  },
};

function resolveChainConfig(chainName?: string, network?: string) {
  const key = `${chainName || 'polygon'}:${network || 'testnet'}`;
  return CHAIN_CONFIG[key] ?? CHAIN_CONFIG['polygon:testnet'];
}

// Legacy exports preserved for backward compat
const CCTP_TOKEN_MESSENGER = "0xbd3fa81b58ba92a82136038b25adec7066af3155" as const;
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const STELLAR_DOMAIN_ID = 6;

const TOKEN_MESSENGER_ABI = [
  {
    inputs: [
      { name: "amount", type: "uint256" },
      { name: "destinationDomain", type: "uint32" },
      { name: "mintRecipient", type: "bytes32" },
      { name: "burnToken", type: "address" },
    ],
    name: "depositForBurn",
    outputs: [{ name: "nonce", type: "uint64" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

/**
 * Decodes a Stellar G-address (Strkey) to its raw 32-byte ed25519 public key,
 * then formats as a 0x-prefixed bytes32 hex string for CCTP mintRecipient.
 * Strkey structure: base32(version_byte[1] + raw_key[32] + crc16[2])
 * Version byte for G-address (ED25519_PUBLIC_KEY) = 0x30. We skip it and
 * take the next 32 bytes as the raw key.
 */
function stellarAddressToBytes32(stellarPublicKey: string): `0x${string}` {
  const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const decoded: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of stellarPublicKey) {
    const idx = ALPHABET.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      decoded.push((value >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  // decoded[0] = version byte (0x30), decoded[1..32] = raw 32-byte key
  const rawKey = decoded.slice(1, 33);
  return ("0x" + rawKey.map((b) => b.toString(16).padStart(2, "0")).join("")) as `0x${string}`;
}

export type MetaMaskPaymentStatus =
  | "idle"
  | "connecting"
  | "approving"
  | "burning"
  | "submitted"
  | "error";

export interface UseMetaMaskPaymentResult {
  status: MetaMaskPaymentStatus;
  txHash: string | null;
  error: string | null;
  explorerUrl: string | null;
  payWithMetaMask: (amountUSDC: string, merchantStellarAddress: string, chainName?: string, network?: string) => Promise<void>;
}

export function useMetaMaskPayment(): UseMetaMaskPaymentResult {
  const [status, setStatus] = useState<MetaMaskPaymentStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  async function payWithMetaMask(amountUSDC: string, merchantStellarAddress: string, chainName?: string, network?: string) {
    setError(null);
    setTxHash(null);
    setExplorerUrl(null);

    try {
      // Resolve chain config from merchant settings
      const cfg = resolveChainConfig(chainName, network);

      // 1. Connect MetaMask
      setStatus("connecting");
      type WindowEthereum = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
      const ethereum = (window as unknown as { ethereum?: WindowEthereum }).ethereum;
      if (!ethereum) {
        throw new Error("MetaMask não encontrado. Instale a extensão MetaMask.");
      }

      const client = createWalletClient({
        chain: cfg.chain,
        transport: custom(ethereum),
      });

      const [account] = await client.requestAddresses();
      if (!account) throw new Error("Nenhuma conta encontrada na carteira.");

      const amount = parseUnits(amountUSDC, 6); // USDC = 6 decimals
      const mintRecipient = stellarAddressToBytes32(merchantStellarAddress);

      // 2. Approve CCTP TokenMessenger to spend USDC
      setStatus("approving");
      await client.writeContract({
        address: cfg.usdc,
        abi: ERC20_ABI,
        functionName: "approve",
        args: [cfg.cctpTokenMessenger, amount],
        account,
      });

      // 3. depositForBurn — burns USDC on source chain, Circle attests and mints on Stellar
      setStatus("burning");
      const hash = await client.writeContract({
        address: cfg.cctpTokenMessenger,
        abi: TOKEN_MESSENGER_ABI,
        functionName: "depositForBurn",
        args: [amount, cfg.stellarDomain, mintRecipient, cfg.usdc],
        account,
      });

      setTxHash(hash);
      setExplorerUrl(`${cfg.explorer}/tx/${hash}`);
      setStatus("submitted");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Pagamento falhou.");
    }
  }

  return { status, txHash, error, explorerUrl, payWithMetaMask };
}
