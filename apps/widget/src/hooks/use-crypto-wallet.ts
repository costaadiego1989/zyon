import { useCallback, useState } from "react";
import { createWalletClient, custom, erc20Abi, type Hash } from "viem";
import { base, baseSepolia, polygon, polygonAmoy } from "viem/chains";
import type { CryptoBuyerFacingQuote } from "./crypto-payment.types.js";

type InjectedEthereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
};

function resolveChain(chainId: number) {
  if (chainId === polygon.id) return polygon;
  if (chainId === polygonAmoy.id) return polygonAmoy;
  if (chainId === base.id) return base;
  if (chainId === baseSepolia.id) return baseSepolia;
  return polygonAmoy;
}

function injectedProvider(): InjectedEthereum | undefined {
  if (typeof window === "undefined") return undefined;
  const eth = (window as Window & { ethereum?: InjectedEthereum }).ethereum;
  return eth;
}

export function useCryptoWallet() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const connectMetaMask = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const provider = injectedProvider();
      if (!provider) {
        throw new Error("Carteira não encontrada. Instale MetaMask ou abra no app Trust Wallet.");
      }
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const next = accounts[0] as `0x${string}` | undefined;
      if (!next) throw new Error("Nenhuma conta autorizada.");
      setAddress(next);
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha ao conectar carteira.";
      setError(message);
      throw err;
    } finally {
      setConnecting(false);
    }
  }, []);

  const ensureChain = useCallback(async (chainId: number) => {
    const provider = injectedProvider();
    if (!provider) throw new Error("Carteira não disponível.");
    const hex = `0x${chainId.toString(16)}`;
    try {
      await provider.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: hex }]
      });
    } catch (err) {
      const code = (err as { code?: number })?.code;
      if (code !== 4902) throw err;
      const chain = resolveChain(chainId);
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: hex,
            chainName: chain.name,
            nativeCurrency: chain.nativeCurrency,
            rpcUrls: chain.rpcUrls.default.http
          }
        ]
      });
    }
  }, []);

  const sendUsdcTransfer = useCallback(
    async (quote: CryptoBuyerFacingQuote, from: `0x${string}`): Promise<Hash> => {
      const provider = injectedProvider();
      if (!provider) throw new Error("Carteira não disponível.");
      await ensureChain(quote.chainId);
      const chain = resolveChain(quote.chainId);
      const client = createWalletClient({
        chain,
        transport: custom(provider)
      });
      return client.writeContract({
        account: from,
        address: quote.tokenAddress as `0x${string}`,
        abi: erc20Abi,
        functionName: "transfer",
        args: [quote.destinationAddress as `0x${string}`, BigInt(quote.amountAtomic)]
      });
    },
    [ensureChain]
  );

  return {
    address,
    connecting,
    error,
    connectMetaMask,
    sendUsdcTransfer,
    setError
  };
}
