import { MELHOR_ENVIO_USER_AGENT, melhorEnvioBaseUrl } from "../melhor-envio-config.js";
import { parseShippingWallet, ShippingWalletError, walletLocation } from "../../domain/shipping-wallet.js";
import type { ShippingWalletProvider } from "../../domain/ports/shipping-wallet-provider.port.js";

export class MelhorEnvioWalletAdapter implements ShippingWalletProvider {
  constructor(private readonly match: (encryptedAccessToken: string, resolvedToken: string) => boolean) {}
  location() { const base = melhorEnvioBaseUrl(); return { base, ...walletLocation(base) }; }
  read(base: string, token: string) { return readMelhorEnvioWallet(base, token); }
  matchesCredential(encryptedAccessToken: string, resolvedToken: string) {
    return this.match(encryptedAccessToken, resolvedToken);
  }
}

export async function readMelhorEnvioWallet(base: string, token: string, transport: typeof fetch = fetch) {
  walletLocation(base);
  if (!token?.trim()) throw new ShippingWalletError("reconnect_required");
  try {
    const response = await transport(`${base}/api/v2/me/balance`, {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5_000),
      headers: { Accept: "application/json", Authorization: `Bearer ${token}`, "User-Agent": MELHOR_ENVIO_USER_AGENT },
    });
    if (response.status === 401) throw new ShippingWalletError("reconnect_required");
    if (response.status === 403) throw new ShippingWalletError("permission_denied");
    if (!response.ok) throw new ShippingWalletError("provider_unavailable");
    return parseShippingWallet(await response.json());
  } catch (error) {
    if (error instanceof ShippingWalletError) throw error;
    throw new ShippingWalletError("provider_unavailable");
  }
}
