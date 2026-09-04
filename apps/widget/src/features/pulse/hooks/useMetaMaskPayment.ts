import { useState } from "react";
import { createWalletClient, custom, erc20Abi, isAddress, parseUnits, type Chain } from "viem";
import { base, polygon, polygonAmoy, baseSepolia } from "viem/chains";

type ChainKey = "polygon:mainnet" | "polygon:testnet" | "base:mainnet" | "base:testnet";

type EvmPaymentChainConfig = {
  chain: Chain;
  usdc: `0x${string}`;
  explorer: string;
};

const CHAIN_CONFIG: Record<ChainKey, EvmPaymentChainConfig> = {
  "polygon:mainnet": {
    chain: polygon,
    usdc: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    explorer: "https://polygonscan.com",
  },
  "polygon:testnet": {
    chain: polygonAmoy,
    usdc: "0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582",
    explorer: "https://amoy.polygonscan.com",
  },
  "base:mainnet": {
    chain: base,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org",
  },
  "base:testnet": {
    chain: baseSepolia,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
  },
};

function resolveChainConfig(chainName?: string, network?: string) {
  const safeChain = chainName === "base" ? "base" : "polygon";
  const safeNetwork = network === "mainnet" ? "mainnet" : "testnet";
  return CHAIN_CONFIG[`${safeChain}:${safeNetwork}`];
}

type WindowEthereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

async function ensureChain(ethereum: WindowEthereum, chain: Chain): Promise<void> {
  const chainId = `0x${chain.id.toString(16)}`;
  try {
    await ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId }] });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code !== 4902) throw err;
    await ethereum.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId,
          chainName: chain.name,
          nativeCurrency: chain.nativeCurrency,
          rpcUrls: chain.rpcUrls.default.http,
          blockExplorerUrls: chain.blockExplorers?.default?.url ? [chain.blockExplorers.default.url] : undefined,
        },
      ],
    });
  }
}

export type MetaMaskPaymentStatus =
  | "idle"
  | "connecting"
  | "approving"
  | "transferring"
  | "submitted"
  | "error";

export interface UseMetaMaskPaymentResult {
  status: MetaMaskPaymentStatus;
  txHash: string | null;
  approvalTxHash: string | null;
  error: string | null;
  explorerUrl: string | null;
  payWithMetaMask: (amountUSDC: string, treasuryAddress: string, chainName?: string, network?: string) => Promise<void>;
}

export function useMetaMaskPayment(): UseMetaMaskPaymentResult {
  const [status, setStatus] = useState<MetaMaskPaymentStatus>("idle");
  const [txHash, setTxHash] = useState<string | null>(null);
  const [approvalTxHash, setApprovalTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [explorerUrl, setExplorerUrl] = useState<string | null>(null);

  async function payWithMetaMask(amountUSDC: string, treasuryAddress: string, chainName?: string, network?: string) {
    setError(null);
    setTxHash(null);
    setApprovalTxHash(null);
    setExplorerUrl(null);

    try {
      const cfg = resolveChainConfig(chainName, network);
      const treasury = treasuryAddress.trim();
      if (!isAddress(treasury)) {
        throw new Error("Endereço EVM do recebedor inválido.");
      }

      setStatus("connecting");
      const ethereum = (window as unknown as { ethereum?: WindowEthereum }).ethereum;
      if (!ethereum) {
        throw new Error("MetaMask não encontrado. Instale a extensão MetaMask.");
      }
      await ensureChain(ethereum, cfg.chain);

      const client = createWalletClient({
        chain: cfg.chain,
        transport: custom(ethereum),
      });

      const [account] = await client.requestAddresses();
      if (!account) throw new Error("Nenhuma conta encontrada na carteira.");

      const amount = parseUnits(amountUSDC, 6);

      setStatus("approving");
      const approvalHash = await client.writeContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "approve",
        args: [treasury, amount],
        account,
      });
      setApprovalTxHash(approvalHash);

      setStatus("transferring");
      const hash = await client.writeContract({
        address: cfg.usdc,
        abi: erc20Abi,
        functionName: "transfer",
        args: [treasury, amount],
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

  return { status, txHash, approvalTxHash, error, explorerUrl, payWithMetaMask };
}
