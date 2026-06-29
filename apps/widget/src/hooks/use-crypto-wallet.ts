import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, erc20Abi, type Hash } from "viem";
import { base, baseSepolia, polygon, polygonAmoy } from "viem/chains";
import type { CryptoBuyerFacingQuote } from "./crypto-payment.types.js";

type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  isMetaMask?: boolean;
  isTrust?: boolean;
  isTrustWallet?: boolean;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

// EIP-6963: wallets announce themselves via window events instead of all
// fighting over the single window.ethereum slot. This is how we tell MetaMask
// and Trust apart when both extensions are installed (the old window.ethereum
// approach connects whichever wallet won the slot, so the "Trust" button used
// to just open MetaMask).
type Eip6963ProviderInfo = {
  uuid: string;
  name: string;
  icon: string;
  rdns: string;
};

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo;
  provider: Eip1193Provider;
};

export type WalletTarget = "metamask" | "trust" | "any";

function resolveChain(chainId: number) {
  if (chainId === polygon.id) return polygon;
  if (chainId === polygonAmoy.id) return polygonAmoy;
  if (chainId === base.id) return base;
  if (chainId === baseSepolia.id) return baseSepolia;
  return polygonAmoy;
}

function injectedProvider(): Eip1193Provider | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as Window & { ethereum?: Eip1193Provider }).ethereum;
}

// Match a discovered 6963 provider to the wallet the buyer asked for. rdns is
// the stable identifier (io.metamask, com.trustwallet.app); fall back to name +
// legacy boolean flags so we still work with wallets that pre-date 6963.
function matchesTarget(detail: Eip6963ProviderDetail, target: WalletTarget): boolean {
  if (target === "any") return true;
  const rdns = detail.info.rdns?.toLowerCase() ?? "";
  const name = detail.info.name?.toLowerCase() ?? "";
  if (target === "metamask") {
    return rdns.includes("metamask") || name.includes("metamask") || detail.provider.isMetaMask === true;
  }
  // trust
  return (
    rdns.includes("trust") ||
    name.includes("trust") ||
    detail.provider.isTrust === true ||
    detail.provider.isTrustWallet === true
  );
}

function injectedMatchesTarget(provider: Eip1193Provider, target: WalletTarget): boolean {
  if (target === "any") return true;
  if (target === "metamask") return provider.isMetaMask === true;
  return provider.isTrust === true || provider.isTrustWallet === true;
}

function targetLabel(target: WalletTarget): string {
  if (target === "metamask") return "MetaMask";
  if (target === "trust") return "Trust Wallet";
  return "carteira";
}

export function useCryptoWallet() {
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<Eip6963ProviderDetail[]>([]);
  // The provider we actually connected through — used for send/chain ops so we
  // keep talking to the same wallet the buyer picked, not window.ethereum.
  const [active, setActive] = useState<Eip1193Provider | null>(null);

  // Subscribe to EIP-6963 announcements. Wallets emit on load and in response
  // to our request event, so we fire the request after subscribing.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const seen = new Map<string, Eip6963ProviderDetail>();
    function onAnnounce(event: Event) {
      const detail = (event as CustomEvent<Eip6963ProviderDetail>).detail;
      if (!detail?.info?.uuid) return;
      seen.set(detail.info.uuid, detail);
      setProviders([...seen.values()]);
    }
    window.addEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    return () => {
      window.removeEventListener("eip6963:announceProvider", onAnnounce as EventListener);
    };
  }, []);

  const resolveProvider = useCallback(
    (target: WalletTarget): Eip1193Provider => {
      // 1. Prefer an EIP-6963 provider that matches the requested wallet.
      const match = providers.find((p) => matchesTarget(p, target));
      if (match) return match.provider;

      // 2. Fall back to legacy window.ethereum if it matches (or target=any).
      const injected = injectedProvider();
      if (injected && injectedMatchesTarget(injected, target)) return injected;

      // 3. If the specific wallet isn't found but SOME injected wallet exists,
      //    only use it for "any"; for a named wallet, surface a clear error so
      //    the buyer knows to install/open it rather than silently paying from
      //    the wrong wallet.
      if (target === "any" && injected) return injected;

      throw new Error(
        `${targetLabel(target)} não encontrada. Instale a extensão ou abra esta página dentro do app ${targetLabel(target)}.`
      );
    },
    [providers]
  );

  const connect = useCallback(
    async (target: WalletTarget = "any") => {
      setConnecting(true);
      setError(null);
      try {
        const provider = resolveProvider(target);
        const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
        const next = accounts[0] as `0x${string}` | undefined;
        if (!next) throw new Error("Nenhuma conta autorizada.");
        setActive(provider);
        setAddress(next);
        return next;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Falha ao conectar carteira.";
        setError(message);
        throw err;
      } finally {
        setConnecting(false);
      }
    },
    [resolveProvider]
  );

  // Back-compat alias + explicit per-wallet helpers.
  const connectMetaMask = useCallback(() => connect("metamask"), [connect]);
  const connectTrust = useCallback(() => connect("trust"), [connect]);

  // Reflect account/disconnect changes from the active wallet.
  useEffect(() => {
    if (!active?.on || !active.removeListener) return;
    function onAccountsChanged(...args: unknown[]) {
      const accounts = args[0] as string[] | undefined;
      const next = accounts?.[0] as `0x${string}` | undefined;
      setAddress(next ?? null);
      if (!next) setActive(null);
    }
    active.on("accountsChanged", onAccountsChanged);
    return () => active.removeListener?.("accountsChanged", onAccountsChanged);
  }, [active]);

  const ensureChain = useCallback(
    async (chainId: number, provider: Eip1193Provider) => {
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
    },
    []
  );

  const sendUsdcTransfer = useCallback(
    async (quote: CryptoBuyerFacingQuote, from: `0x${string}`): Promise<Hash> => {
      const provider = active ?? injectedProvider();
      if (!provider) throw new Error("Carteira não disponível.");
      await ensureChain(quote.chainId, provider);
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
    [active, ensureChain]
  );

  return {
    address,
    connecting,
    error,
    providers,
    connect,
    connectMetaMask,
    connectTrust,
    sendUsdcTransfer,
    setError
  };
}
